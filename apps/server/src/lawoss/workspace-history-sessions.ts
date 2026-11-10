import { ApiError, findApiError } from "../errors.js";
import { createEngineClient } from "../engine-client.js";
import { resolveWorkspaceOpencodeConnection } from "../opencode-connection.js";
import type { SessionInfoReadModel } from "../session-read-model.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { workspaceOwnsSessionDirectory, workspaceOwnsSession } from "./workspace-history.js";

/** Engine v2 session listing is global (no implicit project scope); every record is filtered
 * here by its location before it leaves the server. Archived and active chats are both listed:
 * the v2 `archived` filter is omitted, which selects every record.
 */
export async function historicalWorkspaceSessions(config: ServerConfig, workspace: WorkspaceInfo, input: { roots?: boolean; start?: number; search?: string } = {}, captureRoot?: string): Promise<SessionInfoReadModel[]> {
  if (!workspace.previousPaths?.length) return [];
  const connection = resolveWorkspaceOpencodeConnection(config, workspace);
  if (!connection.baseUrl) return [];
  if (captureRoot && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection.baseUrl).hostname)) throw new ApiError(422, "workspace_session_rebind_failed", "Project chat recovery requires a local engine");
  const client = createEngineClient(config, workspace);
  const sessions = new Map<string, SessionInfoReadModel>();
  let cursor: string | undefined;
  const owned = (session: SessionInfoReadModel) => {
    const directory = session.location.directory;
    return captureRoot
      ? workspaceOwnsSessionDirectory({ ...workspace, path: captureRoot, previousPaths: [] }, directory)
      : workspaceOwnsSession(workspace, { id: session.id, directory });
  };
  for (let page = 0; page < 20; page++) {
    const response = await client.session.list({ limit: 1000, ...(input.roots ? { parentID: null } : {}),
      ...(input.search ? { search: input.search } : {}), ...(cursor ? { cursor } : {}) }, { signal: AbortSignal.timeout(10_000) })
      .catch((error: unknown) => { throw new ApiError(502, "workspace_history_unavailable", "Historical project chats could not be read", { status: findApiError(error)?.status ?? null }); });
    for (const session of response.data) {
      if (input.start !== undefined && session.time.updated < input.start) continue;
      if (owned(session)) sessions.set(session.id, session);
    }
    const next = response.cursor.next ?? undefined;
    if (!next || response.data.length < 1000) return [...sessions.values()];
    if (next === cursor) break;
    cursor = next;
  }
  throw new ApiError(502, "workspace_history_unavailable", "Historical chat listing exceeded its safe paging bound");
}
