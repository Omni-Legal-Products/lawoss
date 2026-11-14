/**
 * Datový model obrazovky „Dnes" a seskupení věcí podle klienta pro LAWOSS-lite.
 * Čistá funkce nad již načteným přehledem (`OkfReadResult`) - nesiaha na disk.
 */
import { addDays, daysBetween, deadlineKey, deadlineTier, lastSegment, recordKey, scopeLevels, taskDue, type DeadlineTier, type MatterInput, type MatterOverview, type UpcomingDeadline } from "../../../../../lawoss/okf/read";
import type { PendingInput } from "../../../../../lawoss/okf/inputs";
import { unfiledInputs } from "./inputs-model";
import { clientFromPath } from "../../../../../lawoss/okf/cockpit";
import type { OkfReadResult } from "../okf/read-model";
import { HORIZON_DAYS, isCalendarDay, urgencyOf } from "../okf/view-rules";
import type { AgendaEvent } from "./agenda-model";
import { APP_TASKS_PATH, liteMatterLink } from "./links";
import { taskDueDateInputValue } from "@/react-app/domains/tasks/task-format";
import { isoDay } from "../../../../../lawoss/okf-pamat/src/schema.ts";

/** `alsoIn`: další věci, do kterých patří tatáž lhůta ze sdíleného souboru (klient, kancelář). */
/** `client`: meno klienta prípadu (rovnaké pravidlo ako pri úlohách), ak sa líši od prípadu; riadok „klient · prípad“. */
export type TodayDeadline = UpcomingDeadline & { tier: DeadlineTier; daysLeft: number; alsoIn?: { path: string; title: string }[]; client?: string };
export type TodayTask = {
  key: string; id: string; title: string; due?: string; matters: { path: string; title: string; client?: string }[];
  /** Úloha aplikácie (Nová úloha), nie úloha prípadu z pamäte (N-A5-4); `client` = meno klienta, ku ktorému patrí. */
  app?: { client?: string };
};

/** Úloha aplikácie, ako ju vráti server (`LegalworkTask`), len polia, ktoré Dnes potrebuje. */
export type AppTask = { id: string; title: string; status: string; dueDate: string | null; projectId?: string | null; deletedAt: string | null };

/**
 * N-A5-4 (test 25. 10. 2026): úloha z „Nová úloha“ (natívne úlohy aplikácie) sa na Dnes, v mesiaci ani na osi
 * neukázala, lebo Dnes čítal len úlohy prípadov z pamäte. Otvorené úlohy aplikácie (nie hotové, zrušené ani v Koši)
 * sa pridajú k úlohám; `clientOf` dá meno klienta podľa projektu úlohy.
 */
export function appTodayTasks(tasks: readonly AppTask[], clientOf: (projectId: string) => string | undefined = () => undefined): TodayTask[] {
  return tasks.filter((task) => (task.status === "open" || task.status === "in_progress") && !task.deletedAt).map((task) => {
    const client = task.projectId ? clientOf(task.projectId) : undefined;
    // Deň v miestnom čase ako v paneli Úlohy (termín s časom „2026-10-25T23:30Z“ je v Bratislave 26. 10.).
    const due = taskDueDateInputValue(task.dueDate);
    return { key: `app:${task.id}`, id: task.id, title: task.title, ...(due ? { due } : {}), matters: [], app: client ? { client } : {} };
  });
}

/** Kam vedie úloha alebo termín: úloha aplikácie do panela Úlohy, úloha prípadu do jej (prvého) prípadu. */
export const taskLink = (task: Pick<TodayTask, "id" | "matters" | "app">): string =>
  task.app ? APP_TASKS_PATH : liteMatterLink(task.matters[0]?.path ?? "");
/** Termín z prípadu: otvorená úloha s platným dátumom (`due`), nie evidovaná lehota. */
export type CaseDate = TodayTask & { due: string; daysLeft: number };

/**
 * N-A2-11 (rozhodnutie MČ 23. 10. 2026): Dnes ukazuje termíny z prípadov oddelene od evidovaných lehôt. Termín je
 * otvorená úloha prípadu s platným dátumom v najbližších `days` dňoch alebo už uplynulý (M049-T1 do 25. 10.).
 * Dátum s časom („2026-10-25 10:00“, pojednávanie) sa berie podľa dňa, tým istým pravidlom ako lehoty (`isoDay`).
 */
