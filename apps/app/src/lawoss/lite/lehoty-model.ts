/**
 * Lehoty a úlohy v bežnom režime ako pasívny prehľad (alfa 14, spec-lehoty.md, časť A). Čisté odvodenia nad tým, čo
 * stránka a Dnes už majú (`buildToday`, `caseDates`, `invalidCaseDates`, `agendaEvents`); nič nové sa nečíta.
 * Skupiny Po termíne / Tento týždeň / Neskôr, neplatné dátumy navrchu, štítok pôvodu, filter druhu a počty
 * podľa klienta (vlastník priečinka ako pri `registerOwns`, #246). Obrazovka ich len zobrazí (`lehoty-dashboard.tsx`).
 */
import { daysBetween, isOfficeFile, lastSegment } from "../../../../../lawoss/okf/read";
import { isoDay } from "../../../../../lawoss/okf-pamat/src/schema.ts";
import { deadlineText } from "../okf/view-rules";
import type { AgendaEvent } from "./agenda-model";
import type { ClientChoice } from "./client-choice";
import { liteDeadlineLink, liteMatterLink } from "./links";
import { caseDates, dayTone, invalidCaseDates, taskLink, type DayTone, type TodayModel, type TodayTask } from "./today-model";

/** Lehota aj termín prípadu bez ohľadu na vzdialenosť: register ukazuje všetko, nie 14 dní ako Dnes. */
export const LEHOTY_HORIZON_DAYS = 36_500;
/** Spec: každá skupina najviac osem riadkov, potom „Zobraziť všetky (N)“. */
export const GROUP_ROWS = 8;

export type LehotyKind = "all" | "deadlines" | "tasks";
export const LEHOTY_KINDS: readonly LehotyKind[] = ["all", "deadlines", "tasks"];
/** Pôvod riadku; „z listiny“ ani „návrh asistenta“ model nemá, preto tu nie sú. */
export type LehotyOrigin = "recorded" | "instruction" | "work" | "task" | "candidate";
export type LehotyGroupId = "invalid" | "overdue" | "week" | "later";
export const LEHOTY_GROUPS: readonly LehotyGroupId[] = ["invalid", "overdue", "week", "later"];

export type LehotyRow = {
  key: string;
  /** `deadline` evidovaná lehota, `candidate` návrh na potvrdenie, `work` termín úlohy prípadu, `task` úloha appky. */
  kind: "deadline" | "candidate" | "work" | "task";
  title: string;
  /** Platný deň (RRRR-MM-DD); pri neplatnom dátume `null` a pôvodný zápis v `raw`. */
  date: string | null;
  raw?: string;
  daysLeft: number | null;
  tone: DayTone;
  origin: LehotyOrigin;
  group: LehotyGroupId;
  /** „klient · prípad“; prvý prípad a počet ďalších (zdieľaná lehota). */
  place: { client?: string; matter?: string; more: number; office?: true };
  link: string;
  /** Prvý prípad riadku (vlastník pre „Podľa klienta“); úloha appky ho nemá. */
  matterPath?: string;
  appTaskId?: string;
};

const KIND_ORDER: Record<LehotyRow["kind"], number> = { deadline: 0, candidate: 1, work: 2, task: 3 };

const groupOf = (daysLeft: number | null): LehotyGroupId =>
  daysLeft === null ? "invalid" : daysLeft < 0 ? "overdue" : daysLeft <= 7 ? "week" : "later";

const taskPlace = (task: Pick<TodayTask, "matters" | "app">): LehotyRow["place"] => task.app
  ? { ...(task.app.client ? { client: task.app.client } : {}), more: 0 }
  : { ...(task.matters[0]?.client ? { client: task.matters[0].client } : {}), ...(task.matters[0] ? { matter: task.matters[0].title } : {}), more: Math.max(0, task.matters.length - 1) };

/**
 * Všetky riadky registra: evidované lehoty (aj neplatné), termíny úloh prípadov a úloh appky s dátumom, úlohy
 * s nečitateľným dátumom a návrhy na potvrdenie z agendy (do lehôt sa nepočítajú, majú vlastný štítok).
 * Poradie: neplatné navrchu, potom podľa dátumu, lehota pred návrhom a úlohou v ten istý deň.
 */
export function lehotyRows(model: Pick<TodayModel, "deadlines" | "tasks">, events: readonly AgendaEvent[], todayIso: string): LehotyRow[] {
  const deadlines = model.deadlines.map((d, i): LehotyRow => {
    const daysLeft = d.invalid ? null : daysBetween(todayIso, d.date);
    return {
      key: `d:${d.matter.path}\u0000${d.recordId}\u0000${d.date}\u0000${i}`, kind: "deadline", title: deadlineText(d), date: d.invalid ? null : d.date,
      ...(d.invalid ? { raw: d.raw ?? d.date } : {}), daysLeft, tone: dayTone(daysLeft),
      origin: d.basis === "instruction" ? "instruction" : "recorded", group: groupOf(daysLeft),
      place: { ...(d.client ? { client: d.client } : {}), matter: d.matter.title, more: d.alsoIn?.length ?? 0, ...(isOfficeFile(d.file) ? { office: true as const } : {}) },
      link: d.invalid ? liteMatterLink(d.matter.path) : liteDeadlineLink(d.matter.path, d.recordId, d.date), matterPath: d.matter.path,
    };
  });
  const unreadable = invalidCaseDates(model.tasks).map((task): LehotyRow => ({
    key: `u:${task.key}`, kind: "work", title: task.title, date: null, raw: task.due ?? "", daysLeft: null, tone: "red", origin: "work", group: "invalid",
    place: taskPlace(task), link: taskLink(task), ...(task.matters[0] ? { matterPath: task.matters[0].path } : {}),
  }));
  const dated = caseDates(model.tasks, todayIso, LEHOTY_HORIZON_DAYS, model.deadlines).map((task): LehotyRow => ({
    key: `w:${task.key}`, kind: task.app ? "task" : "work", title: task.title, date: task.due, daysLeft: task.daysLeft, tone: dayTone(task.daysLeft),
    origin: task.app ? "task" : "work", group: groupOf(task.daysLeft), place: taskPlace(task), link: taskLink(task),
    ...(task.matters[0] ? { matterPath: task.matters[0].path } : {}), ...(task.app ? { appTaskId: task.id } : {}),
  }));
  const candidates = events.filter((e) => e.kind === "candidate").map((e): LehotyRow => {
    const daysLeft = daysBetween(todayIso, e.date);
    return {
      key: `c:${e.key}`, kind: "candidate", title: e.title, date: e.date, daysLeft, tone: dayTone(daysLeft), origin: "candidate", group: groupOf(daysLeft),
      place: { ...(e.client ? { client: e.client } : {}), matter: e.matter.title, more: 0 }, link: e.link, matterPath: e.matter.path,
    };
  });
  return [...deadlines, ...unreadable, ...dated, ...candidates].sort((a, b) =>
    Number(a.date !== null) - Number(b.date !== null) || (a.date ?? "").localeCompare(b.date ?? "")
    || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title, "cs"));
}

