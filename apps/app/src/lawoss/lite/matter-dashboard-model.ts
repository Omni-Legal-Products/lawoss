/**
 * Prípad v bežnom režime ako pasívny prehľad spisu (alfa 14, spec-pripad.md): čisté odvodenia nad tým, čo stránka
 * prípadu už dostáva (`cockpit`, `views`). Obrazovka (`matter-dashboard.tsx`) ich len zobrazí. Nič sa nečíta navyše,
 * nič sa nevymýšľa: čo záznam nemá, dlaždica ani riadok netvrdí.
 */
import { daysBetween, isOfficeFile, taskDue, type MatterOverview } from "../../../../../lawoss/okf/read";

type OverviewDeadline = MatterOverview["deadlines"][number];
import type { Cockpit, CockpitDeadline, CockpitEvent, CockpitFact, CockpitParty } from "../../../../../lawoss/okf/cockpit";
import type { MatterViews } from "../../../../../lawoss/okf/views";
import { deadlineKey, deadlineText, inHorizon, isCalendarDay, urgencyOf } from "../okf/view-rules";
import { cardStatus, type CardStatus } from "./client-cards";
import { deadlineAnchor } from "./live";
import { MORE_ACTIONS, QUICK_ACTIONS } from "./quick-actions";
import { dayTone, type DayTone } from "./today-model";

/** Z cockpitu stačí to, čo prehľad ukazuje. */
export type DashboardCockpit = Pick<Cockpit, "deadlines" | "tasks" | "attention" | "facts" | "parties"> & Partial<Pick<Cockpit, "events">>;
type Task = Cockpit["tasks"][number];
/** Lehoty, ktoré prehľad prípadu zaradil (`matter.deadlines`); z nich sa pozná kandidát. */
type Listed = readonly Pick<OverviewDeadline, "recordId" | "date">[];

// ── Hlavička ───────────────────────────────────────────────────────────────

/** Druh prípadu na štítok: typ práce z karty (`views.workKind`), inak `matter_kind` z prehľadu. */
export function headerKind(views: Pick<MatterViews, "workKind"> | undefined, matter: Pick<MatterOverview, "matterKind">): string | undefined {
  return views?.workKind?.trim() || matter.matterKind?.trim() || undefined;
}

const COUNTERPARTY = new Set(["protistrana", "counterparty"]);

/** „proti: …“ len pri jednej jednoznačnej protistrane (rola je text v jazyku záznamu, nie číselník). */
export function counterparty(parties: readonly Pick<CockpitParty, "name" | "role">[]): string | undefined {
  const names = new Set(parties.filter((p) => p.role && COUNTERPARTY.has(p.role.trim().toLocaleLowerCase("sk"))).map((p) => p.name.trim()).filter(Boolean));
  return names.size === 1 ? [...names][0] : undefined;
}

// ── Dlaždice ───────────────────────────────────────────────────────────────

/**
 * Kandidát na lehotu v tom istom zmysle ako na Dnes (`agenda-model.ts`, „na potvrdenie“): lehota spravovaného
 * workflow bez dôveryhodného potvrdenia. Prehľad prípadu (`matter.deadlines`, read.ts) takú lehotu nezaradí, cockpit
 * áno (ako nepotvrdenú); kandidát je teda lehota cockpitu, ktorú prehľad nemá. Obyčajná zapísaná lehota bez ľudského
 * overenia nie je kandidát: Dnes aj Klient ju volajú „evidovaná“.
 */
export function candidateKeys(deadlines: readonly Pick<CockpitDeadline, "recordId" | "date">[], listed: readonly Pick<OverviewDeadline, "recordId" | "date">[]): Set<string> {
  const known = new Set(listed.map((d) => `${d.recordId}\u0000${d.date}`));
  return new Set(deadlines.map((d) => `${d.recordId}\u0000${d.date}`).filter((key) => !known.has(key)));
}
const keyOf = (d: Pick<CockpitDeadline, "recordId" | "date">): string => `${d.recordId}\u0000${d.date}`;

/**
 * Dlaždica „Najbližšia lehota / termín“ rovnakým pravidlom ako karta prípadu na Klientovi (`matterTerm`): lehota po
 * termíne (najstaršia), inak najbližšia lehota alebo termín úlohy odo dneška (lehota pred úlohou v ten istý deň).
 * Lehota kancelárie, neplatný dátum ani kandidát (nie je v prehľade) nie sú termínom prípadu. `anchor`: riadok evidencie.
 */
