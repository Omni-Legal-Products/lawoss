import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { z } from "zod";
import type { Actor, ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
import { ApiError } from "../errors.js";

type SessionOrigin = { directory: string; scope: TokenScope };
type SessionLookup = (workspace: WorkspaceInfo, sessionId: string, directory: string, signal: AbortSignal) => Promise<unknown>;
type RuntimeAccess = { token: string; sessions: Map<string, SessionOrigin>; revoked: Set<string>; lookup?: SessionLookup };
const runtimes = new WeakMap<ServerConfig, RuntimeAccess>();
const sessionSchema = z.object({ id: z.string().min(1).max(200), directory: z.string().min(1), parentID: z.string().min(1).max(200).optional() });

function runtime(config: ServerConfig): RuntimeAccess {
  let access = runtimes.get(config);
  if (!access) {
    access = { token: randomBytes(32).toString("hex"), sessions: new Map(), revoked: new Set() };
    runtimes.set(config, access);
  }
  return access;
}

/** The server supplies its authenticated, directory-pinned engine client. */
export function configureWikiAgentSessionLookup(config: ServerConfig, lookup: SessionLookup): void {
  runtime(config).lookup = lookup;
}

/** Only the managed engine receives this ephemeral, narrow credential. */
export async function ensureWikiAgentToken(config: ServerConfig): Promise<string> {
  return runtime(config).token;
}

/** Called by the authenticated proxy, never from request-body identity claims. */
export async function grantWikiAgentSession(config: ServerConfig, input: {
  sessionId: string;
  directory: string;
  scope: TokenScope;
}): Promise<void> {
  if (!input.sessionId || input.sessionId.length > 200) throw new ApiError(403, "wiki_agent_session_invalid", "The agent session is unknown.");
  const directory = await realpath(input.directory).catch(() => null);
  if (!directory) {
    // A remote engine may use a directory absent on this host. Its ordinary
    // session can proceed, but no private wiki grant may survive that change.
    const access = runtime(config);
    access.sessions.delete(input.sessionId);
    access.revoked.add(input.sessionId);
    return;
  }
  const access = runtime(config);
  const previous = access.sessions.get(input.sessionId);
  if (previous && previous.directory !== directory)
    throw new ApiError(403, "wiki_agent_directory_mismatch", "This agent session belongs to another working directory.");
  // Replace rather than merge: a collaborator taking over an owner's session
  // must immediately lose the owner's private wiki access.
  access.sessions.set(input.sessionId, { directory, scope: input.scope });
  access.revoked.delete(input.sessionId);
}

/** Inherit live scope, never a cached owner grant, from an engine-verified ancestor. */
async function inheritedOrigin(config: ServerConfig, access: RuntimeAccess, sessionId: string, directory: string, requestSignal: AbortSignal): Promise<SessionOrigin | undefined> {
  const lookup = access.lookup;
  if (!lookup || access.revoked.has(sessionId)) return;
  const workspaces = await Promise.all(config.workspaces.map(async workspace => {
    const root = await realpath(workspace.directory || workspace.path).catch(() => null);
    if (!root) return null;
    const child = relative(root, directory);
    return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child) ? { workspace, root } : null;
  }));
  const source = workspaces.filter(item => item !== null).sort((a, b) => b.root.length - a.root.length)[0];
  if (!source) return;
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(10_000)]);
  const visited = new Set<string>();
  let id: string | undefined = sessionId;
  while (id && visited.size < 64) {
    if (visited.has(id) || access.revoked.has(id) || signal.aborted) return;
    visited.add(id);
    const session = sessionSchema.safeParse(await lookup(source.workspace, id, directory, signal).catch(() => null));
    if (!session.success || session.data.id !== id || await realpath(session.data.directory).catch(() => null) !== directory || signal.aborted) return;
    // Read after the engine response, so a downgrade during lookup takes effect.
    const origin = access.sessions.get(id);
    if (access.revoked.has(id)) return;
    if (origin) return origin.directory === directory ? origin : undefined;
    id = session.data.parentID;
  }
}

function narrowWikiPath(method: string, pathname: string): boolean {
  if (method === "POST" && /^\/workspace\/[^/]+\/view-generations\/[^/]+$/.test(pathname)) return true;
  if (method === "GET" && pathname === "/wikis/file-policy") return true;
  if (method === "GET" && (pathname === "/workspaces" || pathname === "/wikis")) return true;
  if (method === "GET" && /^\/wikis\/(?!deleted$|team$)[^/]+$/.test(pathname)) return true;
  if (method === "GET" && /^\/wikis\/[^/]+\/search$/.test(pathname)) return true;
  if (method === "GET" && /^\/wikis\/[^/]+\/fields$/.test(pathname)) return true;
  if (method === "POST" && /^\/wikis\/[^/]+\/query$/.test(pathname)) return true;
  if (["GET", "POST"].includes(method) && /^\/(?:wikis|workspace)\/[^/]+\/ui-views$/.test(pathname)) return true;
  if (["GET", "PUT"].includes(method) && /^\/(?:wikis|workspace)\/[^/]+\/ui-views\/[^/]+$/.test(pathname)) return true;
  if (method === "PATCH" && /^\/wikis\/[^/]+\/properties$/.test(pathname)) return true;
  return ["GET", "PUT", "DELETE"].includes(method) && /^\/wikis\/[^/]+\/page$/.test(pathname);
}

