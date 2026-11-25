/**
 * Čisté odvodenia pre Prehľad praxe a detail prípadu v režime Pokročilé (variant A, MČ 25. 11. 2026):
 * kalendár týždňov, upozornenia, karty prípadov a zoskupená história. Berú iba to, čo prečítal read-model;
 * nič nedopočítavajú (žiadne lehoty z predpisov, žiadne sviatky), víkend je len deň v týždni.
 */
import { addDays, deadlineKey, deadlineTier, ISO_DAY, recordKey, taskDue, type MatterInput, type MatterOverview, type UpcomingDeadline } from "../../../../../lawoss/okf/read";
import { screeningNeedsAttention, screenings, type CockpitEvent, type CockpitScreening } from "../../../../../lawoss/okf/cockpit";
import { buildMatterViews } from "../../../../../lawoss/okf/views";
import { cardStatus, type CardStatus } from "../lite/client-cards";
import { clientOf } from "../lite/today-model";

const parseDay = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

export const isWeekend = (iso: string): boolean => ISO_DAY.test(iso) && [0, 6].includes(parseDay(iso).getUTCDay());

/** Pondelok týždňa, v ktorom deň leží. */
export function mondayOf(iso: string): string {
  const weekday = parseDay(iso).getUTCDay();
  return addDays(iso, weekday === 0 ? -6 : 1 - weekday);
}

export type CalendarDay = { iso: string; weekend: boolean; past: boolean; today: boolean; outside?: true };

/** Celé týždne od pondelka týždňa `todayIso`. */
export function weekDays(todayIso: string, weeks: number): CalendarDay[] {
  const from = mondayOf(todayIso);
  return Array.from({ length: weeks * 7 }, (_, i) => dayCell(addDays(from, i), todayIso));
}

/** Mesiac dňa `anchor` po celých týždňoch (pondelok až nedeľa); dni iného mesiaca nesú `outside`. */
export function monthDays(anchor: string, todayIso: string): CalendarDay[] {
  const first = `${anchor.slice(0, 7)}-01`;
  const next = addDays(`${anchor.slice(0, 7)}-28`, 4).slice(0, 7);
  const last = addDays(`${next}-01`, -1);
  const from = mondayOf(first);
  const days: CalendarDay[] = [];
  for (let iso = from; iso <= last || days.length % 7 !== 0; iso = addDays(iso, 1)) {
    const cell = dayCell(iso, todayIso);
    days.push(iso.slice(0, 7) === anchor.slice(0, 7) ? cell : { ...cell, outside: true });
  }
  return days;
}

const dayCell = (iso: string, todayIso: string): CalendarDay => ({ iso, weekend: isWeekend(iso), past: iso < todayIso, today: iso === todayIso });

/** Naliehavosť lehoty slovom pre farbu aj text: po termíne, dnes/zajtra, do 7 dní, neskôr. */
export type DeadlineTone = "overdue" | "hot" | "soon" | "later";
export function deadlineTone(date: string, todayIso: string): DeadlineTone {
  const tier = deadlineTier(date, todayIso);
  return tier === "overdue" ? "overdue" : tier === "today" ? "hot" : tier;
}

export type PracticeTask = { key: string; title: string; due: string; overdue: boolean; assignee?: string; matter: Pick<MatterOverview, "path" | "title"> };

/** Otvorené úlohy s platným termínom; zdieľaný súbor úlohy je jedna úloha (`recordKey`). */
export function practiceTasks(matters: readonly MatterOverview[], todayIso: string): PracticeTask[] {
  const seen = new Set<string>();
  const out: PracticeTask[] = [];
  for (const m of matters) {
    for (const task of m.openTasks) {
      const day = taskDue(task.due).day;
      const key = recordKey(m.path, task);
      if (!day || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, title: task.title, due: day, overdue: day < todayIso, ...(task.assignee ? { assignee: task.assignee } : {}), matter: { path: m.path, title: m.title } });
    }
  }
  return out.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.title.localeCompare(b.title)));
}

type OverviewSource = { matters: readonly MatterOverview[]; inputs: readonly MatterInput[]; upcomingDeadlines: readonly UpcomingDeadline[]; overdue: readonly UpcomingDeadline[] };

export type PracticeAlert =
  | { kind: "overdueDeadlines"; count: number }
  | { kind: "deadline"; deadline: UpcomingDeadline; client?: string }
  | { kind: "task"; task: PracticeTask; client?: string }
  | { kind: "screening"; screening: CockpitScreening; matter: Pick<MatterOverview, "path" | "title">; client?: string };

