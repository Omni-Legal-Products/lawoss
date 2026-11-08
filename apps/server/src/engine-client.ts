import { OpenCode, type OpenCodeClient, type SessionInfo, type SessionListInput, type SessionMessageInfo } from "@opencode/client";
import { canonicalFilePath } from "./file-write-lock.js";
import { ApiError, findApiError } from "./errors.js";
import { nativeResponseError } from "./native-delivery.js";
import { awaitRegisteredEngineProjects } from "./project-engine-registration.js";
import { resolveWorkspaceOpencodeConnection } from "./opencode-connection.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { assertEngineProjectReady } from "./engine-project.js";
import { recoverSessionMcp } from "./workspace-mcp-recovery.js";
import { ensureLegacySessionPermissions } from "./session-history-permissions.js";
import { workspaceOwnsChat } from "./lawoss/session-ownership.js";

// LAWOSS: the server config of each client this module made, for the chat ownership check below.
const engineClientConfigs = new WeakMap<OpenCodeClient, ServerConfig>();

/** The native v2 client returns domain values directly and throws on failure.
 * Location is explicit on location-scoped operations; a session routes through
 * its saved location. Never change a process-global default for another project. */
export function createEngineClient(config: ServerConfig, workspace: WorkspaceInfo): OpenCodeClient {
  const { baseUrl, authHeader } = resolveWorkspaceOpencodeConnection(config, workspace);
  if (!baseUrl) throw new ApiError(503, "opencode_unavailable", "The agent engine is not available for this project.");
  const client: OpenCodeClient = OpenCode.make({ baseUrl, ...(authHeader ? { headers: { Authorization: authHeader } } : {}),
    fetch: Object.assign(async (request: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url);
      const method = (init?.method ?? (request instanceof Request ? request.method : "GET")).toUpperCase();
      const passive = method === "GET" && (url.pathname === "/api/info" || url.pathname === "/api/event" || /^\/api\/session\/[^/]+$/.test(url.pathname))
        || method === "POST" && (/^\/api\/session\/[^/]+\/interrupt$/.test(url.pathname) || /\/legalwork\.commands\/cancel$/.test(url.pathname));
      if (!passive) {
        await awaitRegisteredEngineProjects(config);
        await assertEngineProjectReady(config, workspace);
      }
      assertManagedHistoryReadable(config, method, url.pathname);
      let response: Response;
      const sessionID = method === "POST" ? url.pathname.match(/^\/api\/session\/([^/]+)\/(?:prompt|command|synthetic|shell|compact|fork|generate)$/)?.[1] : undefined;
      const perform = async () => {
        const result = await fetch(request, init);
        await config.observeManagedEngineResponse?.({ method, path: url.pathname, directory: url.searchParams.get("location[directory]") || workspaceEngineLocation(workspace).directory }, result);
        return result;
      };
      const signal = init?.signal ?? (request instanceof Request ? request.signal : undefined);
      // LAWOSS (RAM 2 GB, #367): a server request that builds a location (its plugins and MCP) goes through the MCP budget.
      const releaseMcp = await config.lawossEngineMcpAdmission?.({ method, path: url.pathname,
        directory: url.searchParams.get("location[directory]") || workspaceEngineLocation(workspace).directory, ...(sessionID ? { sessionID } : {}) });
      try {
        if (sessionID) await ensureLegacySessionPermissions(config, workspace, client, sessionID);
        if (sessionID && /\/(?:prompt|command)$/.test(url.pathname)) {
          await recoverSessionMcp(config, workspace, sessionID, signal ?? undefined);
        }
        response = config.withManagedEngineAdmission && !["GET", "HEAD"].includes(method)
          ? await config.withManagedEngineAdmission(sessionID ?? "", perform) : await perform();
      }
      catch (error) {
        if (error instanceof ApiError) throw error;
        if (signal?.aborted) throw error;
        const unavailable = new ApiError(503, "opencode_unavailable", "The agent engine could not be reached. Start it or reconnect before trying again.");
        unavailable.cause = error;
        throw unavailable;
      }
      finally { releaseMcp?.(); }
      if (response.ok) return response;
      const status = response.status;
      const text = await response.text();
      let detail: unknown = text;
      try { detail = JSON.parse(text); } catch { /* Keep non-JSON diagnostics. */ }
      throw nativeResponseError(status, detail);
    }, { preconnect: fetch.preconnect }),
  });
  engineClientConfigs.set(client, config);
  return client;
}