/** Existing storage/sandbox/skill tools need the originating member's access to their own wiki workspace. */
function workspaceToolPath(method: string, pathname: string): string | null {
  const match = pathname.match(/^\/workspace\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const route = match[2]!;
  const suggestion = (["GET", "POST"].includes(method) && route === "wiki-suggestions") || (["GET", "PUT"].includes(method) && /^wiki-suggestions\/[^/]+$/.test(route));
  const allowed = suggestion || (method === "GET"
    ? /^(?:storage\/roots|storage\/[^/]+\/(?:capabilities|children|search|file)|sandbox\/session\/[^/]+|skills|skills\/[^/]+\/(?:composed|package-file))$/.test(route)
    : method === "POST" && /^(?:storage\/[^/]+\/(?:checkout|filename-search|from-workspace|rename|folders)|sandbox\/(?:execute|web)|skills|skills\/(?!hub\/)[^/]+\/resources)$/.test(route));
  return allowed ? decodeURIComponent(match[1]!) : null;
}

/**
 * This is not a host/owner credential. A valid runtime secret authenticates
 * only a session whose origin the server recorded from an authenticated user.
 * Wiki routes still enforce that actor's visibility and this directory's scope.
 */
export async function authenticateWikiAgentRequest(config: ServerConfig, request: Request): Promise<{
  actor: Actor;
  directory: string;
  sessionId: string;
} | null> {
  const token = request.headers.get("x-legalwork-wiki-agent-token");
  if (token === null) return null;
  const access = runtimes.get(config);
  const candidate = Buffer.from(token);
  const expected = Buffer.from(access?.token ?? "");
  if (!access || candidate.length !== expected.length || !timingSafeEqual(candidate, expected))
    throw new ApiError(403, "wiki_agent_unauthorized", "The wiki agent connection is not authorized.");
  const pathname = new URL(request.url).pathname;
  const toolWorkspaceId = workspaceToolPath(request.method, pathname);
  if (!narrowWikiPath(request.method, pathname) && !toolWorkspaceId)
    throw new ApiError(403, "wiki_agent_endpoint_denied", "This agent credential is limited to wiki page tools.");
  const sessionId = request.headers.get("x-legalwork-wiki-agent-session");
  if (!sessionId || sessionId.length > 200) throw new ApiError(403, "wiki_agent_session_unknown", "Run this task through an authenticated LegalWork session before accessing wikis.");
  const claimed = request.headers.get("x-legalwork-wiki-agent-directory");
  let decoded: string | null = null;
  try { decoded = claimed ? decodeURIComponent(claimed) : null; } catch { /* Invalid encoded claims fail closed. */ }
  const directory = decoded ? await realpath(decoded).catch(() => null) : null;
  if (!directory) throw new ApiError(403, "wiki_agent_directory_mismatch", "The wiki request does not match this session's working directory.");
  const origin = access.sessions.get(sessionId) ?? await inheritedOrigin(config, access, sessionId, directory, request.signal);
  if (!origin) throw new ApiError(403, "wiki_agent_session_unknown", "Run this task through an authenticated LegalWork session before accessing wikis.");
  if (directory !== origin.directory)
    throw new ApiError(403, "wiki_agent_directory_mismatch", "The wiki request does not match this session's working directory.");
  if (toolWorkspaceId) {
    const candidates = await Promise.all(config.workspaces.map(async item => ({
      id: item.id, root: await realpath(item.directory || item.path).catch(() => null),
    })));
    const own = candidates.filter(item => {
      if (!item.root) return false;
      const child = relative(item.root, directory);
      return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
    }).sort((a, b) => (b.root?.length ?? 0) - (a.root?.length ?? 0))[0];
    if (own?.id !== toolWorkspaceId)
      throw new ApiError(403, "wiki_agent_workspace_denied", "Use storage and execution tools only in this session's own workspace.");
    if (pathname.includes("/sandbox/")) {
      const claimedSession = request.method === "GET" ? decodeURIComponent(pathname.split("/").at(-1)!)
        : z.object({ sessionID: z.string() }).parse(await request.clone().json()).sessionID;
      if (claimedSession !== sessionId)
        throw new ApiError(403, "wiki_agent_session_mismatch", "Use this session's execution settings and approvals.");
    }
  }
  return { directory, sessionId, actor: { type: "remote", clientId: `wiki-agent:${sessionId}`, scope: origin.scope,
    tokenHash: createHash("sha256").update(access.token).digest("hex") } };
}
