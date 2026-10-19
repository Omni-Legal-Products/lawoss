/**
 * „Pokračovat, kde jsem skončil“: konverzace nad věcí. Od 3. 10. 2026 (0ede3fac) ji
 * `openMatterSession` zakládá v priečinku klienta (alebo kancelárie) s priečinkom
 * konverzácie = priečinok veci; server ju vráti v zozname klienta (`workspaceOwnsSession`
 * berie aj podpriečinky). Staršie veci mali vlastný registrovaný priečinok - ten sa číta tiež.
 */
import { normalizeDirectoryPath } from "@/app/utils";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { workspaceSessionRoute } from "@/react-app/shell/workspace-routes";
import type { OkfConnection } from "../okf/connection";
import { activateLocalWorkspace } from "../okf/matter-session";
import { officeWorkspace } from "../okf/read-model";

export type MatterConversation = { workspaceId: string; id: string; title: string | null; updated: number };
/** Položka zo zoznamu konverzácií priečinka (`GET /workspace/:id/sessions`); `directory` určuje vec. */
export type ListedSession = { id: string; title?: string; directory?: string; time?: { created?: number; updated?: number } };
export type WorkspaceSessions = { workspaceId: string; items: readonly ListedSession[] };
type SessionLister = { listSessions: (workspaceId: string, options: { roots: boolean; limit: number }) => Promise<{ items: readonly ListedSession[] }> };

/** Najnovšie konverzácie priečinka; server ich zoradí podľa zmeny a oreže. Staršie veci veľkého klienta môžu vypadnúť. */
export const WORKSPACE_SESSION_LIMIT = 200;

/** Registrovaná složka věci: kancelář + relativní cesta věci. Bez registrace (žádná akce) = `null`. */
export function matterWorkspace(workspaces: readonly RouteWorkspace[], office: RouteWorkspace | null, matterPath: string): RouteWorkspace | null {
  if (!office?.path || office.workspaceType === "remote") return null;
  const target = matterDirectory(office, matterPath);
  return workspaces.find((w) => w.workspaceType !== "remote" && w.path && comparable(w.path) === target) ?? null;
}

/** Priečinok na porovnanie: veľkosť písmen podľa platformy, diakritika v jednom tvare (NFC; „Ú“ z disku môže prísť rozložené). */
const comparable = (path: string): string => normalizeDirectoryPath(path.normalize("NFC"));

/** Priečinok veci na porovnanie s priečinkom konverzácie. */
export function matterDirectory(workspace: Pick<RouteWorkspace, "path">, matterPath: string): string {
  const relative = matterPath.split("/").filter((part) => part && part !== ".").join("/");
  return comparable(relative ? `${workspace.path.replace(/[\\/]+$/, "")}/${relative}` : workspace.path);
}

/** Výchozí název upstreamu („New session - …“) není název - UI ukáže „Konverzace bez názvu“. */
const untitled = (title: string | undefined): boolean => !title?.trim() || /^new session\b/i.test(title.trim());

/** Konverzácie, ktorých priečinok je presne priečinok veci; najnovšia prvá, každá raz. */
export function conversationsInDirectory(lists: readonly WorkspaceSessions[], directory: string): MatterConversation[] {
  const byId = new Map<string, MatterConversation>();
  for (const list of lists) {
    for (const s of list.items) {
      if (byId.has(s.id) || !s.directory || comparable(s.directory) !== directory) continue;
      byId.set(s.id, { workspaceId: list.workspaceId, id: s.id, title: untitled(s.title) ? null : s.title ?? null, updated: s.time?.updated ?? s.time?.created ?? 0 });
    }
  }
  return [...byId.values()].sort((a, b) => b.updated - a.updated);
}

/** Hlavné konverzácie priečinka (bez podúloh agenta). */
export async function listWorkspaceSessions(client: SessionLister, workspaceId: string): Promise<WorkspaceSessions> {
  const { items } = await client.listSessions(workspaceId, { roots: true, limit: WORKSPACE_SESSION_LIMIT });
  return { workspaceId, items };
}

/** Priečinky, v ktorých môžu byť konverzácie veci: jej klient (kancelária) a starší registrovaný priečinok veci. */
export function matterSessionSources(workspaces: readonly RouteWorkspace[], base: RouteWorkspace | null, matterPath: string): RouteWorkspace[] {
  if (!base?.path || base.workspaceType === "remote") return [];
  const legacy = matterWorkspace(workspaces, base, matterPath);
  return legacy && legacy.id !== base.id ? [base, legacy] : [base];
}

/** `base`: priečinok, voči ktorému je `matterPath`; v praxi priečinok klienta veci (N1), inak kancelária. */
export async function listMatterConversations(connection: OkfConnection, matterPath: string, limit = 5, base: RouteWorkspace | null = officeWorkspace(connection)): Promise<MatterConversation[]> {
  const client = connection.client;
  const sources = matterSessionSources(connection.workspaces, base, matterPath);
  if (!client || !base || sources.length === 0) return [];
  const lists = await Promise.all(sources.map((w) => listWorkspaceSessions(client, w.id)));
  return conversationsInDirectory(lists, matterDirectory(base, matterPath)).slice(0, limit);
}

/** Aktivuje složku věci (engine, výběr) a vrátí trasu konverzace. */
export async function openMatterConversation(connection: OkfConnection, conversation: MatterConversation): Promise<string> {
  const workspace = connection.workspaces.find((w) => w.id === conversation.workspaceId);
  if (!workspace || !connection.client) throw new Error("conversation workspace unavailable");
  await activateLocalWorkspace({ ...connection, client: connection.client }, workspace, connection.workspaces);
  return workspaceSessionRoute(workspace.id, conversation.id);
}
