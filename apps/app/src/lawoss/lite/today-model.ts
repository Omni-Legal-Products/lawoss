/**
 * Datový model obrazovky „Dnes" a seskupení věcí podle klienta pro LAWOSS-lite.
 * Čistá funkce nad již načteným přehledem (`OkfReadResult`) — nesiaha na disk.
 */
import { addDays, daysBetween, deadlineTier, lastSegment, recordKey, type DeadlineTier, type MatterInput, type MatterOverview, type UpcomingDeadline } from "../../../../../lawoss/okf/read";
import { pendingInputs, type PendingInput } from "../../../../../lawoss/okf/inputs";
import { clientFromPath } from "../../../../../lawoss/okf/cockpit";
import type { OkfReadResult } from "../okf/read-model";

/** `alsoIn`: další věci, do kterých patří tatáž lhůta ze sdíleného souboru (klient, kancelář). */
export type TodayDeadline = UpcomingDeadline & { tier: DeadlineTier; daysLeft: number; alsoIn?: { path: string; title: string }[] };
type TodayTask = { key: string; id: string; title: string; due?: string; matters: { path: string; title: string }[] };
export type TodayModel = { deadlines: TodayDeadline[]; tasks: TodayTask[]; inputs: PendingInput[]; recent: MatterOverview[] };
export type ClientGroup = { client: string; matters: MatterOverview[] };


export function buildToday(result: Pick<OkfReadResult, "matters" | "upcomingDeadlines" | "overdue" | "inputs">, todayIso: string, horizonDays = 14): TodayModel {
  const horizon = addDays(todayIso, horizonDays);
  // Lhůta ze sdíleného souboru přijde jednou za každou věc; ukázat ji jednou a vyjmenovat věci.
  const all: (UpcomingDeadline & { alsoIn?: { path: string; title: string }[] })[] = [];
  const byKey = new Map<string, (typeof all)[number]>();
  for (const d of [...result.overdue, ...result.upcomingDeadlines]) {
    const key = `${recordKey(d.matter.path, { id: d.recordId, file: d.file })}\u0000${d.date}`;
    const seen = byKey.get(key);
    if (seen) { (seen.alsoIn ??= []).push({ path: d.matter.path, title: d.matter.title }); continue; }
    const entry = { ...d };
    byKey.set(key, entry);
    all.push(entry);
  }
  // Neplatné datum nejde zařadit do 14 dnů ani spočítat — ukáže se vždy a nahoře, k ověření.
  const invalid = all.filter((d) => d.invalid).map((d) => ({ ...d, tier: "today" as const, daysLeft: 0 }));
  const dated = all.filter((d) => !d.invalid && d.date <= horizon)
    .map((d) => ({ ...d, tier: deadlineTier(d.date, todayIso), daysLeft: daysBetween(todayIso, d.date) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const deadlines = [...invalid, ...dated];
  // Úkol ze sdíleného souboru se objeví ve více věcech: identita = soubor (ID se razí per spis).
  const tasks = new Map<string, TodayTask>();
  for (const matter of result.matters) {
    // openTasks už vylučuje hotové i nahrazené/zrušené úkoly (isOpenTask v read.ts).
    for (const task of matter.openTasks) {
      const key = recordKey(matter.path, task);
      const entry = tasks.get(key) ?? { key, id: task.id, title: task.title, due: task.due, matters: [] };
      entry.matters.push({ path: matter.path, title: matter.title });
      tasks.set(key, entry);
    }
  }
  const recent = [...result.matters].sort((a, b) => (b.lastEvent?.date ?? "").localeCompare(a.lastEvent?.date ?? ""));
  return {
    deadlines,
    tasks: [...tasks.values()].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")),
    inputs: result.inputs.flatMap(pendingInputs),
    recent,
  };
}

const OFFICE_DIR = /(^|\/)(Office|_kancelaria)$/;

/**
 * Klient věci: složka klienta, kterou už našlo čtení paměti (`client.md`/`klient.md` nebo
 * `client_path` v okf.config) — funguje pro `Klienti/Novák/…` i `AK/N/Novák/…`.
 * Bez ní tvar cesty `AK/<písmeno>/<klient>`, jinak věc sama.
 */
export function groupByClient(matters: readonly MatterOverview[], inputs: readonly Pick<MatterInput, "path" | "scopePaths">[] = []): ClientGroup[] {
  const scopes = new Map(inputs.map((i) => [i.path, i.scopePaths ?? []]));
  const groups = new Map<string, ClientGroup>();
  for (const matter of matters) {
    const clientDir = scopes.get(matter.path)?.slice(1).find((dir) => dir && !OFFICE_DIR.test(dir));
    const client = clientDir ? lastSegment(clientDir) : clientFromPath(matter.path) ?? matter.title;
    const key = clientDir ?? client;
    const group = groups.get(key) ?? { client, matters: [] };
    group.matters.push(matter);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.client.localeCompare(b.client, "cs"));
}

/** Nejbližší lhůta dnes nebo později — prošlá ani neplatná se jako „další“ neukazuje. */
export function nextDeadline(deadlines: readonly { date: string; invalid?: true }[], todayIso: string): string | undefined {
  return deadlines.filter((d) => !d.invalid && d.date >= todayIso).map((d) => d.date).sort()[0];
}