export function caseDates(tasks: readonly TodayTask[], todayIso: string, days: number, deadlines: readonly Pick<TodayDeadline, "recordId" | "matter" | "alsoIn" | "date">[] = []): CaseDate[] {
  const last = addDays(todayIso, days - 1);
  // #242: termín úlohy, ktorý je zároveň jej evidovanou lehotou (ten istý deň), je už medzi lehotami; medzi termínmi
  // by bol dvakrát. Iný dátum úlohy (zajtrajšie pojednávanie pri lehote o 10 dní) ostáva termínom (#251).
  const recorded = new Set(deadlines.flatMap((d) => [d.matter, ...(d.alsoIn ?? [])].map((m) => `${m.path}\u0000${d.recordId}\u0000${d.date}`)));
  return tasks.flatMap((task) => {
    const due = isoDay(task.due ?? "");
    if (!due || due > last) return [];
    if (task.matters.some((m) => recorded.has(`${m.path}\u0000${task.id}\u0000${due}`))) return [];
    return [{ ...task, due, daysLeft: daysBetween(todayIso, due) }];
  })
    .sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title, "cs"));
}
/**
 * N-A7-4 (rozhodnutie MČ 31. 10. 2026): úloha prípadu s neplatným dátumom („31. 2. 2026“) patrí aj navrch „Termínov
 * z prípadov“ s výzvou „overiť dátum“, nie len do „Otvorených úloh“. Úloha bez dátumu nie je neplatná.
 */
export function invalidCaseDates(tasks: readonly TodayTask[]): TodayTask[] {
  return tasks.filter((task) => !task.app && taskDue(task.due).invalid);
}
/**
 * Riadky „Termínov z prípadov“, keď sa všetky nezmestia (#276): miesto dostane najprv termín dnes a zajtra, potom
 * včerajší, potom ostatné podľa dátumu (najstaršie zmeškané najprv). Inak desať augustových úloh vytlačilo zajtrajšie
 * pojednávanie za „+N ďalšie“. Vybrané riadky ostanú zoradené podľa dátumu.
 */
export function caseDateRows<T extends Pick<CaseDate, "daysLeft">>(dates: readonly T[], rows: number): T[] {
  const rank = (d: T) => d.daysLeft === 0 || d.daysLeft === 1 ? 0 : d.daysLeft === -1 ? 1 : 2;
  const shown = new Set([...dates].sort((a, b) => rank(a) - rank(b)).slice(0, rows));
  return dates.filter((d) => shown.has(d));
}
/** Blok „Začnite tu“ (spec 0020): jeden najbližší konkrétny krok, lehota alebo pracovný termín. */
export type StartHere = { kind: "deadline"; item: TodayDeadline } | { kind: "work"; item: CaseDate };

/**
 * Poradie: lehota po termíne → lehota dnes → pracovný termín po termíne alebo dnes → lehota do 7 dní → najbližší
 * pracovný termín. Neplatný dátum lehoty nie je krok (ukazuje ho zoznam lehôt k overeniu).
 */
export function startHere(deadlines: readonly TodayDeadline[], dates: readonly CaseDate[]): StartHere | null {
  const dated = deadlines.filter((d) => !d.invalid);
  const deadline = (pick: (d: TodayDeadline) => boolean): StartHere | null => {
    const item = dated.find(pick);
    return item ? { kind: "deadline", item } : null;
  };
  const work = (pick: (d: CaseDate) => boolean): StartHere | null => {
    const item = dates.find(pick);
    return item ? { kind: "work", item } : null;
  };
  return deadline((d) => d.tier === "overdue") ?? deadline((d) => d.daysLeft === 0) ?? work((d) => d.daysLeft <= 0)
    ?? deadline((d) => d.daysLeft <= 7) ?? work(() => true);
}
/** Prípad pre karty „Pokračovať“: `client` = meno klienta (rovnaké pravidlo ako pri úlohách), ak sa líši od prípadu. */
export type TodayMatter = MatterOverview & { client?: string };
export type TodayModel = { deadlines: TodayDeadline[]; tasks: TodayTask[]; inputs: PendingInput[]; recent: TodayMatter[] };
/** `key` je jedinečný aj pri dvoch klientoch s rovnakým menom; `client` "" = klient bez názvu v karte. */
export type ClientGroup = { key: string; client: string; matters: MatterOverview[] };


