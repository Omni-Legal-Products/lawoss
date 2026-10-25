/**
 * Udalosti pre mesiac a agendu dňa (spec 0020, Dnes aj Domov klienta). Čistá funkcia nad už načítaným prehľadom:
 * lehota (to isté, čo Dnes počíta ako lehoty), pracovný termín (`due` otvorenej úlohy) a návrh na potvrdenie
 * (riadená lehota bez dôveryhodného potvrdenia, `deadline-workflow`). Návrhy sa do lehôt nepočítajú.
 * Stretnutia OKF neeviduje, preto tu nie sú.
 */
import { deadlineKey, isOfficeFile, recordDeadlines, recordKey, type MatterInput, type MatterOverview, type UpcomingDeadline } from "../../../../../lawoss/okf/read";
import { isManagedDeadline, managedDeadlineTrusted } from "../../../../../lawoss/okf/deadline-workflow";
import { deadlineText, isCalendarDay } from "../okf/view-rules";
import { liteDeadlineLink, liteMatterLink } from "./links";

export type AgendaKind = "deadline" | "work" | "candidate";
export const AGENDA_KINDS: readonly AgendaKind[] = ["deadline", "work", "candidate"];

export type AgendaEvent = {
  key: string;
  kind: AgendaKind;
  /** RRRR-MM-DD; neplatné dátumy do mesiaca nepatria (ukazuje ich zoznam lehôt). */
  date: string;
  title: string;
  matter: { path: string; title: string };
  /** Lehota z kancelárie, nie z prípadu. */
  office?: true;
  link: string;
};

type Source = {
  matters: readonly MatterOverview[];
  upcomingDeadlines: readonly UpcomingDeadline[];
  overdue: readonly UpcomingDeadline[];
  inputs: readonly Pick<MatterInput, "path" | "records" | "recordFiles" | "deadlineWorkflowEvidence">[];
};

const byDateThenTitle = (a: AgendaEvent, b: AgendaEvent): number =>
  a.date.localeCompare(b.date) || AGENDA_KINDS.indexOf(a.kind) - AGENDA_KINDS.indexOf(b.kind) || a.title.localeCompare(b.title, "cs");

/** Všetky udalosti rozsahu (prax alebo klient) bez časového okna; zdieľaný záznam raz. */
export function agendaEvents(source: Source): AgendaEvent[] {
  const out = new Map<string, AgendaEvent>();
  for (const d of [...source.overdue, ...source.upcomingDeadlines]) {
    if (d.invalid || !isCalendarDay(d.date)) continue;
    const key = `deadline:${deadlineKey(d)}`;
    if (!out.has(key)) out.set(key, { key, kind: "deadline", date: d.date, title: deadlineText(d), matter: { path: d.matter.path, title: d.matter.title }, ...(isOfficeFile(d.file) ? { office: true as const } : {}), link: liteDeadlineLink(d.matter.path, d.recordId, d.date) });
  }
  for (const matter of source.matters) {
    for (const task of matter.openTasks) {
      const due = task.due?.trim().slice(0, 10);
      const key = `work:${recordKey(matter.path, task)}`;
      if (!due || !isCalendarDay(due) || out.has(key)) continue;
      out.set(key, { key, kind: "work", date: due, title: task.title, matter: { path: matter.path, title: matter.title }, link: liteMatterLink(matter.path) });
    }
  }
  const titles = new Map(source.matters.map((m) => [m.path, m.title]));
  for (const input of source.inputs) {
    for (const record of input.records) {
      if (!isManagedDeadline(record) || managedDeadlineTrusted(record, input.deadlineWorkflowEvidence)) continue;
      for (const d of recordDeadlines(record)) {
        const key = `candidate:${recordKey(input.path, { id: record.id, file: input.recordFiles?.[record.id] })}\u0000${d.date}`;
        if (d.invalid || out.has(key)) continue;
        out.set(key, { key, kind: "candidate", date: d.date, title: record.title, matter: { path: input.path, title: titles.get(input.path) ?? input.path }, link: liteMatterLink(input.path) });
      }
    }
  }
  return [...out.values()].sort(byDateThenTitle);
}

/** Udalosti po dňoch (kľúč RRRR-MM-DD). */
export function eventsByDay(events: readonly AgendaEvent[]): Map<string, AgendaEvent[]> {
  const days = new Map<string, AgendaEvent[]>();
  for (const event of events) days.set(event.date, [...(days.get(event.date) ?? []), event]);
  return days;
}

export type MonthDay = { iso: string; inMonth: boolean };

const utc = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const isoOf = (date: Date): string => date.toISOString().slice(0, 10);

/** `RRRR-MM` mesiaca, v ktorom leží deň. */
export const monthOf = (iso: string): string => iso.slice(0, 7);

/** Posun mesiaca o `delta` (prechod roka v oboch smeroch). */
export function shiftMonth(month: string, delta: number): string {
  const date = utc(`${month}-01`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return isoOf(date).slice(0, 7);
}

/** Celé týždne mesiaca od pondelka; dni susedných mesiacov majú `inMonth: false`. */
export function monthWeeks(month: string): MonthDay[][] {
  const first = utc(`${month}-01`);
  const start = new Date(first);
  start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  const weeks: MonthDay[][] = [];
  const cursor = new Date(start);
  do {
    const week: MonthDay[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({ iso: isoOf(cursor), inMonth: isoOf(cursor).startsWith(month) });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  } while (isoOf(cursor).startsWith(month));
  return weeks;
}
