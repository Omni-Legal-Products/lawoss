/**
 * Klient = natívny projekt (registrovaný priečinok klienta), rozhodnutie MČ 19. 10. 2026.
 * Čistý model bez Reactu: ktoré priečinky sa v sekcii klientov neukážu, ktorý viditeľný projekt
 * vlastní ktorého klienta z prehľadu OKF (podľa cesty na disku) a od ktorého priečinka sa číta prax.
 */
import { addDays, deadlineKey, type MatterOverview } from "../../../../../lawoss/okf/read";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { locateInScope, type OkfReadResult, type OkfScope } from "../okf/read-model";
import { clientFolderFor } from "./client-tree";
import { comparable, folderPath, within } from "./matter-conversations";
import type { ClientGroup } from "./today-model";

type Group = Pick<ClientGroup, "key" | "matters">;
type Workspace = Pick<RouteWorkspace, "id" | "path" | "workspaceType">;

/** Stav prehľadu OKF: číta sa, nedá sa prečítať, alebo je načítaný (rozsah, klienti, veci). */
export type ClientOverviewState =
  | { status: "pending" }
  | { status: "unavailable" }
  | { status: "ready"; scope: OkfScope; groups: readonly Group[]; matters: readonly Pick<MatterOverview, "path">[] };

export type ClientNavModel = {
  /** Projekty, ktoré sekcia klientov (aj pripnuté) neukáže. */
  hidden: ReadonlySet<string>;
  /** Viditeľný projekt, ktorý vlastní klienta z prehľadu (kľúč skupiny → id projektu). */
  ownerOf: ReadonlyMap<string, string>;
  /** Viditeľné projekty, ktoré sú klienti OKF (vlastnia klienta alebo sú členom rozsahu praxe). */
  clients: ReadonlySet<string>;
  /** Registrovaný koreň praxe (jeden priečinok pre všetko alebo kancelária), ak je. */
  practiceRootId: string | null;
  /** Viditeľné lokálne projekty; vlastník priečinka je najhlbší z nich. */
  visible: readonly Workspace[];
};

const isLocal = (w: Workspace): boolean => w.workspaceType !== "remote" && Boolean(w.path);
const strictlyWithin = (outer: string, inner: string): boolean => outer !== inner && within(outer, inner);

/** Absolútny priečinok cesty z prehľadu (voči koreňu rozsahu); mimo rozsahu `null`. */
export function overviewFolder(scope: OkfScope, relative: string): string | null {
  const at = locateInScope(scope, relative);
  return at?.workspace.path ? comparable(folderPath(at.workspace, at.path)) : null;
}

/** Priečinok skupiny klienta v prehľade: karta alebo tvar cesty klienta, inak jej (jediná) vec. */
const groupFolder = (group: Group): string | null =>
  clientFolderFor(group.key, group.matters[0]?.path ?? "") ?? group.matters[0]?.path ?? null;

/** Najhlbší viditeľný projekt, v ktorom priečinok leží; `null` = žiadny. */
export function ownerOfFolder(visible: readonly Workspace[], folder: string): string | null {
  let best: Workspace | null = null;
  for (const w of visible) {
    const dir = comparable(w.path);
    if (within(dir, folder) && (!best || dir.length > comparable(best.path).length)) best = w;
  }
  return best?.id ?? null;
}

/**
 * Čo sekcia klientov ukáže a kto koho vlastní (oprava po review 19. 10. 2026):
 * - bez praxe sa neskrýva nič;
 * - kým sa koreň praxe číta, skryjú sa len kandidáti (priečinok s iným registrovaným v sebe alebo v inom),
 *   aby sa nič neukázalo a hneď nezmizlo;
 * - registrovaná staršia vec (priečinok veci z prehľadu) nie je klient; skryje sa, keď ju pokrýva iný
 *   viditeľný projekt (jej klient alebo koreň), a ani nevlastní klientov;
 * - registrovaný podpriečinok iného klienta sa skryje;
 * - koreň praxe sa skryje, len keď všetkých klientov z prehľadu vlastnia viditeľné registrované projekty
 *   klientov; inak ostane a jeho Prípady ukážu len klientov, ktorých nevlastní nikto iný.
 */
