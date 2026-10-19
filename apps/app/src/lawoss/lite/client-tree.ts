/**
 * Strom v bočnom paneli (variant A, MČ 19. 10. 2026): klient → vec → rozhovory veci.
 * Klienti a veci sú z už načítaného prehľadu (ako Klienti a veci), rozhovory z priečinka
 * veci (`matter-conversations.ts`). Rozbalený je len klient a vec, kde práve som (podľa trasy);
 * šípkou sa dá rozbaliť alebo zbaliť ktorýkoľvek. Čistý model bez Reactu.
 */
import { matchPath } from "react-router-dom";
import type { MatterOverview } from "../../../../../lawoss/okf/read";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import type { ClientGroup } from "./today-model";
import { LITE_CLIENTS_PATH, LITE_MATTER_PATH } from "./links";
import { conversationsInDirectory, matterDirectory, type MatterConversation, type WorkspaceSessions } from "./matter-conversations";

/** Rozhovory pod vecou; viac ukáže detail veci („Zobraziť všetky“). */
export const TREE_CONVERSATION_LIMIT = 5;

/** Kde práve som: vec, klient alebo konverzácia (tú treba ešte priradiť k veci cez jej priečinok). */
export type TreeFocus = { client?: string; matter?: string; session?: { workspaceId: string; sessionId: string } };
export type TreeMatter = Pick<MatterOverview, "path" | "title" | "deadlines"> & {
  expanded: boolean; current: boolean; conversations: readonly MatterConversation[]; more: boolean; canStart: boolean;
};
export type TreeClient = { key: string; title: string; expanded: boolean; current: boolean; matters: readonly TreeMatter[] };
/** Vec z prehľadu → priečinok (klient alebo kancelária), v ktorom leží, a cesta v ňom (`locateInScope`). */
export type Locate = (matterPath: string) => { workspace: RouteWorkspace; path: string } | null;

/** Kľúče používateľských prepnutí; kľúče skupín (`client:`, `path:`, `matter:`) sa s cestami vecí nesmú zraziť. */
export const clientToggle = (key: string): string => `c\u0000${key}`;
export const matterToggle = (path: string): string => `m\u0000${path}`;

const SESSION_ROUTE = "/workspace/:workspaceId/session/:sessionId";

export function routeFocus(pathname: string, search: string): TreeFocus {
  const params = new URLSearchParams(search);
  if (pathname === LITE_MATTER_PATH) { const matter = params.get("vec"); return matter ? { matter } : {}; }
  if (pathname === LITE_CLIENTS_PATH) { const client = params.get("klient"); return client ? { client } : {}; }
  const session = matchPath(SESSION_ROUTE, pathname)?.params;
  return session?.workspaceId && session.sessionId ? { session: { workspaceId: session.workspaceId, sessionId: session.sessionId } } : {};
}

/**
 * Konverzácia → vec podľa jej priečinka; konverzácia nad celým klientom (praxou) rozbalí
 * len klienta, ak sú všetky veci toho priečinka u jedného klienta. Nenačítaný zoznam = nič.
 */
export function sessionFocus(
  session: NonNullable<TreeFocus["session"]>,
  lists: readonly WorkspaceSessions[],
  matters: readonly { path: string; at: ReturnType<Locate> }[],
  groups: readonly ClientGroup[] = [],
): Pick<TreeFocus, "client" | "matter"> {
  const found = lists.find((l) => l.workspaceId === session.workspaceId)?.items.find((s) => s.id === session.sessionId);
  if (!found?.directory) return {};
  const own = matters.filter((m) => m.at?.workspace.id === session.workspaceId);
  const hit = own.find((m) => m.at && conversationsInDirectory([{ workspaceId: session.workspaceId, items: [found] }], matterDirectory(m.at.workspace, m.at.path)).length > 0);
  if (hit) return { matter: hit.path };
  const owners = new Set(own.map((m) => groups.find((g) => g.matters.some((x) => x.path === m.path))?.key));
  const [client] = [...owners];
  return owners.size === 1 && client ? { client } : {};
}

export function buildClientTree({ groups, focus, overrides, conversations, canStart }: {
  groups: readonly ClientGroup[];
  focus: Pick<TreeFocus, "client" | "matter">;
  overrides: Readonly<Record<string, boolean>>;
  /** Všetky rozhovory veci, najnovší prvý; `undefined`, kým sa nenačítali. */
  conversations: (matterPath: string) => readonly MatterConversation[] | undefined;
  /** Vec leží v priečinku, v ktorom sa dá založiť rozhovor (ako rýchla akcia na detaile veci). */
  canStart: (matterPath: string) => boolean;
}): TreeClient[] {
  const focusClient = focus.client ?? groups.find((g) => g.matters.some((m) => m.path === focus.matter))?.key;
  return groups.map((group) => {
    const current = group.key === focusClient;
    const expanded = overrides[clientToggle(group.key)] ?? current;
    const matters = group.matters.map((m): TreeMatter => {
      const here = m.path === focus.matter;
      const open = overrides[matterToggle(m.path)] ?? here;
      // Rozhovory len pre rozbalenú vec rozbaleného klienta: zbalené sa nečítajú.
      const all = expanded && open ? conversations(m.path) ?? [] : [];
      return {
        path: m.path, title: m.title, deadlines: m.deadlines, expanded: open, current: here,
        conversations: all.slice(0, TREE_CONVERSATION_LIMIT), more: all.length > TREE_CONVERSATION_LIMIT, canStart: canStart(m.path),
      };
    });
    return { key: group.key, title: group.client, expanded, current, matters };
  });
}

/**
 * Priečinky, ktorých zoznam konverzácií treba čítať: len pre viditeľné rozbalené veci
 * a pre priečinok práve otvorenej konverzácie. 24 zbalených klientov = žiadne čítanie.
 */
export function workspacesToFetch(tree: readonly TreeClient[], locate: Locate, sessionWorkspaceId?: string, extra: (matterPath: string) => readonly string[] = () => []): string[] {
  const ids = new Set<string>();
  if (sessionWorkspaceId) ids.add(sessionWorkspaceId);
  for (const client of tree) {
    if (!client.expanded) continue;
    for (const m of client.matters) {
      if (!m.expanded) continue;
      const at = locate(m.path);
      if (at) ids.add(at.workspace.id);
      for (const id of extra(m.path)) ids.add(id);
    }
  }
  return [...ids];
}
