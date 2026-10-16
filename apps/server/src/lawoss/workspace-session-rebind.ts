import { relative, resolve, isAbsolute, sep } from "node:path";
import { ApiError } from "../errors.js";
import { resolveWorkspaceOpencodeConnection } from "../opencode-connection.js";
import { realpath } from "./canonical-path.js";
import type { SessionInfoReadModel } from "../session-read-model.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";

/** Supported local OpenCode API; moveChanges:false never transfers source files. */
export async function rebindWorkspaceSessions(config: ServerConfig, previous: WorkspaceInfo, destination: string, sessions: SessionInfoReadModel[]): Promise<() => Promise<void>> {
  const connection = resolveWorkspaceOpencodeConnection(config, previous);
  if (!sessions.length) return async () => {};
  if (!connection.baseUrl) throw new ApiError(422, "workspace_session_rebind_failed", "Project chat engine is unavailable");
  const url = new URL(`${connection.baseUrl.replace(/\/+$/, "")}/experimental/control-plane/move-session`);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new ApiError(422, "workspace_session_rebind_failed", "Project chat recovery requires a local engine");
  const headers = new Headers({ "Content-Type": "application/json", "x-opencode-directory": /[^\x00-\x7f]/.test(destination) ? encodeURIComponent(destination) : destination });
  if (connection.authHeader) headers.set("Authorization", connection.authHeader);
  const moved: Array<{ id: string; directory: string }> = [];
  const move = async (id: string, directory: string) => {
    const response = await fetch(url, { method: "POST", headers, signal: AbortSignal.timeout(10_000), body: JSON.stringify({ sessionID: id, destination: { directory }, moveChanges: false }) });
    if (response.status !== 204) throw new ApiError(422, "workspace_session_rebind_failed", "The local engine could not rebind an existing chat", { status: response.status });
  };
  const rollback = async () => {
    const failures: unknown[] = [];
    for (const session of [...moved].reverse()) try { await move(session.id, session.directory); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, "Project chat recovery rollback failed");
  };
  try {
    for (const session of sessions) {
      if (!session.directory) throw new ApiError(422, "workspace_session_rebind_failed", "Existing chat directory is missing");
      const child = relative(previous.path, session.directory);
      if (isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`)) throw new ApiError(422, "workspace_session_rebind_failed", "Existing chat does not belong to this project");
      const target = await realpath(resolve(destination, child));
      const targetChild = relative(destination, target);
      if (isAbsolute(targetChild) || targetChild === ".." || targetChild.startsWith(`..${sep}`)) throw new ApiError(422, "workspace_session_rebind_failed", "Existing chat folder escapes the recovered project");
      // A dropped response may follow a successful mutation; include attempted moves in rollback.
      moved.push({ id: session.id, directory: session.directory });
      try { await move(session.id, target); }
      catch (error) {
        if (error instanceof ApiError && typeof error.details === "object" && error.details !== null && "status" in error.details && (error.details.status === 404 || error.details.status === 405)) moved.pop();
        throw error;
      }
    }
    return rollback;
  } catch (error) {
    try { await rollback(); }
    catch { throw new ApiError(422, "workspace_recovery_rollback_failed", "Project chat recovery requires reconciliation", { reconciliationRequired: true, workspaceId: previous.id, previousPath: previous.path, destinationPath: destination, sessionIds: moved.map(session => session.id) }); }
    throw error;
  }
}