export function buildToday(result: Pick<OkfReadResult, "matters" | "upcomingDeadlines" | "overdue" | "inputs"> & Partial<Pick<OkfReadResult, "clients">>, todayIso: string, horizonDays = HORIZON_DAYS, appTasks: readonly TodayTask[] = []): TodayModel {
  const horizon = addDays(todayIso, horizonDays);
  // Lhůta ze sdíleného souboru přijde jednou za každou věc; ukázat ji jednou a vyjmenovat věci.
  const all: (UpcomingDeadline & { alsoIn?: { path: string; title: string }[] })[] = [];
  const byKey = new Map<string, (typeof all)[number]>();
  for (const d of [...result.overdue, ...result.upcomingDeadlines]) {
    const key = deadlineKey(d);
    const seen = byKey.get(key);
    if (seen) { (seen.alsoIn ??= []).push({ path: d.matter.path, title: d.matter.title }); continue; }
    const entry = { ...d };
    byKey.set(key, entry);
    all.push(entry);
  }
  // Neplatné datum nejde zařadit do 14 dnů ani spočítat - ukáže se vždy a nahoře, k ověření.
  const invalid = all.filter((d) => d.invalid).map((d) => ({ ...d, tier: "today" as const, daysLeft: 0 }));
  const dated = all.filter((d) => !d.invalid && d.date <= horizon)
    .map((d) => ({ ...d, tier: deadlineTier(d.date, todayIso), daysLeft: daysBetween(todayIso, d.date) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  // N-A5-9: termín prípadu nesie aj meno klienta (bez neho bol riadok len „<prípad> zákazka SYN-00xx“).
  const inputs = new Map(result.inputs.map((input) => [input.path, input]));
  const clientName = (matter: Pick<MatterOverview, "path" | "title">): string | undefined => {
    const name = clientOf(matter, inputs.get(matter.path)).name;
    return name && name !== matter.title ? name : undefined;
  };
  const deadlines = [...invalid, ...dated].map((d) => { const client = clientName(d.matter); return client ? { ...d, client } : d; });
  // Úkol ze sdíleného souboru se objeví ve více věcech: identita = soubor (ID se razí per spis).
  const tasks = new Map<string, TodayTask>();
  for (const matter of result.matters) {
    const client = clientName(matter);
    // openTasks už vylučuje hotové i nahrazené/zrušené úkoly (isOpenTask v read.ts).
    for (const task of matter.openTasks) {
      const key = recordKey(matter.path, task);
      const entry = tasks.get(key) ?? { key, id: task.id, title: task.title, due: task.due, matters: [] };
      entry.matters.push({ path: matter.path, title: matter.title, ...(client ? { client } : {}) });
      tasks.set(key, entry);
    }
  }
  const recent = [...result.matters].sort((a, b) => (b.lastEvent?.date ?? "").localeCompare(a.lastEvent?.date ?? ""))
    .map((matter): TodayMatter => { const client = clientName(matter); return client ? { ...matter, client } : matter; });
  return {
    deadlines,
    tasks: [...tasks.values(), ...appTasks].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")),
    // N-A3-2: len vstupy, ktorých súbor ešte nie je v žiadnom prípade (`inputs-model.ts`).
    inputs: unfiledInputs(result),
    recent,
  };
}


/**
 * Klient věci: složka klienta, kterou už našlo čtení paměti (`client.md`/`klient.md` nebo
 * `client_path` v okf.config) - funguje pro `Klienti/Novák/…` i `AK/N/Novák/…`.
 * Bez ní tvar cesty `AK/<písmeno>/<klient>`, jinak věc sama.
 */
export function groupByClient(
  matters: readonly MatterOverview[],
  inputs: readonly Pick<MatterInput, "path" | "scopePaths" | "clientTitle">[] = [],
  clients: readonly { path: string; title?: string }[] = [],
): ClientGroup[] {
  const byPath = new Map(inputs.map((i) => [i.path, i]));
  const groups = new Map<string, ClientGroup>();
  for (const matter of matters) {
    const { key, name } = clientOf(matter, byPath.get(matter.path));
    const group = groups.get(key) ?? { key, client: name ?? "", matters: [] };
    group.matters.push(matter);
    groups.set(key, group);
  }
  // Klient s kartou, ale zatiaľ bez vecí: rovnaký kľúč ako `clientOf`, aby sa s vecami nezdvojil.
  for (const client of clients) {
    const key = `client:${client.path}`;
    if (!groups.has(key)) groups.set(key, { key, client: client.title?.trim() || (client.path ? lastSegment(client.path) : ""), matters: [] });
  }
  return [...groups.values()].sort((a, b) => a.client.localeCompare(b.client, "cs") || a.key.localeCompare(b.key));
}

/**
 * Jediné miesto, ktoré určuje klienta veci (Klienti aj drobček v detaile): karta klienta,
 * jeho priečinok, tvar cesty `AK/<písmeno>/<klient>`. Klient v koreni priečinka bez názvu
 * v karte ostane bez mena (`name` undefined) - nikdy sa nepomenuje podľa veci.
 */
export function clientOf(matter: Pick<MatterOverview, "path" | "title">, input?: Pick<MatterInput, "scopePaths" | "clientTitle">): { key: string; name?: string } {
  const scope = scopeLevels(input?.scopePaths ?? []).find((s) => s.level === "client");
  if (scope) return { key: `client:${scope.path}`, name: input?.clientTitle?.trim() || (scope.path ? lastSegment(scope.path) : undefined) };
  const fromPath = clientFromPath(matter.path);
  return fromPath ? { key: `path:${fromPath}`, name: fromPath } : { key: `matter:${matter.path}`, name: matter.title };
}

/** Nejbližší lhůta dnes nebo později - prošlá ani neplatná se jako „další“ neukazuje. */
export function nextDeadline(deadlines: readonly { date: string; invalid?: true }[], todayIso: string): string | undefined {
  return deadlines.filter((d) => !d.invalid && d.date >= todayIso).map((d) => d.date).sort()[0];
}

// ── Dnes ako pasívny prehľad (alfa 14, spec-dnes.md) ─────────────────────────
// Všetko nižšie sú čisté odvodenia nad už načítaným modelom; obrazovka ich len zobrazí.

/** Farba štvorčeka dní: po termíne, neplatný dátum a do 3 dní červená, do 7 dní jantárová, inak neutrálna. */
export type DayTone = "red" | "amber" | "neutral";
export const dayTone = (daysLeft: number | null): DayTone =>
  daysLeft === null || daysLeft <= 3 ? "red" : daysLeft <= 7 ? "amber" : "neutral";

/** Dlaždica „Najbližšia lehota“: `model.deadlines[0]`, bez lehoty najbližší termín z prípadu, inak nič. */
export type NearestTile =
  | { kind: "deadline"; item: TodayDeadline; state: "invalid" | "overdue" | "due" }
  | { kind: "work"; item: CaseDate; state: "passed" | "due" }
  | { kind: "none" };

export function nearestTile(deadlines: readonly TodayDeadline[], dates: readonly CaseDate[]): NearestTile {
  const first = deadlines[0];
  // Neplatný dátum nesie umelé `daysLeft: 0`; rozhoduje `invalid`, nie číslo.
  if (first) return { kind: "deadline", item: first, state: first.invalid ? "invalid" : first.tier === "overdue" ? "overdue" : "due" };
  // Uplynulý termín má prednosť (zoradené podľa dátumu), ako pri úvode; úloha aplikácie nie je termín z prípadu.
  const work = dates.find((d) => !d.app);
  return work ? { kind: "work", item: work, state: work.daysLeft < 0 ? "passed" : "due" } : { kind: "none" };
}

/** Dlaždica „Tento týždeň“: lehoty, ktoré nie sú v pokoji (rovnaké pravidlo ako farby), a termíny do 7 dní. */
export function weekCounts(deadlines: readonly TodayDeadline[], dates: readonly CaseDate[], todayIso: string): { deadlines: number; dates: number } {
  return {
    deadlines: deadlines.filter((d) => urgencyOf(d.date, todayIso, d.invalid) !== "calm").length,
    dates: dates.filter((d) => d.daysLeft >= 0 && d.daysLeft <= 7).length,
  };
}

/**
 * „Čaká na vás“: na zaradenie, po termíne (lehota aj termín), na overenie (lehota podľa pokynu, neplatný dátum
 * lehoty alebo úlohy) a návrhy na potvrdenie z agendy. Každá položka sa počíta raz: po termíne má prednosť.
 */
export type Waiting = { filing: number; overdue: number; verify: number; confirm: number; total: number };

export function waitingCounts(input: { inputs: number; deadlines: readonly TodayDeadline[]; dates: readonly CaseDate[]; unreadable: readonly TodayTask[]; events?: readonly Pick<AgendaEvent, "kind">[] }): Waiting {
  const overdueDeadlines = input.deadlines.filter((d) => !d.invalid && d.tier === "overdue");
  const overdue = overdueDeadlines.length + input.dates.filter((d) => d.daysLeft < 0).length;
  const verify = input.deadlines.filter((d) => d.invalid || (d.basis === "instruction" && !overdueDeadlines.includes(d))).length + input.unreadable.length;
  const confirm = (input.events ?? []).filter((e) => e.kind === "candidate").length;
  return { filing: input.inputs, overdue, verify, confirm, total: input.inputs + overdue + verify + confirm };
}

/** Riadok „Čo horí“: evidovaná lehota, termín z prípadu (aj úloha aplikácie) alebo úloha s nečitateľným dátumom. */
export type HotOrigin = "instruction" | "recorded" | "work";
export type HotRow =
  | { kind: "deadline"; key: string; item: TodayDeadline; origin: Exclude<HotOrigin, "work">; daysLeft: number | null; tone: DayTone }
  | { kind: "work"; key: string; item: CaseDate; origin: "work"; daysLeft: number; tone: DayTone }
  | { kind: "unreadable"; key: string; item: TodayTask; origin: "work"; daysLeft: null; tone: DayTone };

const hotDate = (row: HotRow): string => row.kind === "deadline" ? row.item.date : row.kind === "work" ? row.item.due : "";

/**
 * Najviac `limit` riadkov „Čo horí“ a počet ďalších. Miesto dostane najprv neplatný dátum (N-A7-4), lehota alebo
 * termín po termíne, dnes a zajtra, potom ostatné evidované lehoty, včerajší termín a nakoniec ostatné termíny
 * (#276: staré zmeškané úlohy nevytlačia zajtrajšie pojednávanie ani evidovanú lehotu). Vybrané riadky ostanú
 * zoradené: neplatné navrchu, potom podľa dátumu, lehota pred termínom v ten istý deň.
 */
export function hotRows(deadlines: readonly TodayDeadline[], dates: readonly CaseDate[], unreadable: readonly TodayTask[], limit: number): { rows: HotRow[]; more: number } {
  const all: HotRow[] = [
    ...deadlines.map((item, i): HotRow => {
      const daysLeft = item.invalid ? null : item.daysLeft;
      return { kind: "deadline", key: `d:${item.matter.path}\u0000${item.recordId}\u0000${item.date}\u0000${i}`, item, origin: item.basis === "instruction" ? "instruction" : "recorded", daysLeft, tone: dayTone(daysLeft) };
    }),
    ...unreadable.map((item): HotRow => ({ kind: "unreadable", key: `u:${item.key}`, item, origin: "work", daysLeft: null, tone: "red" })),
    ...dates.map((item): HotRow => ({ kind: "work", key: `w:${item.key}`, item, origin: "work", daysLeft: item.daysLeft, tone: dayTone(item.daysLeft) })),
  ];
  const rank = (row: HotRow): number => {
    if (row.daysLeft === null) return 0;
    if (row.kind === "deadline") return row.daysLeft <= 1 ? 0 : 1;
    if (row.daysLeft === 0 || row.daysLeft === 1) return 0;
    return row.daysLeft === -1 ? 2 : 3;
  };
  const shown = new Set([...all].sort((a, b) => rank(a) - rank(b)).slice(0, Math.max(0, limit)));
  const order = (row: HotRow): number => row.daysLeft === null ? 0 : 1;
  const rows = all.filter((row) => shown.has(row)).sort((a, b) =>
    order(a) - order(b) || hotDate(a).localeCompare(hotDate(b)) || Number(a.kind !== "deadline") - Number(b.kind !== "deadline"));
  return { rows, more: all.length - rows.length };
}

/**
 * Jedna veta pod pozdravom o najbližšej lehote alebo termíne (#242: počet prípadov bez lehôt už nie je tu, ale pod
 * „Čo horí“). Poradie: naliehavá lehota (neplatná, po termíne, do 7 dní) → termín z prípadu po termíne alebo do 7 dní
 * (N-A2-11: „nič nehorí“ nezamlčí zajtrajšie pojednávanie) → výhrada neúplného čítania → vzdialenejšia lehota →
 * vzdialenejší termín → „lehoty nie sú evidované“ alebo prázdny stav. Úloha aplikácie nie je termín z prípadu (N-A5-4);
 * uplynulý termín má prednosť (zoradené podľa dátumu).
 */
export type TodayLead =
  | { kind: "deadline"; item: TodayDeadline }
  | { kind: "partial" }
  | { kind: "date"; item: CaseDate }
  | { kind: "unrecorded" }
  | { kind: "quiet" };

export function todayLead(deadlines: readonly TodayDeadline[], dates: readonly CaseDate[], evidence?: { complete: boolean; recorded: number }): TodayLead {
  const first = deadlines[0];
  const date = dates.find((d) => !d.app);
  if (first && (first.invalid || first.tier !== "later")) return { kind: "deadline", item: first };
  if (date && date.daysLeft <= 7) return { kind: "date", item: date };
  if (evidence && !evidence.complete) return { kind: "partial" };
  if (first) return { kind: "deadline", item: first };
  if (date) return { kind: "date", item: date };
  return evidence && evidence.recorded === 0 ? { kind: "unrecorded" } : { kind: "quiet" };
}

/** Najbližší pracovný termín prípadu (úloha s platným dátumom dnes alebo neskôr). */
export function nextWorkDate(matter: Pick<MatterOverview, "openTasks">, todayIso: string): string | undefined {
  return matter.openTasks.map((task) => task.due?.trim().slice(0, 10) ?? "").filter((due) => isCalendarDay(due) && due >= todayIso).sort()[0];
}

/**
 * Karta „Pokračovať“: klient, prípad, štítok najbližšej lehoty (bez nej pracovného termínu, nikdy zmeškanej lehoty
 * ako termínu), stav prípadu, ak ho karta má, a posledná udalosť alebo počet otvorených úloh. Kroky „3 z 5“ nie:
 * fáza prípadu v dátach nie je.
 */
export type ContinueCard = {
  path: string; title: string; client?: string; state?: string;
  next: { kind: "deadline" | "work"; date: string; daysLeft: number; tone: DayTone } | null;
  line: { kind: "event"; text: string } | { kind: "tasks"; count: number } | null;
};

export function continueCard(matter: TodayMatter, todayIso: string): ContinueCard {
  const deadline = nextDeadline(matter.deadlines, todayIso);
  const work = deadline ? undefined : nextWorkDate(matter, todayIso);
  const date = deadline ?? work;
  const daysLeft = date ? daysBetween(todayIso, date) : 0;
  const event = matter.lastEvent?.text.trim();
  return {
    path: matter.path,
    title: matter.title,
    ...(matter.client ? { client: matter.client } : {}),
    ...(matter.state?.trim() ? { state: matter.state.trim() } : {}),
    next: date ? { kind: deadline ? "deadline" : "work", date, daysLeft, tone: deadline ? dayTone(daysLeft) : "neutral" } : null,
    line: event ? { kind: "event", text: event } : matter.openTasks.length ? { kind: "tasks", count: matter.openTasks.length } : null,
  };
}
