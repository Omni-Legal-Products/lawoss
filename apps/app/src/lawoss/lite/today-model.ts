/**
 * Datový model obrazovky „Dnes" a seskupení věcí podle klienta pro LAWOSS-lite.
 * Čistá funkce nad již načteným přehledem (`OkfReadResult`) — nesiaha na disk.
 */
import { addDays, deadlineTier, type DeadlineTier, type MatterOverview, type UpcomingDeadline } from "../../../../../lawoss/okf/read";
import { pendingInputs, type PendingInput } from "../../../../../lawoss/okf/inputs";
import { clientFromPath } from "../../../../../lawoss/okf/cockpit";
import type { OkfReadResult } from "../okf/read-model";

export type TodayDeadline = UpcomingDeadline & { tier: DeadlineTier; daysLeft: number };
export type TodayTask = { key: string; id: string; title: string; due?: string; matters: { path: string; title: string }[] };
export type TodayModel = { deadlines: TodayDeadline[]; tasks: TodayTask[]; inputs: PendingInput[]; recent: MatterOverview[] };
export type ClientGroup = { client: string; matters: MatterOverview[] };

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export function buildToday(result: Pick<OkfReadResult, "matters" | "upcomingDeadlines" | "overdue" | "inputs">, todayIso: string, horizonDays = 14): TodayModel {
  const horizon = addDays(todayIso, horizonDays);
  const deadlines = [...result.overdue, ...result.upcomingDeadlines.filter((d) => d.date <= horizon)]
    .map((d) => ({ ...d, tier: deadlineTier(d.date, todayIso), daysLeft: daysBetween(todayIso, d.date) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  // Úkol sdílený klientem se objeví ve více věcech: identita = id + název + termín.
  const tasks = new Map<string, TodayTask>();
  for (const matter of result.matters) {
    // openTasks už vylučuje hotové i nahrazené/zrušené úkoly (isOpenTask v read.ts).
    for (const task of matter.openTasks) {
      const key = `${task.id}\u0000${task.title}\u0000${task.due ?? ""}`;
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

export function groupByClient(matters: readonly MatterOverview[]): ClientGroup[] {
  const groups = new Map<string, MatterOverview[]>();
  for (const matter of matters) {
    const client = clientFromPath(matter.path) ?? matter.title;
    groups.set(client, [...(groups.get(client) ?? []), matter]);
  }
  return [...groups.entries()].map(([client, list]) => ({ client, matters: list }))
    .sort((a, b) => a.client.localeCompare(b.client, "cs"));
}