export function clientNavModel(workspaces: readonly Workspace[], practiceRoot: string | null | undefined, overview: ClientOverviewState): ClientNavModel {
  const local = workspaces.filter(isLocal);
  const ready = overview.status === "ready" ? overview : null;
  const groupDir = (group: Group): string | null => {
    const folder = groupFolder(group);
    return ready && folder !== null ? overviewFolder(ready.scope, folder) : null;
  };
  const hidden = new Set<string>();
  let practiceRootId: string | null = null;
  if (practiceRoot === undefined) {
    for (const w of local) {
      const dir = comparable(w.path);
      if (local.some((o) => o.id !== w.id && (strictlyWithin(comparable(o.path), dir) || strictlyWithin(dir, comparable(o.path))))) hidden.add(w.id);
    }
  } else if (practiceRoot) {
    const root = comparable(practiceRoot);
    const inside = local.filter((w) => within(root, comparable(w.path)));
    const roots = inside.filter((w) => comparable(w.path) === root);
    practiceRootId = roots[0]?.id ?? null;
    const others = inside.filter((w) => comparable(w.path) !== root);
    const matterDirs = ready ? ready.matters.flatMap((m) => overviewFolder(ready.scope, m.path) ?? []) : [];
    const isMatter = (w: Workspace) => matterDirs.some((dir) => within(dir, comparable(w.path)));
    const clients = others.filter((w) => !isMatter(w));
    for (const w of clients) {
      if (clients.some((o) => strictlyWithin(comparable(o.path), comparable(w.path)))) hidden.add(w.id);
    }
    const visibleClients = clients.filter((w) => !hidden.has(w.id));
    if (visibleClients.length > 0) {
      const allOwned = ready !== null && ready.groups.every((g) => {
        const dir = groupDir(g);
        return dir !== null && ownerOfFolder(visibleClients, dir) !== null;
      });
      // Prehľad sa ešte číta: koreň sa (zatiaľ) neukáže; nedá sa prečítať: ostane, nikto nezmizne.
      if (overview.status === "pending" || allOwned) for (const w of roots) hidden.add(w.id);
    }
    const containers = [...visibleClients, ...roots.filter((w) => !hidden.has(w.id))];
    for (const w of others.filter(isMatter)) {
      if (containers.some((c) => strictlyWithin(comparable(c.path), comparable(w.path)))) hidden.add(w.id);
    }
  }
  const visible = local.filter((w) => !hidden.has(w.id));
  const ownerOf = new Map<string, string>();
  for (const group of ready?.groups ?? []) {
    const dir = groupDir(group);
    const owner = dir === null ? null : ownerOfFolder(visible, dir);
    if (owner) ownerOf.set(group.key, owner);
  }
  const clients = new Set(ownerOf.values());
  for (const m of ready?.scope.members ?? []) if (!hidden.has(m.workspace.id)) clients.add(m.workspace.id);
  return { hidden, ownerOf, clients, practiceRootId, visible };
}

/**
 * Od ktorého priečinka sa číta prax: otvorený priečinok, ak leží v praxi, inak prvý priečinok praxe;
 * bez praxe otvorený priečinok. Nesúvisiaci otvorený projekt tak neskryje Prípady klientov praxe.
 */
export function clientNavAnchor<W extends Workspace>(workspaces: readonly W[], practiceRoot: string | null | undefined, fallback: W | null): W | null {
  if (!practiceRoot) return fallback;
  const root = comparable(practiceRoot);
  const inPractice = (w: Workspace) => isLocal(w) && within(root, comparable(w.path));
  if (fallback && inPractice(fallback)) return fallback;
  return workspaces.find(inPractice) ?? fallback;
}

/** Register lehôt len pre veci klienta (`owns` podľa priečinka veci); súčty sa počítajú znova ako `buildOverview`. */
export function clientDeadlines(data: OkfReadResult, scope: OkfScope, owns: (matterFolder: string) => boolean, todayIso: string): OkfReadResult {
  const matters = data.matters.filter((m) => {
    const folder = overviewFolder(scope, m.path);
    return folder !== null && owns(folder);
  });
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