export function workspaceEngineLocation(workspace: WorkspaceInfo): { directory: string } {
  return { directory: workspace.directory?.trim() || workspace.path };
}

/** A session ID alone is never proof that a caller can access its project. */
export async function getWorkspaceEngineSession(client: OpenCodeClient, workspace: WorkspaceInfo, sessionID: string): Promise<SessionInfo> {
  const session = await client.session.get({ sessionID }).catch(error => { throw findApiError(error) ?? error; });
  // LAWOSS: a case chat in a case subfolder belongs to its client; a chat of a client nested in
  // this one does not (lawoss/session-ownership.ts). A client without a known config keeps the exact match.
  const config = engineClientConfigs.get(client);
  if (config) {
    if (!await workspaceOwnsChat(config, workspace, { id: session.id, directory: session.location.directory })) throw new ApiError(404, "session_not_found", "This chat does not belong to the project.");
    return session;
  }
  const [expected, actual] = await Promise.all([
    canonicalFilePath(workspaceEngineLocation(workspace).directory),
    canonicalFilePath(session.location.directory),
  ]);
  if (expected !== actual) throw new ApiError(404, "session_not_found", "This chat does not belong to the project.");
  return session;
}

export async function getWorkspaceEngineSessionOrNull(client: OpenCodeClient, workspace: WorkspaceInfo, sessionID: string): Promise<SessionInfo | null> {
  try { return await getWorkspaceEngineSession(client, workspace, sessionID); }
  catch (error) { if (findApiError(error)?.status === 404) return null; throw error; }
}

/** Native lists are paginated. An omitted application limit means all pages,
 * not the engine's first page. A supplied UI page size never caps model context. */
export async function listEngineSessions(client: OpenCodeClient, input: SessionListInput = {}): Promise<SessionInfo[]> {
  const result: SessionInfo[] = [];
  const seen = new Set<string>();
  let cursor = input.cursor;
  do {
    const page = await client.session.list({ ...(cursor ? { cursor } : input), ...(input.limit === undefined ? {} : { limit: input.limit - result.length }) });
    result.push(...page.data);
    if (input.limit !== undefined && result.length >= input.limit) break;
    cursor = page.cursor.next ?? undefined;
    if (cursor && seen.has(cursor)) throw new ApiError(502, "opencode_invalid_cursor", "The engine repeated a session page cursor.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return result;
}

export async function listEngineMessages(client: OpenCodeClient, sessionID: string, input: { limit?: number; cursor?: string; order?: "asc" | "desc" } = {}): Promise<SessionMessageInfo[]> {
  const result: SessionMessageInfo[] = [];
  const seen = new Set<string>();
  let cursor = input.cursor;
  do {
    const page = await client.message.list({ sessionID, ...(cursor ? { cursor } : { order: input.order ?? "asc" }), ...(input.limit === undefined ? {} : { limit: input.limit - result.length }) });
    result.push(...page.data);
    if (input.limit !== undefined && result.length >= input.limit) break;
    cursor = page.cursor.next ?? undefined;
    if (cursor && seen.has(cursor)) throw new ApiError(502, "opencode_invalid_cursor", "The engine repeated a message page cursor.");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return result;
}


export function assertManagedHistoryReadable(config: ServerConfig, method: string, path: string) {
  if (config.managedEngineStarting && method === "GET" && /^\/api\/session(?:$|\/[^/]+\/(?:context|message)(?:\/|$))/.test(path)) {
    throw new ApiError(503, "opencode_history_loading", "OpenCode is preparing chat history. Existing chats remain preserved; wait for initialization to finish.");
  }
}
