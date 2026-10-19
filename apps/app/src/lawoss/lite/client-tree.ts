/**
 * Strom v bočnom paneli (variant A, MČ 19. 10. 2026): klient → (jeho rozhovory) → vec → rozhovory veci.
 * Klienti a veci sú z už načítaného prehľadu (ako Klienti a veci), rozhovory z výpisu priečinka
 * klienta (`matter-conversations.ts`). Rozbalený je len klient a vec, kde práve som (podľa trasy);
 * šípkou sa dá rozbaliť alebo zbaliť ktorýkoľvek. Čistý model bez Reactu.
 */
import { matchPath } from "react-router-dom";
import type { MatterOverview } from "../../../../../lawoss/okf/read";
import type { ClientGroup } from "./today-model";
import { LITE_CLIENTS_PATH, LITE_MATTER_PATH } from "./links";
import { comparable, type Assignment, type Folder, type FolderListing, type MatterConversation } from "./matter-conversations";

/** Rozhovory pod klientom aj vecou; viac ukáže prehľad klienta alebo detail veci („Zobraziť všetky“). */
export const TREE_CONVERSATION_LIMIT = 5;

/** Kde práve som: vec, klient alebo konverzácia (tú treba priradiť cez jej priečinok). */
export type TreeFocus = { client?: string; matter?: string; session?: { workspaceId: string; sessionId: string } };
/** Rozhovory jedného uzla: `complete` = nič staršie nechýba; `error` sa nesmie tváriť ako prázdny zoznam. */
export type ConversationList = { items: readonly MatterConversation[]; status: "loading" | "error" | "ready"; complete: boolean; retry?: () => void };
type Listed = { conversations: readonly MatterConversation[]; more: boolean; status: ConversationList["status"]; retry?: () => void };
export type TreeMatter = Pick<MatterOverview, "path" | "title" | "deadlines"> & Listed & { expanded: boolean; current: boolean; canStart: boolean };
export type TreeClient = Listed & { key: string; title: string; expanded: boolean; current: boolean; matters: readonly TreeMatter[] };

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

/** Otvorená konverzácia → jej vec alebo klient podľa priečinka (aj staršia vec s vlastným priečinkom). Nenačítané = nič. */
export function sessionFocus(route: TreeFocus, assignment: Pick<Assignment, "owner">): Pick<TreeFocus, "client" | "matter"> {
  const owner = route.session ? assignment.owner.get(route.session.sessionId) : undefined;
  return owner ? { ...owner } : {};
}

/**
 * Priečinok klienta (cesta v prehľade) podľa kľúča skupiny z `clientOf`: karta klienta (`client:`),
 * tvar `AK/<písmeno>/<klient>` (`path:`); vec bez klienta (`matter:`) žiadny nemá.
 */
export function clientFolderFor(key: string, matterPath: string): string | null {
  if (key.startsWith("client:")) return key.slice("client:".length);
  if (key.startsWith("path:")) {
    const parts = matterPath.split("/");
    return parts[0] === "AK" && parts[2] === key.slice("path:".length) ? parts.slice(0, 3).join("/") : null;
  }
  return null;
}

/** Trasa sa presunula na uzol: jeho prepnutie (aj prepnutie jeho klienta) sa zabudne, aby ho trasa rozbalila. */
export function clearFocusOverrides(overrides: Readonly<Record<string, boolean>>, focus: Pick<TreeFocus, "client" | "matter">, groups: readonly ClientGroup[]): Readonly<Record<string, boolean>> {
  const client = focus.client ?? groups.find((g) => g.matters.some((m) => m.path === focus.matter))?.key;
  const drop = [client ? clientToggle(client) : null, focus.matter ? matterToggle(focus.matter) : null].filter((k): k is string => k !== null && k in overrides);
  if (drop.length === 0) return overrides;
  return Object.fromEntries(Object.entries(overrides).filter(([key]) => !drop.includes(key)));
}

const listed = (list: ConversationList | undefined, open: boolean): Listed => {
  if (!open || !list) return { conversations: [], more: false, status: "ready" };
  return {
    conversations: list.items.slice(0, TREE_CONVERSATION_LIMIT),
    more: list.items.length > TREE_CONVERSATION_LIMIT || (list.status === "ready" && !list.complete && list.items.length > 0),
    status: list.status,
    retry: list.retry,
  };
};

export function buildClientTree({ groups, focus, overrides, lists, canStart }: {
  groups: readonly ClientGroup[];
  focus: Pick<TreeFocus, "client" | "matter">;
  overrides: Readonly<Record<string, boolean>>;
  /** Rozhovory klienta (jeho koreň a podpriečinky mimo vecí) a veci; pýta sa len na rozbalené uzly. */
  lists: { client: (key: string) => ConversationList | undefined; matter: (path: string) => ConversationList | undefined };
  /** Dá sa vo veci založiť rozhovor (tá istá kontrola ako akcia); pýta sa len na rozbalené veci. */
  canStart: (matterPath: string) => boolean;
}): TreeClient[] {
  const focusClient = focus.client ?? groups.find((g) => g.matters.some((m) => m.path === focus.matter))?.key;
  return groups.map((group) => {
    const current = group.key === focusClient;
    const expanded = overrides[clientToggle(group.key)] ?? current;
    const matters = group.matters.map((m): TreeMatter => {
      const here = m.path === focus.matter;
      const open = overrides[matterToggle(m.path)] ?? here;
      const visible = expanded && open;
      return { path: m.path, title: m.title, deadlines: m.deadlines, expanded: open, current: here, canStart: visible && canStart(m.path), ...listed(visible ? lists.matter(m.path) : undefined, visible) };
    });
    return { key: group.key, title: group.client, expanded, current, matters, ...listed(expanded ? lists.client(group.key) : undefined, expanded) };
  });
}

/**
 * Čo čítať: podstrom priečinka každého rozbaleného klienta (jeden výpis na klienta, veci v ňom),
 * priečinok otvorenej konverzácie a — len ak engine podstrom nevie — presne priečinok rozbalenej veci.
 * 24 zbalených klientov = žiadne čítanie.
 */
export function fetchPlan(
  tree: readonly TreeClient[],
  folders: { client: (key: string) => Folder | null; matter: (path: string) => Folder | null },
  listingOf: (folder: string) => Pick<FolderListing, "subtree" | "folder"> | undefined,
  sessionFolder?: Folder | null,
): Folder[] {
  const plan = new Map<string, Folder>();
  const add = (folder: Folder | null | undefined) => { if (folder) plan.set(comparable(folder.abs), folder); };
  add(sessionFolder);
  for (const client of tree) {
    if (!client.expanded) continue;
    const root = folders.client(client.key);
    add(root);
    const listing = root ? listingOf(comparable(root.abs)) : undefined;
    for (const m of client.matters) {
      if (!m.expanded) continue;
      // Klient bez priečinka (vec je sama sebe klientom) alebo engine bez podstromu: priečinok veci zvlášť.
      if (!root || (listing && !listing.subtree)) add(folders.matter(m.path));
    }
  }
  return [...plan.values()];
}