export type MatterTerm =
  | { kind: "none" }
  | { kind: "deadline" | "work"; title: string; date: string; daysLeft: number; late: boolean; tone: DayTone; anchor?: string };

export function matterNearest(matter: Pick<MatterOverview, "deadlines" | "openTasks">, todayIso: string): MatterTerm {
  const deadlines = matter.deadlines.filter((d) => !d.invalid && !isOfficeFile(d.file) && isCalendarDay(d.date));
  const byDate = <T extends { date: string; kind: "deadline" | "work" }>(a: T, b: T) => a.date.localeCompare(b.date) || (a.kind === "deadline" ? -1 : 1);
  const late = deadlines.filter((d) => d.date < todayIso).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (late) return deadlineTerm(late, todayIso);
  type Next = { kind: "deadline"; date: string; d: OverviewDeadline } | { kind: "work"; date: string; title: string };
  const first = [
    ...deadlines.map((d): Next => ({ kind: "deadline", date: d.date, d })),
    ...matter.openTasks.flatMap((t): Next[] => {
      const due = t.due?.trim().slice(0, 10);
      return due && isCalendarDay(due) && due >= todayIso ? [{ kind: "work", date: due, title: t.title }] : [];
    }),
  ].sort(byDate)[0];
  if (!first) return { kind: "none" };
  if (first.kind === "deadline") return deadlineTerm(first.d, todayIso);
  // Pracovný termín nie je lehota: bez farby naliehavosti (ako na Klientovi).
  return { kind: "work", title: first.title, date: first.date, daysLeft: daysBetween(todayIso, first.date), late: false, tone: "neutral" };
}

function deadlineTerm(d: OverviewDeadline, todayIso: string): MatterTerm {
  const daysLeft = daysBetween(todayIso, d.date);
  const late = d.date < todayIso;
  return { kind: "deadline", title: deadlineText(d), date: d.date, daysLeft, late, tone: late ? "red" : dayTone(daysLeft),
    ...(inHorizon(d.date, todayIso) ? { anchor: deadlineAnchor(d.recordId, d.date) } : {}) };
}

/** Dlaždica „Kde vec stojí“: ručná fáza a ďalší krok z `_STATUS.md`; bez zápisu tlmený riadok (nenačítané pri chybe). */
export type MatterStage = CardStatus & { missing?: "not_recorded" | "not_loaded" };

export function matterStage(views: Pick<MatterViews, "strip"> | undefined, readState: "fresh" | "failed"): MatterStage {
  const status = views ? cardStatus(views) : {};
  return status.phase ? status : { ...status, missing: readState === "failed" ? "not_loaded" : "not_recorded" };
}

/**
 * „Čaká na vás“ pre jeden prípad rovnakými pravidlami ako Dnes (`waitingCounts`), každá položka raz: po termíne má
 * prednosť. Na zaradenie = nespracované vstupy; po termíne = platná lehota alebo úloha po termíne; na overenie =
 * neplatný dátum, lehota z pokynu advokáta, nález validácie, ručný stav alebo nečitateľný záznam; na potvrdenie =
 * kandidát na lehotu (`candidateKeys`), oboje v okne 14 dní ako na Dnes. Riadky „blíži sa“ z pozornosti nečakajú.
 */
export type MatterWaiting = { filing: number; overdue: number; verify: number; confirm: number; total: number };

export function matterWaiting(cockpit: Pick<DashboardCockpit, "deadlines" | "tasks" | "attention">, listed: Listed, todayIso: string): MatterWaiting {
  const counts = { filing: 0, overdue: 0, verify: 0, confirm: 0 };
  const all = [...cockpit.deadlines.confirmed, ...cockpit.deadlines.candidates];
  const candidates = candidateKeys(all, listed);
  const seen = new Set<string>();
  const add = (key: string, kind: keyof typeof counts) => { if (!seen.has(key)) { seen.add(key); counts[kind]++; } };
  for (const d of all) {
    const key = `d\u0000${d.recordId}\u0000${d.date}\u0000${deadlineText(d)}`;
    if (d.invalid || !isCalendarDay(d.date)) add(key, "verify");
    else if (d.date < todayIso) add(key, "overdue");
    // Rovnaké okno ako Dnes a stĺpec lehôt: čo čaká, má aj riadok, na ktorý sa dá pozrieť.
    else if (!inHorizon(d.date, todayIso)) continue;
    else if (d.basis === "instruction") add(key, "verify");
    else if (candidates.has(keyOf(d))) add(key, "confirm");
  }
  for (const t of cockpit.tasks) {
    if (t.invalid) add(`t\u0000${t.file}\u0000${t.id}`, "verify");
    else if (t.overdue) add(`t\u0000${t.file}\u0000${t.id}`, "overdue");
  }
  for (const row of cockpit.attention) {
    if (row.id.startsWith("vstup:")) add(`a\u0000${row.file}\u0000${row.id}`, "filing");
    else if (row.kind === "nález" || row.kind === "záznam") add(`a\u0000${row.file}\u0000${row.id}`, "verify");
  }
  return { ...counts, total: counts.filing + counts.overdue + counts.verify + counts.confirm };
}

