/**
 * Klient = natívny projekt (registrovaný priečinok klienta), rozhodnutie MČ 19. 10. 2026.
 * Čistý model bez Reactu: ktoré priečinky sa v sekcii klientov neukážu, od ktorého priečinka sa
 * číta prax a ktoré veci a lehoty z prehľadu OKF patria ktorému klientovi (podľa cesty na disku).
 */
import { addDays, deadlineKey } from "../../../../../lawoss/okf/read";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { locateInScope, type OkfReadResult, type OkfScope } from "../okf/read-model";
import { clientFolderFor } from "./client-tree";
import { comparable, folderPath, within } from "./matter-conversations";
import type { ClientGroup } from "./today-model";

const isLocal = (w: RouteWorkspace): boolean => w.workspaceType !== "remote" && Boolean(w.path);

/**
 * Priečinky, ktoré nie sú klienti: registrovaný koreň praxe, keď sú pod ním registrovaní klienti,
 * a staršia vec registrovaná zvlášť pod svojím klientom. Platí len vnútri praxe z profilu; bez praxe
 * a pri „jeden priečinok pre všetko“ (koreň je jediný) sa neskrýva nič.
 */
export function hiddenClientProjects(workspaces: readonly RouteWorkspace[], practiceRoot: string | null | undefined): Set<string> {
  const hidden = new Set<string>();
  if (!practiceRoot) return hidden;
  const root = comparable(practiceRoot);
  const inside = workspaces.filter((w) => isLocal(w) && within(root, comparable(w.path)));
  const clients = inside.filter((w) => comparable(w.path) !== root);
  if (clients.length > 0) for (const w of inside) if (comparable(w.path) === root) hidden.add(w.id);
  const containers = inside.filter((w) => !hidden.has(w.id));
  for (const w of clients) {
    const dir = comparable(w.path);
    if (containers.some((c) => comparable(c.path) !== dir && within(comparable(c.path), dir))) hidden.add(w.id);
  }
  return hidden;
}

/**
 * Od ktorého priečinka sa číta prax: otvorený priečinok, ak leží v praxi, inak prvý klient praxe;
 * bez praxe otvorený priečinok. Nesúvisiaci otvorený projekt tak neskryje Prípady klientov praxe.
 */
export function clientNavAnchor(workspaces: readonly RouteWorkspace[], practiceRoot: string | null | undefined, fallback: RouteWorkspace | null): RouteWorkspace | null {
  if (!practiceRoot) return fallback;
  const root = comparable(practiceRoot);
  const inPractice = (w: RouteWorkspace) => isLocal(w) && within(root, comparable(w.path));
  if (fallback && inPractice(fallback)) return fallback;
  const hidden = hiddenClientProjects(workspaces, practiceRoot);
  return workspaces.find((w) => inPractice(w) && !hidden.has(w.id)) ?? fallback;
}

/** Leží cesta z prehľadu (voči koreňu rozsahu) v priečinku `workspace`? */
export function inWorkspace(scope: OkfScope, workspace: Pick<RouteWorkspace, "path" | "workspaceType">, relative: string): boolean {
  if (workspace.workspaceType === "remote" || !workspace.path) return false;
  const at = locateInScope(scope, relative);
  if (!at?.workspace.path) return false;
  return within(comparable(workspace.path), comparable(folderPath(at.workspace, at.path)));
}

/** Priečinok skupiny klienta v prehľade: karta alebo tvar cesty klienta, inak jej (jediná) vec. */
const groupFolder = (group: Pick<ClientGroup, "key" | "matters">): string | null =>
  clientFolderFor(group.key, group.matters[0]?.path ?? "") ?? group.matters[0]?.path ?? null;

/**
 * Klienti z prehľadu, ktorých priečinok leží v projekte: jeden pri klientovi praxe, viac pri
 * „jeden priečinok pre všetko“ (koreň kancelárie ukáže prípady zoskupené podľa klientov).
 */
export function clientGroupsOf<G extends Pick<ClientGroup, "key" | "matters">>(scope: OkfScope, workspace: Pick<RouteWorkspace, "path" | "workspaceType">, groups: readonly G[]): G[] {
  return groups.filter((group) => {
    const folder = groupFolder(group);
    return folder !== null && inWorkspace(scope, workspace, folder);
  });
}

/** Projekt je klient OKF: člen rozsahu praxe alebo obsahuje klienta z prehľadu. Cudzí projekt nedostane Prípady ani Lehoty. */
export function isClientProject(scope: OkfScope, workspace: Pick<RouteWorkspace, "id" | "path" | "workspaceType">, groups: readonly Pick<ClientGroup, "key" | "matters">[]): boolean {
  return scope.members.some((m) => m.workspace.id === workspace.id) || clientGroupsOf(scope, workspace, groups).length > 0;
}

/** Register lehôt len pre veci klienta; súčty sa počítajú znova rovnako ako `buildOverview`. */
export function clientDeadlines(data: OkfReadResult, scope: OkfScope, workspace: Pick<RouteWorkspace, "path" | "workspaceType">, todayIso: string): OkfReadResult {
  const matters = data.matters.filter((m) => inWorkspace(scope, workspace, m.path));
  const own = new Set(matters.map((m) => m.path));
  const upcomingDeadlines = data.upcomingDeadlines.filter((d) => own.has(d.matter.path));
  const overdue = data.overdue.filter((d) => own.has(d.matter.path));
  const week = addDays(todayIso, 7);
  return {
    ...data,
    matters,
    upcomingDeadlines,
    overdue,
    totals: {
      ...data.totals,
      matters: matters.length,
      deadlinesWithin7Days: new Set(upcomingDeadlines.filter((d) => !d.invalid && d.date <= week).map(deadlineKey)).size,
      overdue: new Set(overdue.map(deadlineKey)).size,
      openTasks: matters.reduce((sum, m) => sum + m.openTasks.length, 0),
    },
  };
}