/** Úlohy bez termínu (ani platného, ani nečitateľného): len počet, zbalený riadok „Bez termínu: N“. */
export function undatedTasks(tasks: readonly TodayTask[]): number {
  const unreadable = new Set(invalidCaseDates(tasks).map((task) => task.key));
  return tasks.filter((task) => !isoDay(task.due ?? "") && !unreadable.has(task.key)).length;
}

/** Filter druhu: Lehoty = evidované lehoty a návrhy, Úlohy = termíny úloh prípadov a úlohy appky. */
export const matchesKind = (row: Pick<LehotyRow, "kind">, kind: LehotyKind): boolean =>
  kind === "all" || (kind === "deadlines") === (row.kind === "deadline" || row.kind === "candidate");

export type LehotyGroup = { id: LehotyGroupId; rows: LehotyRow[]; total: number; more: number };

/**
 * Neprázdne skupiny po filtri druhu. Najviac `limit` riadkov, kým skupina nie je rozbalená; neplatné dátumy sa
 * nikdy neskryjú (pravidlo „neplatné navrchu“, Dnes N-A7-4).
 */
export function lehotyGroups(rows: readonly LehotyRow[], kind: LehotyKind, expanded: ReadonlySet<LehotyGroupId> = new Set(), limit = GROUP_ROWS): LehotyGroup[] {
  return LEHOTY_GROUPS.flatMap((id) => {
    const all = rows.filter((row) => row.group === id && matchesKind(row, kind));
    if (all.length === 0) return [];
    const shown = id === "invalid" || expanded.has(id) ? all : all.slice(0, limit);
    return [{ id, rows: shown, total: all.length, more: all.length - shown.length }];
  });
}

/** Tri čísla vedľa nadpisu z tých istých riadkov ako skupiny (bez filtra druhu): po termíne, tento týždeň, na potvrdenie. */
export function lehotySummary(rows: readonly LehotyRow[]): { overdue: number; week: number; confirm: number } {
  return {
    overdue: rows.filter((row) => row.group === "overdue").length,
    week: rows.filter((row) => row.group === "week").length,
    confirm: rows.filter((row) => row.kind === "candidate").length,
  };
}

export type LehotyClient = { id: string; title: string };
type OwnerWorkspace = { id: string; path: string; name?: string; displayNameResolved?: string };

/**
 * Klienti pre výber a „Podľa klienta“: vlastníci priečinkov (ako `registerOwns`, #246), bez koreňa praxe. Meno
 * z karty klienta (`practiceClientChoices`), inak meno priečinka.
 */
export function lehotyClients(owners: readonly OwnerWorkspace[], choices: readonly Pick<ClientChoice, "id" | "title">[], exclude?: string): LehotyClient[] {
  const seen = new Set<string>();
  return owners.flatMap((owner) => {
    if (owner.id === exclude || seen.has(owner.id)) return [];
    seen.add(owner.id);
    return [{ id: owner.id, title: choices.find((c) => c.id === owner.id)?.title || owner.displayNameResolved || owner.name || lastSegment(owner.path) || owner.id }];
  }).sort((a, b) => a.title.localeCompare(b.title, "cs") || a.id.localeCompare(b.id));
}

/**
 * Počty riadkov podľa klienta (najväčší navrchu); riadok patrí klientovi, ktorý vlastní priečinok jeho prípadu,
 * úloha appky klientovi svojho projektu. Klient bez riadkov sa neukáže.
 */
export function clientCounts(rows: readonly LehotyRow[], clients: readonly LehotyClient[], ownerOfMatter: (matterPath: string) => string | null, projectOfTask: (taskId: string) => string | null | undefined): (LehotyClient & { count: number })[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const owner = row.appTaskId ? projectOfTask(row.appTaskId) ?? null : row.matterPath !== undefined ? ownerOfMatter(row.matterPath) : null;
    if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }
  return clients.flatMap((client) => counts.get(client.id) ? [{ ...client, count: counts.get(client.id) ?? 0 }] : [])
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, "cs"));
}

/** Len podklady prípadov vlastného klienta: kandidáti a pokrytie lehôt (#242) by inak rátali aj cudzích. */
export function ownInputs<T extends { matters: readonly { path: string }[]; inputs: readonly { path: string }[] }>(data: T): T {
  const own = new Set(data.matters.map((m) => m.path));
  return { ...data, inputs: data.inputs.filter((input) => own.has(input.path)) };
}
