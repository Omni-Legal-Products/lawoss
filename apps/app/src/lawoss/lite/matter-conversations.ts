/**
 * Rozhovory nad klientom a vecou. `openMatterSession` zakladá konverzáciu v priečinku klienta
 * (alebo kancelárie) s priečinkom konverzácie = priečinok veci (od 0ede3fac, 3. 10. 2026).
 *
 * Overené so skutočným enginom 1.18.29 (review 19. 10. 2026): `GET /workspace/:id/sessions`
 * vráti len konverzácie presne v koreni priečinka, nie v podpriečinkoch vecí. Engine však vie
 * vypísať podstrom: `GET /session?path=<cesta voči koreňu projektu>` (celé segmenty, `limit`
 * až po filtri, iní klienti ho neorežú). Čítame cez existujúci proxy priečinka (`/opencode`),
 * ktorý `directory` overí v koreni priečinka. Bez cesty projektu (iný tvar cesty) ostáva
 * presný výpis priečinka a veci sa dočítajú zvlášť.
 */
import { useQueries } from "@tanstack/react-query";
import { isReviewWorkerSession } from "@legalwork/types/reviews";
import { createClient, unwrap } from "@/app/lib/opencode";
import { resolveWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import { normalizeDirectoryPath, normalizeDirectoryQueryPath } from "@/app/utils";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { workspaceSessionRoute } from "@/react-app/shell/workspace-routes";
import type { OkfConnection } from "../okf/connection";
import { activateLocalWorkspace } from "../okf/matter-session";

export type MatterConversation = { workspaceId: string; id: string; title: string | null; updated: number };
/** Položka výpisu konverzácií enginu; `directory` určuje klienta alebo vec. */
export type ListedSession = { id: string; title?: string; directory?: string; time?: { created?: number; updated?: number; archived?: number }; metadata?: unknown };
/**
 * Výpis jedného priečinka. `subtree`: obsahuje aj podpriečinky (veci); inak len presne priečinok.
 * `complete`: engine vrátil menej ako limit, nič staršie nechýba.
 */
export type FolderListing = { workspaceId: string; folder: string; items: readonly ListedSession[]; subtree: boolean; complete: boolean };
/** Priečinok na čítanie: registrovaný priečinok (proxy) a absolútna cesta v ňom. */
export type Folder = { workspace: RouteWorkspace; abs: string };
/** To, čo výpis potrebuje od enginu; v appke `folderEngine`, v testoch náhrada. */
export type FolderEngine = {
  /**
   * Priečinok v tvare enginu (`GET /path`: skutočná cesta za symbolickými odkazmi, diakritika ako na disku),
   * koreň jeho projektu a `projectId` („global“ = priečinky bez vlastného git projektu).
   */
  locate: (folder: string, signal?: AbortSignal) => Promise<{ directory: string; worktree: string; projectId: string | null }>;
  list: (folder: string, query: { path?: string; roots: true; limit: number }, signal?: AbortSignal) => Promise<readonly ListedSession[]>;
};

/** Najnovšie konverzácie priečinka; pri plnom výpise UI nepredstiera, že má všetky. */
export const FOLDER_SESSION_LIMIT = 200;
/** Spoločný kľúč pre strom, detail veci aj prehľad klienta: ten istý priečinok = jedno čítanie. */
export const FOLDER_SESSIONS_KEY = "lite-folder-sessions";

/** Priečinok na porovnanie: veľkosť písmen podľa platformy, diakritika v jednom tvare (NFC; „Ú“ z disku môže prísť rozložené). */
export const comparable = (path: string): string => normalizeDirectoryPath(path.normalize("NFC"));

/** `inner` je `outer` alebo leží v ňom, po celých segmentoch („Spisy/Uhrada2“ nie je v „Spisy/Uhrada“). */
export function within(outer: string, inner: string): boolean {
  if (!outer || !inner) return false;
  return inner === outer || inner.startsWith(outer.endsWith("/") ? outer : `${outer}/`);
}

/** Absolútny priečinok v registrovanom priečinku (`relative` voči nemu, `""` = koreň). */
export function folderPath(workspace: Pick<RouteWorkspace, "path">, relative: string): string {
  const rest = relative.split("/").filter((part) => part && part !== ".").join("/");
  return rest ? `${workspace.path.replace(/[\\/]+$/, "")}/${rest}` : workspace.path;
}

/** Priečinok veci na porovnanie s priečinkom konverzácie. */
export function matterDirectory(workspace: Pick<RouteWorkspace, "path">, matterPath: string): string {
  return comparable(folderPath(workspace, matterPath));
}

/** Cesta priečinka voči koreňu projektu enginu (pole `path` konverzácie); `null`, ak v ňom neleží. */
export function projectRelative(worktree: string, folder: string): string | null {
  // Porovnať podľa platformy (veľkosť písmen), ale vrátiť pôvodný tvar: filter `path` enginu rozlišuje veľkosť písmen.
  const root = normalizeDirectoryPath(worktree);
  const dir = normalizeDirectoryPath(folder);
  const original = normalizeDirectoryQueryPath(folder);
  if (!root || !dir) return null;
  if (root === "/") return dir.startsWith("/") ? original.slice(1) : null;
  if (dir === root) return "";
  return dir.startsWith(`${root}/`) ? original.slice(root.length + 1) : null;
}

/** Ako upstream zoznamy: interné konverzácie posudkov a archivované konverzácie sa neukazujú. */
export const isListedConversation = (s: ListedSession): boolean => !s.time?.archived && !isReviewWorkerSession(s);

/** Tvar na porovnanie aj na skladanie: lomky, bez koncovej lomky, diakritika NFC (veľkosť písmen ostáva). */
const nfcPath = (path: string): string => normalizeDirectoryQueryPath(path.normalize("NFC"));

/** Priečinok konverzácie v tvare enginu → ten istý priečinok v tvare appky (`engineRoot` ↔ `appRoot`); mimo `null`. */
export function rebaseDirectory(directory: string, engineRoot: string, appRoot: string): string | null {
  if (!within(comparable(engineRoot), comparable(directory))) return null;
  const rest = nfcPath(directory).slice(nfcPath(engineRoot).length);
  return `${nfcPath(appRoot)}${rest}`;
}

/**
 * Výpis priečinka. Cestu `path` počíta z tvaru enginu (`GET /path`), nie z cesty v appke: engine ukladá
 * skutočnú cestu (symbolické odkazy, diakritika z disku) a jeho filter porovnáva presne. Položky sa potom
 * prevedú do tvaru appky, aby ich vedel priradiť klientovi a veci. Bez podstromu presne priečinok.
 */
export async function listFolderSessions(engine: FolderEngine, workspaceId: string, folderAbs: string, signal?: AbortSignal): Promise<FolderListing> {
  // Bez tvaru enginu by sa výpis nedal spárovať: radšej chyba (UI ponúkne „Skúsiť znova“) než tichý prázdny zoznam.
  const where = await engine.locate(folderAbs, signal);
  const relative = projectRelative(where.worktree, where.directory);
  // Globálny projekt s koreňom v priečinku (git bez commitu): `path=` by vypísal všetkých klientov a limit by ich orezal.
  // Nevedno, či je projekt globálny: radšej presný výpis.
  const path = relative === "" && where.projectId !== null && where.projectId !== "global" ? "" : relative === "" ? null : relative;
  const items = await engine.list(folderAbs, { ...(path === null ? {} : { path }), roots: true, limit: FOLDER_SESSION_LIMIT }, signal);
  const subtree = path !== null;
  const own = items.flatMap((s): ListedSession[] => {
    const directory = s.directory ? rebaseDirectory(s.directory, where.directory, folderAbs) : null;
    if (!directory || !isListedConversation(s)) return [];
    if (!subtree && comparable(directory) !== comparable(folderAbs)) return [];
    return [{ ...s, directory }];
  });
  return { workspaceId, folder: comparable(folderAbs), items: own, subtree, complete: items.length < FOLDER_SESSION_LIMIT };
}

/** Engine priečinka cez proxy servera (ako `openSessionWithPrompt`); bez spojenia `null`. */
export function folderEngine(connection: Pick<OkfConnection, "baseUrl" | "token">, workspace: RouteWorkspace): FolderEngine | null {
  const endpoint = resolveWorkspaceEndpoint(workspace, { baseUrl: connection.baseUrl, token: connection.token });
  if (!endpoint) return null;
  const client = (directory: string) => createClient(endpoint.opencodeBaseUrl, directory, { token: endpoint.token, mode: "legalwork" });
  return {
    locate: async (folder, signal) => {
      const opencode = client(folder);
      const [where, project] = await Promise.all([
        opencode.path.get({ directory: folder }, { signal }).then(unwrap),
        opencode.project.current({ directory: folder }, { signal }).then(unwrap).catch(() => null),
      ]);
      return { directory: where.directory, worktree: where.worktree, projectId: project?.id ?? null };
    },
    list: async (folder, query, signal) => unwrap(await client(folder).session.list({ directory: folder, ...query }, { signal })),
  };
}

/** Priečinok jedného chatu (tvar servera/enginu) cez read model priečinka; `null` = chat ho nemá. */
export async function readSessionDirectory(connection: Pick<OkfConnection, "baseUrl" | "token">, workspace: RouteWorkspace, sessionId: string, signal?: AbortSignal): Promise<string | null> {
  const endpoint = resolveWorkspaceEndpoint(workspace, { baseUrl: connection.baseUrl, token: connection.token });
  if (!endpoint) throw new Error("no connection");
  const session = unwrap(await createClient(endpoint.opencodeBaseUrl, workspace.path, { token: endpoint.token, mode: "legalwork" }).session.get({ sessionID: sessionId }, { signal }));
  return session.directory || null;
}

export function folderSessionsQuery(connection: Pick<OkfConnection, "baseUrl" | "token" | "client"> | null, folder: Folder) {
  return {
    queryKey: [FOLDER_SESSIONS_KEY, folder.workspace.id, comparable(folder.abs), connection?.baseUrl ?? "", connection?.token ?? ""] as const,
    enabled: Boolean(connection?.client),
    staleTime: 10_000,
    queryFn: ({ signal }: { signal?: AbortSignal }) => {
      const engine = connection ? folderEngine(connection, folder.workspace) : null;
      if (!engine) throw new Error("no connection");
      return listFolderSessions(engine, folder.workspace.id, folder.abs, signal);
    },
  };
}

export type FolderState = { listing?: FolderListing; error: boolean; retry: () => void };

/** Výpisy priečinkov (zdieľaná cache); kľúč mapy = `comparable(abs)`. */
export function useFolderListings(connection: Pick<OkfConnection, "baseUrl" | "token" | "client"> | null, folders: readonly Folder[]): Map<string, FolderState> {
  const results = useQueries({ queries: folders.map((folder) => folderSessionsQuery(connection, folder)) });
  return new Map(folders.map((folder, i) => {
    const result = results[i];
    return [comparable(folder.abs), { listing: result?.data, error: Boolean(result?.isError), retry: () => { void result?.refetch(); } }];
  }));
}

/** Výpis podstromu `folder` pokrýva aj `inner`; presný výpis len sám seba. */
export const covers = (listing: Pick<FolderListing, "folder" | "subtree">, inner: string): boolean =>
  listing.subtree ? within(listing.folder, inner) : listing.folder === inner;

/** Výchozí název upstreamu („New session - …“) není název - UI ukáže „Rozhovor bez názvu“. */
const untitled = (title: string | undefined): boolean => !title?.trim() || /^new session\b/i.test(title.trim());

export type Owners = { clients: readonly { key: string; folder: string | null }[]; matters: readonly { path: string; folder: string | null }[] };
export type Assignment = {
  byClient: ReadonlyMap<string, MatterConversation[]>;
  byMatter: ReadonlyMap<string, MatterConversation[]>;
  /** Kam patrí konverzácia (pre rozbalenie podľa otvorenej konverzácie). */
  owner: ReadonlyMap<string, { client?: string; matter?: string }>;
};

/**
 * Každá konverzácia patrí najhlbšej veci, ktorej priečinok ju obsahuje (aj `…/Uhrada/Podania`);
 * inak najhlbšiemu klientovi (koreň alebo jeho iný podpriečinok). Najnovšia prvá, každá raz.
 */
export function assignConversations(listings: readonly FolderListing[], owners: Owners): Assignment {
  const byClient = new Map<string, MatterConversation[]>();
  const byMatter = new Map<string, MatterConversation[]>();
  const owner = new Map<string, { client?: string; matter?: string }>();
  const deepest = <T extends { folder: string | null }>(list: readonly T[], dir: string) =>
    list.filter((o) => o.folder && within(o.folder, dir)).sort((a, b) => (b.folder?.length ?? 0) - (a.folder?.length ?? 0))[0];
  for (const listing of listings) {
    for (const s of listing.items) {
      if (owner.has(s.id) || !s.directory) continue;
      const dir = comparable(s.directory);
      const conversation = { workspaceId: listing.workspaceId, id: s.id, title: untitled(s.title) ? null : s.title ?? null, updated: s.time?.updated ?? s.time?.created ?? 0 };
      const matter = deepest(owners.matters, dir);
      if (matter) { push(byMatter, matter.path, conversation); owner.set(s.id, { matter: matter.path }); continue; }
      const client = deepest(owners.clients, dir);
      if (client) { push(byClient, client.key, conversation); owner.set(s.id, { client: client.key }); }
    }
  }
  for (const list of [...byClient.values(), ...byMatter.values()]) list.sort((a, b) => b.updated - a.updated);
  return { byClient, byMatter, owner };
}

function push<K>(map: Map<K, MatterConversation[]>, key: K, value: MatterConversation) {
  const list = map.get(key);
  if (list) list.push(value); else map.set(key, [value]);
}

/** Aktivuje priečinok konverzácie (engine, výber) a vráti jej trasu. */
export async function openMatterConversation(connection: OkfConnection, conversation: Pick<MatterConversation, "workspaceId" | "id">): Promise<string> {
  const workspace = connection.workspaces.find((w) => w.id === conversation.workspaceId);
  if (!workspace || !connection.client) throw new Error("conversation workspace unavailable");
  await activateLocalWorkspace({ ...connection, client: connection.client }, workspace, connection.workspaces);
  return workspaceSessionRoute(workspace.id, conversation.id);
}