// ── Priebeh veci ───────────────────────────────────────────────────────────

export type TimelineEntry = { kind: "event"; key: string; date: string; text: string; future: boolean; urgency?: "hot" | "near" | "calm" } | { kind: "today" };

/**
 * Časová os s rovnakým oknom ako zoznamy (view-rules): blížiace sa lehoty do horizontu nad dneškom,
 * pod ním zaznamenané udalosti a lehoty po termíne, najnovšie prvé.
 */
export function buildTimeline(events: readonly CockpitEvent[], deadlines: readonly CockpitDeadline[], todayIso: string): TimelineEntry[] {
  const dated = deadlines.filter((d) => !d.invalid && inHorizon(d.date, todayIso));
  const future: TimelineEntry[] = dated.filter((d) => d.date >= todayIso)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((d, i) => ({ kind: "event", key: `d/${deadlineKey(d, i)}`, date: d.date, text: deadlineText(d), future: true, urgency: urgencyOf(d.date, todayIso) }));
  const past = [
    ...events.filter((e) => e.date.slice(0, 10) <= todayIso)
      .map((e, i) => ({ kind: "event" as const, key: `e/${e.recordId}/${e.date}/${i}`, date: e.date.slice(0, 10), text: e.text, future: false })),
    ...dated.filter((d) => d.date < todayIso)
      .map((d, i) => ({ kind: "event" as const, key: `p/${deadlineKey(d, i)}`, date: d.date, text: deadlineText(d), future: false, urgency: "hot" as const })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  if (future.length === 0 && past.length === 0) return [];
  return [...future, { kind: "today" }, ...past];
}

/**
 * Vodorovná os: posledných `past` záznamov, „dnes“ a najbližších `future` termínov, zľava doprava v čase.
 * Bez zaznamenaných udalostí sa os nekreslí (spec: blok vynechať). `hidden`: koľko záznamov ostáva v celom priebehu.
 */
export function matterAxis(timeline: readonly TimelineEntry[], eventCount: number, past = 4, future = 2): { entries: TimelineEntry[]; hidden: number } {
  const today = timeline.findIndex((entry) => entry.kind === "today");
  if (eventCount === 0 || today < 0) return { entries: [], hidden: 0 };
  const ahead = timeline.slice(0, today).reverse().slice(0, Math.max(0, future));
  const behind = timeline.slice(today + 1, today + 1 + Math.max(0, past)).reverse();
  const entries = [...behind, timeline[today]!, ...ahead];
  return { entries, hidden: timeline.length - entries.length };
}

// ── Lehoty a úlohy ─────────────────────────────────────────────────────────

/** Pôvod lehoty na štítku: z pokynu advokáta, kandidát na potvrdenie, inak evidovaná (ako na Klientovi a Dnes). */
export type DeadlineOrigin = "instruction" | "candidate" | "recorded";
export const deadlineOrigin = (d: Pick<CockpitDeadline, "basis">, candidate: boolean): DeadlineOrigin =>
  d.basis === "instruction" ? "instruction" : candidate ? "candidate" : "recorded";

export type MatterRow =
  | { kind: "deadline"; key: string; deadline: CockpitDeadline; daysLeft: number | null; tone: DayTone; origin: DeadlineOrigin; anchor: string }
  | { kind: "task"; key: string; task: Task; day?: string; time?: string; daysLeft: number | null; tone: DayTone };

/**
 * Stĺpec „Lehoty a úlohy“: lehoty v tom istom okne ako evidencia (po termíne, do 14 dní, neplatný dátum) a úlohy
 * s termínom v tom istom okne alebo s neplatným dátumom. Neplatné navrchu, potom podľa dátumu, lehota pred úlohou.
 * Prvých `limit` riadkov, zvyšok je „+N“ do evidencie.
 */
export function matterRows(cockpit: Pick<DashboardCockpit, "deadlines" | "tasks"> | null, listed: Listed, todayIso: string, limit: number): { rows: MatterRow[]; more: number } {
  if (!cockpit) return { rows: [], more: 0 };
  const recorded = [...cockpit.deadlines.confirmed, ...cockpit.deadlines.candidates];
  const candidates = candidateKeys(recorded, listed);
  const deadlines = recorded
    .filter((d) => inHorizon(d.date, todayIso, d.invalid))
    .map((d, i): MatterRow => {
      const invalid = Boolean(d.invalid) || !isCalendarDay(d.date);
      const daysLeft = invalid ? null : daysBetween(todayIso, d.date);
      return { kind: "deadline", key: `d\u0000${deadlineKey(d, i)}`, deadline: d, daysLeft, tone: dayTone(daysLeft), origin: deadlineOrigin(d, candidates.has(keyOf(d))), anchor: deadlineAnchor(d.recordId, d.date) };
    });
  const tasks = cockpit.tasks.flatMap((task): MatterRow[] => {
    const due = task.invalid ? { invalid: true as const } : taskDue(task.due);
    if (due.invalid) return [{ kind: "task", key: `t\u0000${task.file}\u0000${task.id}`, task, daysLeft: null, tone: "red" }];
    if (!due.day || !inHorizon(due.day, todayIso)) return [];
    const daysLeft = daysBetween(todayIso, due.day);
    return [{ kind: "task", key: `t\u0000${task.file}\u0000${task.id}`, task, day: due.day, ...(due.time ? { time: due.time } : {}), daysLeft, tone: dayTone(daysLeft) }];
  });
  const date = (row: MatterRow) => row.kind === "deadline" ? row.deadline.date : row.day ?? "";
  const all = [...deadlines, ...tasks].sort((a, b) => Number(b.daysLeft === null) - Number(a.daysLeft === null)
    || (a.daysLeft === null ? 0 : date(a).localeCompare(date(b)))
    || (a.kind === b.kind ? 0 : a.kind === "deadline" ? -1 : 1));
  const rows = all.slice(0, Math.max(0, limit));
  return { rows, more: all.length - rows.length };
}

/** Prázdny stĺpec lehôt: nenačítané pri chybe čítania, neevidované bez poľa `deadlines`, inak „žiadne“. */
export function deadlinesEmpty(readState: "fresh" | "failed", views: Pick<MatterViews, "deadlinesRecorded"> | undefined): "not_loaded" | "unrecorded" | "empty" {
  return readState === "failed" ? "not_loaded" : views && !views.deadlinesRecorded ? "unrecorded" : "empty";
}

// ── Čo vieme, strany ───────────────────────────────────────────────────────

/** Stav faktu len z toho, čo záznam má: overené, inak na overenie (rovnaké pravidlo ako záložka „Čo vieme“). */
export type FactRow = { fact: CockpitFact; verified: boolean; source?: string };

export function factRows(facts: readonly CockpitFact[], limit: number): { rows: FactRow[]; total: number } {
  return {
    rows: facts.slice(0, Math.max(0, limit)).map((fact) => ({ fact, verified: fact.provenance === "overené",
      ...(fact.source ? { source: fact.locator ? `${fact.source} · ${fact.locator}` : fact.source } : {}) })),
    total: facts.length,
  };
}

/** Strany prípadu bez opakovania (subjekt aj účastník s tým istým menom a rolou je jeden riadok). */
export function partyRows(parties: readonly CockpitParty[], limit: number): { rows: CockpitParty[]; more: number } {
  const seen = new Set<string>();
  const unique = parties.filter((p) => {
    const key = `${p.name.trim().toLocaleLowerCase("sk")}\u0000${(p.role ?? "").trim().toLocaleLowerCase("sk")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const rows = unique.slice(0, Math.max(0, limit));
  return { rows, more: unique.length - rows.length };
}

// ── Pole chatu ─────────────────────────────────────────────────────────────

/** Spec: štyri hlavné návrhy v poli chatu (s pridaním dokumentu), ostatné pod „Ďalšie“. */
const DOCK_PRIMARY = ["summarize", "deadlines", "reply", "add_document"] as const;
type ActionEntry = (typeof QUICK_ACTIONS)[number] | (typeof MORE_ACTIONS)[number];

export function dockActions(): { primary: ActionEntry[]; more: ActionEntry[] } {
  const primary = new Set<string>(DOCK_PRIMARY);
  return {
    primary: DOCK_PRIMARY.flatMap((id) => QUICK_ACTIONS.filter((a) => a.id === id)),
    more: [...QUICK_ACTIONS.filter((a) => !primary.has(a.id)), ...MORE_ACTIONS],
  };
}
