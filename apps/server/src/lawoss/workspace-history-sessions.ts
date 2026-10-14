import { ApiError } from "../errors.js";
import { resolveWorkspaceOpencodeConnection } from "../opencode-connection.js";
import { sessionInfoSchema, type SessionInfoReadModel } from "../session-read-model.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { workspaceOwnsSessionDirectory, workspaceOwnsSession } from "./workspace-history.js";

/** OpenCode 1.18.29 /session remains project-scoped after a non-Git folder move.
 * The global read API is filtered here before any record leaves the server.
 * No query directory is sent: runtime context stays at the current root.
 */
export async function historicalWorkspaceSessions(config: ServerConfig, workspace: WorkspaceInfo, input: { roots?: boolean; start?: number; search?: string } = {}, captureRoot?: string): Promise<SessionInfoReadModel[]> {
  if (!workspace.previousPaths?.length) return [];
  const connection = resolveWorkspaceOpencodeConnection(config, workspace);
  if (!connection.baseUrl) return [];
  if (captureRoot && !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection.baseUrl).hostname)) throw new ApiError(422, "workspace_session_rebind_failed", "Project chat recovery requires a local engine");
  const headers = new Headers({ "x-opencode-directory": /[^\x00-\x7f]/.test(workspace.path) ? encodeURIComponent(workspace.path) : workspace.path });
  if (connection.authHeader) headers.set("Authorization", connection.authHeader);
  const sessions = new Map<string, SessionInfoReadModel>();
  let cursor: number | undefined;
  for (let page = 0; page < 20; page++) {
    const url = new URL(`${connection.baseUrl.replace(/\/+$/, "")}/experimental/session`);
    url.searchParams.set("limit", "1000");
    // Native unarchive uses time.archived=0. The pinned engine's default
    // global listing selects SQL NULL only; include archived metadata so
    // reconnect captures zero/null/archived history before ownership filtering.
    url.searchParams.set("archived", "true");
    if (cursor !== undefined) url.searchParams.set("cursor", String(cursor));
    if (input.roots !== undefined) url.searchParams.set("roots", String(input.roots));
    if (input.start !== undefined) url.searchParams.set("start", String(input.start));
    if (input.search) url.searchParams.set("search", input.search);
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new ApiError(502, "workspace_history_unavailable", "Historical project chats could not be read", { status: response.status });
    const parsed = sessionInfoSchema.array().safeParse(await response.json());
    if (!parsed.success) throw new ApiError(502, "workspace_history_unavailable", "Historical chat response is invalid");
    for (const session of parsed.data) if (captureRoot ? session.directory && workspaceOwnsSessionDirectory({ ...workspace, path: captureRoot, previousPaths: [] }, session.directory) : workspaceOwnsSession(workspace, session)) sessions.set(session.id, session);
    if (parsed.data.length < 1000) return [...sessions.values()];
    const next = parsed.data.at(-1)?.time?.updated;
    if (next === undefined || next === cursor) break;
    cursor = next;
  }
  throw new ApiError(502, "workspace_history_unavailable", "Historical chat listing exceeded its safe paging bound");
}
