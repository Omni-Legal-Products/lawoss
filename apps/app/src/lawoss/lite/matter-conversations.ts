/**
 * „Pokračovat, kde jsem skončil“: konverzace nad věcí žijí ve složce věci (rychlá akce
 * ji registruje). Tady je najdeme a znovu otevřeme — bez nové konverzace.
 */
import { normalizeDirectoryPath } from "@/app/utils";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { workspaceSessionRoute } from "@/react-app/shell/workspace-routes";
import type { OkfConnection } from "../okf/connection";
import { activateLocalWorkspace } from "../okf/matter-session";
import { officeWorkspace } from "../okf/read-model";

export type MatterConversation = { workspaceId: string; id: string; title: string | null; updated: number };

/** Registrovaná složka věci: kancelář + relativní cesta věci. Bez registrace (žádná akce) = `null`. */
export function matterWorkspace(workspaces: readonly RouteWorkspace[], office: RouteWorkspace | null, matterPath: string): RouteWorkspace | null {
  if (!office?.path || office.workspaceType === "remote") return null;
  const target = normalizeDirectoryPath(`${office.path}/${matterPath}`);
  return workspaces.find((w) => w.workspaceType !== "remote" && w.path && normalizeDirectoryPath(w.path) === target) ?? null;
}

/** Výchozí název upstreamu („New session - …“) není název — UI ukáže „Konverzace bez názvu“. */
const untitled = (title: string | undefined): boolean => !title?.trim() || /^new session\b/i.test(title.trim());

export async function listMatterConversations(connection: OkfConnection, matterPath: string, limit = 5): Promise<MatterConversation[]> {
  const workspace = matterWorkspace(connection.workspaces, officeWorkspace(connection), matterPath);
  if (!workspace || !connection.client) return [];
  const { items } = await connection.client.listSessions(workspace.id, { roots: true, limit });
  return items
    .map((s) => ({ workspaceId: workspace.id, id: s.id, title: untitled(s.title) ? null : s.title, updated: s.time?.updated ?? s.time?.created ?? 0 }))
    .sort((a, b) => b.updated - a.updated)
    .slice(0, limit);
}

/** Aktivuje složku věci (engine, výběr) a vrátí trasu konverzace. */
export async function openMatterConversation(connection: OkfConnection, conversation: MatterConversation): Promise<string> {
  const workspace = connection.workspaces.find((w) => w.id === conversation.workspaceId);
  if (!workspace || !connection.client) throw new Error("conversation workspace unavailable");
  await activateLocalWorkspace({ ...connection, client: connection.client }, workspace, connection.workspaces);
  return workspaceSessionRoute(workspace.id, conversation.id);
}