/** Upozornenia praxe v poradí naliehavosti: lehoty po termíne, lehoty dnes a zajtra, úlohy po termíne, rizikové preverenia. */
export function practiceAlerts(data: OverviewSource, todayIso: string): PracticeAlert[] {
  const client = clientNames(data);
  const overdue = new Set(data.overdue.map(deadlineKey)).size;
  const due = data.upcomingDeadlines.filter((d) => !d.invalid && deadlineTier(d.date, todayIso) === "today");
  const tasks = practiceTasks(data.matters, todayIso).filter((task) => task.overdue);
  const risky = data.matters.flatMap((m) => {
    const input = data.inputs.find((i) => i.path === m.path);
    return input ? screenings(input).filter(screeningNeedsAttention).map((screening) => ({ screening, matter: { path: m.path, title: m.title } })) : [];
  });
  return [
    ...(overdue > 0 ? [{ kind: "overdueDeadlines" as const, count: overdue }] : []),
    ...due.map((deadline) => ({ kind: "deadline" as const, deadline, ...named(client(deadline.matter.path)) })),
    ...tasks.map((task) => ({ kind: "task" as const, task, ...named(client(task.matter.path)) })),
    ...risky.map((item) => ({ kind: "screening" as const, ...item, ...named(client(item.matter.path)) })),
  ];
}

const named = (client: string | undefined): { client?: string } => (client ? { client } : {});

/** Meno klienta prípadu (karta klienta alebo priečinok klienta); bez klienta `undefined`. */
function clientNames(data: Pick<OverviewSource, "matters" | "inputs">): (path: string) => string | undefined {
  const names = new Map(data.matters.map((m) => {
    const input = data.inputs.find((i) => i.path === m.path);
    const owner = clientOf(m, input);
    return [m.path, owner.key.startsWith("matter:") ? undefined : owner.name] as const;
  }));
  return (path) => names.get(path);
}

export type MatterCard = {
  matter: MatterOverview;
  client?: string;
  /** Najbližšia lehota: najstaršia po termíne, inak najbližšia odo dneška. Neplatný dátum nie je termín. */
  nearest?: MatterOverview["deadlines"][number];
  overdueTasks: number;
  /** Najnovšie preverenie, ktoré si pýta pozornosť. */
  screening?: CockpitScreening;
  status: CardStatus;
};

/** Karta za každý prípad, zoradené podľa najbližšej lehoty (po termíne navrchu, bez lehoty na konci). */
export function matterCards(data: Pick<OverviewSource, "matters" | "inputs">, todayIso: string): MatterCard[] {
  const client = clientNames(data);
  const cards = data.matters.map((matter): MatterCard => {
    const input = data.inputs.find((i) => i.path === matter.path);
    const valid = matter.deadlines.filter((d) => !d.invalid);
    const nearest = valid.find((d) => d.date < todayIso) ?? valid.find((d) => d.date >= todayIso);
    const screening = input ? screenings(input).find(screeningNeedsAttention) : undefined;
    const overdueTasks = matter.openTasks.filter((task) => { const day = taskDue(task.due).day; return day !== undefined && day < todayIso; }).length;
    const name = client(matter.path);
    return { matter, overdueTasks, status: input ? cardStatus(buildMatterViews(input, todayIso)) : {},
      ...(name ? { client: name } : {}), ...(nearest ? { nearest } : {}), ...(screening ? { screening } : {}) };
  });
  return cards.sort((a, b) => {
    const x = a.nearest?.date, y = b.nearest?.date;
    if (x !== y) return x === undefined ? 1 : y === undefined ? -1 : x < y ? -1 : 1;
    return a.matter.title.localeCompare(b.matter.title);
  });
}

/**
 * Jeden riadok priebehu: udalosti z toho istého dňa, ktoré majú rovnaký druh (napr. doručenie zapísané
 * v zázname prípadu aj rozhodnutia) alebo rovnaký text. Nič sa nezahadzuje: všetky odlišné texty aj všetky
 * záznamy ostávajú pri skupine, nadpisom je najpodrobnejší text.
 */
export type EventGroup = { key: string; date: string; kind?: string; texts: string[]; recordIds: string[]; files: string[] };

const normalized = (text: string): string => text.trim().toLocaleLowerCase("sk").replace(/[\s.,;:!]+$/u, "").replace(/\s+/g, " ");

export function groupEvents(events: readonly CockpitEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  for (const event of events) {
    const text = normalized(event.text);
    const group = groups.find((g) => g.date === event.date && ((event.kind && g.kind === event.kind) || g.texts.some((t) => normalized(t) === text)));
    if (!group) {
      groups.push({ key: `${event.date}/${groups.length}`, date: event.date, ...(event.kind ? { kind: event.kind } : {}), texts: [event.text], recordIds: [event.recordId], files: [event.file] });
      continue;
    }
    if (!group.texts.some((t) => normalized(t) === text)) group.texts.push(event.text);
    if (!group.recordIds.includes(event.recordId)) group.recordIds.push(event.recordId);
    if (!group.files.includes(event.file)) group.files.push(event.file);
  }
  for (const group of groups) group.texts.sort((a, b) => b.length - a.length);
  return groups.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
}
