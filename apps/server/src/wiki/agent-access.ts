import { requireClientWorkspaceBoundary } from "../lawoss/agent-client-boundary.js";
import { forgetWikiProjectAccess, revokeWikiProjectAccess } from "./project-access.js";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { z } from "zod";
import type { Actor, ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
import { ApiError } from "../errors.js";
import { ENGINE_CONNECTION_REFUSED } from "../lawoss/engine-agent-contract.js";
import { reviewExecutionActor } from "../reviews/execution-actor.js";
import { reviewWorkerClaims } from "../reviews/worker.js";

/** `allProjects` is recorded only by the scheduled runner for an all-projects task, never from a request. */
type SessionOrigin = { sessionId: string; directory: string; scope: TokenScope; generation: string; allProjects?: boolean; scheduledProjects?: "all" | string[] };
export const SessionAuthoritySchema = z.object({ scope: z.enum(["owner", "collaborator", "viewer"]), scheduledProjects: z.union([z.literal("all"), z.array(z.string())]).optional(), sourceSessionId: z.string().optional() });
export type SessionAuthority = z.infer<typeof SessionAuthoritySchema>;
type SessionLookup = (workspace: WorkspaceInfo, sessionId: string, directory: string, signal: AbortSignal) => Promise<unknown>;
type ReviewWorkerAccess = { workspace: WorkspaceInfo; directory: string; claimId: string; scope: "owner" | "collaborator" };
type RuntimeAccess = { token: string; ticket?: string; spentTicket?: string; spentNonce?: string; ticketWindowEnds?: number; ticketWindowClosed?: boolean; owners: number; credentialScope?: TokenScope; sessions: Map<string, SessionOrigin>; parents: Map<string, string>; revoked: Set<string>;
  reviewWorkers: Map<string, ReviewWorkerAccess>; reservedWorkers: Set<string>; changed?: (sessionId: string, origin: SessionOrigin | null) => void; lookup?: SessionLookup };
const runtimes = new WeakMap<ServerConfig, RuntimeAccess>();
const sessionSchema = z.object({ id: z.string().min(1).max(200), directory: z.string().min(1), parentID: z.string().min(1).max(200).optional() });

function runtime(config: ServerConfig): RuntimeAccess {
  let access = runtimes.get(config);
  if (!access) {
    access = { owners: 0, token: randomBytes(32).toString("hex"), sessions: new Map(), parents: new Map(), revoked: new Set(), reviewWorkers: new Map(), reservedWorkers: new Set() };
    runtimes.set(config, access);
  }
  return access;
}

/** Verified lineage is a revocation dependency, never a cached scope grant. */
function revokeProjectTree(config: ServerConfig, sessionId: string) {
  const pending = [sessionId], visited = new Set<string>(), access = runtime(config);
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    revokeWikiProjectAccess(config, id);
    for (const [child, parent] of access.parents) if (parent === id) pending.push(child);
  }
}

/** The server supplies its authenticated, directory-pinned engine client. */
export function configureWikiAgentSessionLookup(config: ServerConfig, lookup: SessionLookup): void {
  runtime(config).lookup = lookup;
}

/** Durable internal dispatches observe later human scope changes and revocations. */
export function observeWikiAgentSessions(config: ServerConfig, changed: NonNullable<RuntimeAccess["changed"]>): void {
  runtime(config).changed = changed;
}

export function currentWikiAgentSession(config: ServerConfig, sessionId: string): SessionOrigin | undefined {
  return runtime(config).sessions.get(sessionId);
}

/** One server-created inference attempt, with no general workspace or inherited authority. */
export async function grantReviewWorkerAccess(config: ServerConfig, input: {
  workspace: WorkspaceInfo; sessionId: string; claimId: string; actor: Actor; signal: AbortSignal;
}): Promise<() => void> {
  const actor = reviewExecutionActor(input.actor), access = runtime(config);
  input.signal.throwIfAborted();
  const directory = await realpath(input.workspace.directory || input.workspace.path);
  const registered = config.workspaces.find(workspace => workspace.id === input.workspace.id);
  if (!registered || await realpath(registered.directory || registered.path) !== directory)
    throw new ApiError(403, "wiki_agent_workspace_denied", "This inference workspace is unavailable.");
  reviewWorkerClaims(config).get(input.workspace, input.sessionId, input.claimId);
  if (access.sessions.has(input.sessionId) || access.reservedWorkers.has(input.sessionId))
    throw new ApiError(403, "review_worker_access_invalid", "This inference session already has an origin.");
  input.signal.throwIfAborted();
  access.reservedWorkers.add(input.sessionId);
  access.reviewWorkers.set(input.sessionId, { workspace: { ...input.workspace }, directory, claimId: input.claimId, scope: actor.scope });
  const revoke = () => { access.reviewWorkers.delete(input.sessionId); reviewWorkerClaims(config).remove(input.sessionId); };
  input.signal.addEventListener("abort", revoke, { once: true });
  if (input.signal.aborted) { revoke(); input.signal.throwIfAborted(); }
  return () => { revoke(); input.signal.removeEventListener("abort", revoke); };
}

/** The server's view of the ephemeral, narrow credential; only the engine's plugins hold it elsewhere. */
export async function ensureWikiAgentToken(config: ServerConfig): Promise<string> {
  return runtime(config).token;
}

/** Enough for a cold plugin load; no redemption window outlives this, whatever the readiness probe does. */
const TICKET_WINDOW_MS = 600_000;
const newSecret = () => randomBytes(32).toString("hex");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** One per engine start. A new engine gets a new ticket and secret; the previous pair stops working. */
export function issueWikiAgentTicket(config: ServerConfig): string {
  const access = runtime(config), ticket = newSecret();
  access.token = newSecret();
  access.ticket = digest(ticket);
  access.spentTicket = undefined;
  access.spentNonce = undefined;
  access.ticketWindowEnds = Date.now() + TICKET_WINDOW_MS;
  access.ticketWindowClosed = false;
  return ticket;
}

/**
 * Exchanges the outstanding ticket for the secret, once; a retry with the same nonce gets the same
 * answer. Any other repeat is refused. While the window is open it also replaces the secret, so
 * whoever redeemed first fails closed; after that the secret stays. See coordination record.
 */
export function redeemWikiAgentTicket(config: ServerConfig, presented: string, nonce = "", now = Date.now()): string {
  const access = runtimes.get(config), hash = digest(presented), nonceHash = nonce ? digest(nonce) : undefined;
  const windowOpen = access && !access.ticketWindowClosed && now < (access.ticketWindowEnds ?? 0);
  if (access?.ticket && access.ticket === hash) {
    access.ticket = undefined;
    access.spentTicket = hash;
    if (windowOpen) {
      access.spentNonce = nonceHash;
      return access.token;
    }
  } else if (access?.spentTicket === hash) {
    if (nonceHash && access.spentNonce === nonceHash) return access.token;
    if (windowOpen) {
      access.token = newSecret();
      access.spentNonce = undefined;
    }
  }
  throw new ApiError(403, "wiki_agent_ticket_refused", ENGINE_CONNECTION_REFUSED);
}

/** The engine's plugins have loaded. A ticket not redeemed by now is spent. */
export function closeWikiAgentTicketWindow(config: ServerConfig): void {
  const access = runtimes.get(config);
  if (!access) return;
  if (access.ticket) {
    access.spentTicket = access.ticket;
    access.ticket = undefined;
  }
  access.ticketWindowClosed = true;
}

/** Called by the authenticated proxy, never from request-body identity claims. */
export async function grantWikiAgentSession(config: ServerConfig, input: {
  sessionId: string;
  directory: string;
  scope: TokenScope;
  allProjects?: boolean;
  scheduledProjects?: "all" | string[];
}, beforeCommit?: () => void): Promise<void> {
  if (!input.sessionId || input.sessionId.length > 200) throw new ApiError(403, "wiki_agent_session_invalid", "The agent session is unknown.");
  if (runtime(config).reservedWorkers.has(input.sessionId))
    throw new ApiError(403, "review_worker_access_invalid", "An inference worker cannot become a general chat.");
  const directory = await realpath(input.directory).catch(() => null);
  beforeCommit?.();
  if (!directory) {
    // A remote engine may use a directory absent on this host. Its ordinary
    // session can proceed, but no private wiki grant may survive that change.
    const access = runtime(config);
    revokeProjectTree(config, input.sessionId);
    access.sessions.delete(input.sessionId);
    access.revoked.add(input.sessionId);
    access.changed?.(input.sessionId, null);
    return;
  }
  const access = runtime(config);
  const rank = {viewer: 0, collaborator: 1, owner: 2};
  if (!access.credentialScope || rank[input.scope] < rank[access.credentialScope]) {
    access.credentialScope = input.scope;
    for (const id of access.sessions.keys()) revokeProjectTree(config, id);
  }
  const previous = access.sessions.get(input.sessionId);
  if (previous && previous.directory !== directory)
    throw new ApiError(403, "wiki_agent_directory_mismatch", "This agent session belongs to another working directory.");
  // Replace rather than merge: a collaborator taking over an owner's session
  // must immediately lose the owner's private wiki access.
  const unchanged = previous?.scope === input.scope && JSON.stringify(previous.scheduledProjects) === JSON.stringify(input.scheduledProjects);
  if (previous && !unchanged || access.parents.has(input.sessionId)) revokeProjectTree(config, input.sessionId);
  access.parents.delete(input.sessionId);
  access.sessions.set(input.sessionId, { sessionId: input.sessionId, directory, scope: input.scope, scheduledProjects: input.scheduledProjects,
    generation: unchanged ? previous.generation : randomBytes(16).toString("hex"),
    ...(input.allProjects ? { allProjects: true } : {}) });
  access.revoked.delete(input.sessionId);
  access.changed?.(input.sessionId, access.sessions.get(input.sessionId)!);
}

/** Human UI reads may reopen an existing chat before its next prompt registers it. */
export async function verifiedWikiSessionOrigin(config: ServerConfig, workspace: WorkspaceInfo, sessionId: string, scope: TokenScope, signal: AbortSignal): Promise<SessionOrigin> {
  const access = runtime(config);
  const directory = await realpath(workspace.directory || workspace.path);
  const existing = access.sessions.get(sessionId);
  if (existing && existing.directory === directory && !access.revoked.has(sessionId)) return existing;
  const lookup = access.lookup;
  const found = lookup ? sessionSchema.safeParse(await lookup(workspace, sessionId, directory, AbortSignal.any([signal, AbortSignal.timeout(10_000)])).catch(() => null)) : null;
  if (!found?.success || found.data.id !== sessionId || await realpath(found.data.directory).catch(() => null) !== directory || access.revoked.has(sessionId))
    throw new ApiError(403, "wiki_agent_session_unknown", "This chat does not belong to this wiki.");
  if (found.data.parentID) {
    const inherited = await inheritedOrigin(config, access, sessionId, directory, signal);
    if (!inherited) throw new ApiError(403, "wiki_agent_session_unknown", "This chat's originating permissions are unavailable.");
    return inherited;
  }
  await grantWikiAgentSession(config, { sessionId, directory, scope });
  const origin = access.sessions.get(sessionId);
  if (!origin) throw new ApiError(403, "wiki_agent_session_unknown", "This chat is unavailable.");
  return origin;
}

export function revokeWikiAgentSession(config: ServerConfig, sessionId: string): void {
  const access = runtime(config);
  access.sessions.delete(sessionId);
  access.revoked.add(sessionId);
  access.changed?.(sessionId, null);
  revokeProjectTree(config, sessionId);
  forgetWikiProjectAccess(config, sessionId);
}

/** Inherit live scope, never a cached owner grant, from an engine-verified ancestor. */
async function inheritedOrigin(config: ServerConfig, access: RuntimeAccess, sessionId: string, directory: string, requestSignal: AbortSignal): Promise<SessionOrigin | undefined> {
  const lookup = access.lookup;
  if (!lookup || access.revoked.has(sessionId)) return;
  const source = await ownWorkspaceFor(config, directory);
  if (!source) return;
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(10_000)]);
  const visited = new Set<string>();
  let id: string | undefined = sessionId;
  while (id && visited.size < 64) {
    if (visited.has(id) || access.revoked.has(id) || access.reservedWorkers.has(id) || signal.aborted) return;
    visited.add(id);
    const session = sessionSchema.safeParse(await lookup(source, id, directory, signal).catch(() => null));
    if (!session.success || session.data.id !== id || await realpath(session.data.directory).catch(() => null) !== directory || signal.aborted) return;
    // Read after the engine response, so a downgrade during lookup takes effect.
    const origin = access.sessions.get(id);
    if (access.revoked.has(id)) return;
    if (origin) return origin.directory === directory ? origin : undefined;
    if (session.data.parentID) access.parents.set(id, session.data.parentID);
    else access.parents.delete(id);
    id = session.data.parentID;
  }
}

function narrowWikiPath(method: string, pathname: string): boolean {
  if (method === "POST" && /^\/assistant\/(?:delegate|follow-up|session-control|save-report|scratchpad|briefing)$/.test(pathname)) return true;
  // Recording reads inherit the authenticated session's scope. The library
  // routes separately require owner access, including after a scope downgrade.
  if (method === "GET" && /^\/recorder\/recordings(?:\/[^/]+)?$/.test(pathname)) return true;
  if (method === "GET" && /^\/wikis\/[^/]+\/sessions\/[^/]+\/projects(?:\/[^/]+\/(?:files|read))?$/.test(pathname)) return true;
  if (method === "POST" && /^\/wikis\/[^/]+\/sessions\/[^/]+\/projects\/[^/]+\/access$/.test(pathname)) return true;
  if (method === "GET" && pathname === "/wikis/file-policy") return true;
  if (method === "GET" && pathname === "/wikis") return true;
  if (method === "GET" && /^\/wikis\/(?!deleted$|team$)[^/]+$/.test(pathname)) return true;
  if (method === "GET" && /^\/wikis\/[^/]+\/search$/.test(pathname)) return true;
  if (method === "GET" && /^\/wikis\/[^/]+\/fields$/.test(pathname)) return true;
  if (method === "POST" && /^\/wikis\/[^/]+\/query$/.test(pathname)) return true;
  if (method === "GET" && /^\/wikis\/[^/]+\/ui-views(?:\/[^/]+)?$/.test(pathname)) return true;
  if (method === "PATCH" && /^\/wikis\/[^/]+\/properties$/.test(pathname)) return true;
  return ["GET", "PUT", "DELETE"].includes(method) && /^\/wikis\/[^/]+\/page$/.test(pathname);
}

type ToolRule = { methods: readonly string[]; route: RegExp; ownSession?: boolean; crossProject?: boolean };
const READ = ["GET"], WRITE = ["POST"], RECORDS = ["GET", "POST", "PATCH", "PUT", "DELETE"];

/**
 * Routes under `/workspace/:id/` that the bundled tool plugins call. `:id` must be the
 * session's own workspace. `ownSession` routes name this chat in their first capture group.
 * Engine proxy, approvals, configuration, tokens, MCP and the Office pane's own relay are absent.
 */
const WORKSPACE_TOOL_ROUTES: readonly ToolRule[] = [
  { methods: READ, route: /^(?:browser-connections|storage\/roots|storage\/[^/]+\/(?:capabilities|children|search|file)|skills|skills\/[^/]+\/(?:composed|package-file))$/ },
  // Upstream v0.3.9: saved website logins (#375) and transfers between storage sources (#373).
  { methods: WRITE, route: /^(?:browser-connections\/[^/]+\/websites|pdf\/read|storage\/[^/]+\/(?:checkout|filename-search|from-workspace|rename|folders|transfer)|skills|skills\/(?!hub\/)[^/]+\/(?:resources|research-experience))$/ },
  { methods: READ, route: /^sandbox\/session\/([^/]+)$/, ownSession: true },
  { methods: WRITE, route: /^sandbox\/(?:execute|command|web|http)$/ },
  // Upstream v0.3.0: saved tool output, history images and original images of this chat only.
  { methods: READ, route: /^sessions\/([^/]+)\/(?:history-images|tool-image-originals|tool-output\/authorize)$/, ownSession: true },
  { methods: WRITE, route: /^sessions\/([^/]+)\/(?:history-images\/read|tool-image-originals\/(?:capture|read|crop|export))$/, ownSession: true },
  // Upstream v0.3.0: a review worker reads its contract and submits its answer for its own chat.
  { methods: READ, route: /^reviews\/workers\/([^/]+)\/contract$/, ownSession: true },
  { methods: WRITE, route: /^reviews\/workers\/([^/]+)\/submit$/, ownSession: true },
  // LAWOSS: lawoss_files (lawoss/file-operations.ts); the change itself is bound to this chat below.
  { methods: WRITE, route: /^lawoss\/files\/(?:plan|apply)$/ },
  { methods: ["GET", "POST"], route: /^wiki-suggestions$/ },
  { methods: ["GET", "PUT"], route: /^wiki-suggestions\/[^/]+$/ },
  { methods: WRITE, route: /^view-generations\/([^/]+)$/, ownSession: true },
  { methods: READ, route: /^ui-views(?:\/[^/]+)?$/ },
  { methods: READ, route: /^office-tools\/status$/ },
  { methods: WRITE, route: /^office-tools\/execute$/ },
  // Review settings stay human-only and the worker routes above keep their own methods (upstream v0.3.0).
  { methods: RECORDS, route: /^(?:tasks|reviews(?!\/(?:settings|workers)(?:\/|$))|calendar|email-drafts|calendar-drafts|lawoss\/documents)(?:\/.+)?$/ },
  // Editing a saved schedule could rewrite what an all-projects run does, so only reads and new tasks.
  { methods: READ, route: /^scheduled-tasks(?:\/.+)?$/ },
  { methods: WRITE, route: /^scheduled-tasks(?:\/preview)?$/ },
  { methods: READ, route: /^project\/(?:setup|remote-folders)$/ },
  { methods: READ, route: /^lawoss\/memory\/(?:grants|context)$/ },
  // LAWOSS: lawoss_memory reads, lawoss_memory_write writes after its card (lawoss/matter-memory.ts), this client only; the path goes in the body.
  { methods: WRITE, route: /^lawoss\/memory\/(?:read|write)$/ },
  { methods: READ, route: /^project\/(?:contents|content)$/, crossProject: true },
  { methods: ["PATCH"], route: /^project\/(?:setup|metadata)$/ },
  { methods: ["GET", "POST"], route: /^files\/content$/ },
  { methods: ["GET", "PUT"], route: /^personalization$/ },
  { methods: WRITE, route: /^benchmarks\/tasks$/ },
  { methods: WRITE, route: /^sessions\/([^/]+)\/(?:retry-stop|review-recovery|provider-failure)$/, ownSession: true },
];

/** Server-wide routes the plugins call. None returns another project's files. */
const GLOBAL_TOOL_ROUTES: readonly ToolRule[] = [
  { methods: READ, route: /^\/workspaces(?:\/project-templates)?$/ },
  { methods: WRITE, route: /^\/workspaces\/projects$/ },
  { methods: READ, route: /^\/experimental\/extensions\/actions$/ },
  { methods: WRITE, route: /^\/experimental\/extensions\/call$/ },
  { methods: READ, route: /^\/scheduled-tasks\/projects$/ },
  { methods: READ, route: /^\/benchmarks\/session-ablation$/ },
];

/**
 * The firm's guard holds no project data and must apply to every chat, including one the
 * server has not seen yet, so the engine reads it with its credential alone.
 */
function engineWideRoute(method: string, pathname: string): boolean {
  return method === "GET" && pathname === "/org-policy/guard";
}

type ToolRoute = { workspaceId?: string; session?: string; crossProject: boolean };

function toolRoute(method: string, url: URL): ToolRoute | null {
  const global = GLOBAL_TOOL_ROUTES.find(rule => rule.methods.includes(method) && rule.route.test(url.pathname));
  if (global) return { session: url.pathname === "/benchmarks/session-ablation" ? url.searchParams.get("session") ?? "" : undefined, crossProject: false };
  const match = url.pathname.match(/^\/workspace\/([^/]+)\/(.+)$/);
  if (!match) return null;
  const route = match[2]!;
  const rule = WORKSPACE_TOOL_ROUTES.find(item => item.methods.includes(method) && item.route.test(route));
  if (!rule) return null;
  const session = rule.ownSession ? route.match(rule.route)?.[1] : undefined;
  return { workspaceId: decodeURIComponent(match[1]!), session: session === undefined ? undefined : decodeURIComponent(session), crossProject: rule.crossProject === true };
}

/** The registered workspace whose canonical root most closely contains `directory`. */
export async function ownWorkspaceFor(config: ServerConfig, directory: string): Promise<WorkspaceInfo | undefined> {
  const candidates = await Promise.all(config.workspaces.map(async workspace => ({
    workspace, root: await realpath(workspace.directory || workspace.path).catch(() => null),
  })));
  return candidates.filter((item): item is { workspace: WorkspaceInfo; root: string } => {
    if (!item.root) return false;
    const child = relative(item.root, directory);
    return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
  }).sort((a, b) => b.root.length - a.root.length)[0]?.workspace;
}

/**
 * LAWOSS (N-A7-17): the model relays this refusal to the lawyer. The usual cause is a task that
 * continued after LAWOSS restarted, before the lawyer sent anything in this chat again.
 */
export const CHAT_NOT_REGISTERED = "This chat cannot use this client's files now: LAWOSS has not confirmed this chat since it last started, for example because LAWOSS restarted during the task. Nothing was read or changed. Stop the task and tell the user in their language, without error codes or technical terms: the task could not be finished after LAWOSS restarted; send the message again.";

/** Engine requests get the session's own data; an all-projects scheduled run may read other projects. */
export function agentMayList(agent: { workspaceId: string | null; allProjects: boolean }, pathname: string, workspaceId: string): boolean {
  return workspaceId === agent.workspaceId || (agent.allProjects && pathname === "/scheduled-tasks/projects");
}

/**
 * This is not a host/owner credential. A valid runtime secret authenticates
 * only a session whose origin the server recorded from an authenticated user.
 * Wiki routes still enforce that actor's visibility and this directory's scope;
 * tool routes are limited to the session's own workspace.
 */
export async function authenticateWikiAgentRequest(config: ServerConfig, request: Request): Promise<{
  actor: Actor;
  directory: string;
  sessionId: string;
  originSessionId: string;
  generation: string;
  reviewWorker?: true;
  workspaceId: string | null;
  allProjects: boolean;
  scheduledProjects?: "all" | string[];
} | null> {
  const token = request.headers.get("x-legalwork-wiki-agent-token");
  if (token === null) return null;
  const access = runtimes.get(config);
  const candidate = Buffer.from(token);
  const expected = Buffer.from(access?.token ?? "");
  if (!access || candidate.length !== expected.length || !timingSafeEqual(candidate, expected))
    throw new ApiError(403, "wiki_agent_unauthorized", ENGINE_CONNECTION_REFUSED);
  const url = new URL(request.url), pathname = url.pathname;
  const tokenHash = createHash("sha256").update(access.token).digest("hex");
  if (engineWideRoute(request.method, pathname))
    return { directory: "", sessionId: "", originSessionId: "", generation: "", workspaceId: null, allProjects: false,
      actor: { type: "remote", clientId: "wiki-agent:engine", scope: "collaborator", tokenHash } };
  const tool = toolRoute(request.method, url);
  if (!narrowWikiPath(request.method, pathname) && !tool)
    throw new ApiError(403, "wiki_agent_endpoint_denied", "This agent credential is limited to this project's tools.");
  const sessionId = request.headers.get("x-legalwork-wiki-agent-session");
  if (!sessionId || sessionId.length > 200) throw new ApiError(403, "wiki_agent_session_unknown", "Run this task through an authenticated LegalWork session before accessing wikis.");
  const claimed = request.headers.get("x-legalwork-wiki-agent-directory");
  let decoded: string | null = null;
  try { decoded = claimed ? decodeURIComponent(claimed) : null; } catch { /* Invalid encoded claims fail closed. */ }
  const directory = decoded ? await realpath(decoded).catch(() => null) : null;
  if (!directory) throw new ApiError(403, "wiki_agent_directory_mismatch", "The wiki request does not match this session's working directory.");
  if (access.reservedWorkers.has(sessionId)) {
    const worker = access.reviewWorkers.get(sessionId);
    if (!worker) throw new ApiError(403, "wiki_agent_session_unknown", "This inference attempt is no longer active.");
    const route = pathname.match(/^\/workspace\/([^/]+)\/reviews\/workers\/([^/]+)\/(contract|submit)$/);
    if (!route || !(request.method === "GET" && route[3] === "contract" || request.method === "POST" && route[3] === "submit"))
      throw new ApiError(403, "wiki_agent_endpoint_denied", "An inference worker can only read its contract and submit its answer.");
    if (decodeURIComponent(route[2]!) !== sessionId)
      throw new ApiError(403, "wiki_agent_session_mismatch", "Use review submission only for this worker chat.");
    if (decodeURIComponent(route[1]!) !== worker.workspace.id)
      throw new ApiError(403, "wiki_agent_workspace_denied", "Use only this inference attempt's workspace.");
    if (directory !== worker.directory)
      throw new ApiError(403, "wiki_agent_directory_mismatch", "This inference attempt belongs to another directory.");
    reviewWorkerClaims(config).get(worker.workspace, sessionId, worker.claimId);
    return { directory, sessionId, originSessionId: sessionId, generation: worker.claimId, reviewWorker: true, workspaceId: worker.workspace.id, allProjects: false,
      actor: { type: "remote", clientId: `review-worker:${sessionId}`, scope: worker.scope, tokenHash } };
  }
  const origin = access.sessions.get(sessionId) ?? await inheritedOrigin(config, access, sessionId, directory, request.signal);
  if (!origin) throw new ApiError(403, "wiki_agent_session_unknown", CHAT_NOT_REGISTERED);
  if (directory !== origin.directory)
    throw new ApiError(403, "wiki_agent_directory_mismatch", "The wiki request does not match this session's working directory.");
  if (pathname.startsWith("/assistant/")) {
    const source = z.object({ sourceSessionId: z.string() }).safeParse(await request.clone().json().catch(() => null));
    if (!source.success || source.data.sourceSessionId !== sessionId)
      throw new ApiError(403, "wiki_agent_session_mismatch", "Use this chat's own delegation context.");
  }
  const own = await ownWorkspaceFor(config, directory);
  const clientRoot = own ? await realpath(own.directory || own.path) : directory;
  // The shared process credential cannot distinguish a normal chat from a scheduled
  // all-projects session named in attacker-controlled headers. Keep cross-client reads
  // unavailable until the scheduled transport has an independent scoped credential.
  const allProjects = false;
  await requireClientWorkspaceBoundary(config, clientRoot);
  const rank = {viewer: 0, collaborator: 1, owner: 2};
  const scope = access.credentialScope && rank[access.credentialScope] < rank[origin.scope] ? access.credentialScope : origin.scope;
  if (tool) {
    if (tool.session !== undefined && tool.session !== sessionId)
      throw new ApiError(403, "wiki_agent_session_mismatch", "Use this route only for this chat.");
    if (tool.workspaceId !== undefined && own?.id !== tool.workspaceId && !(tool.crossProject && allProjects))
      throw new ApiError(403, "wiki_agent_workspace_denied", "Use project tools only in this session's own workspace.");
    if (/^\/workspace\/[^/]+\/(?:sandbox\/(?:execute|command|web|http)|lawoss\/files\/apply|lawoss\/memory\/write)$/.test(pathname)
      && z.object({ sessionID: z.string() }).parse(await request.clone().json()).sessionID !== sessionId)
      throw new ApiError(403, "wiki_agent_session_mismatch", "Use this session's execution settings and approvals.");
    // A scheduled run reaching every project is granted only by a person, never by an agent.
    if (request.method === "POST" && /^\/workspace\/[^/]+\/scheduled-tasks$/.test(pathname)
      && z.object({ projectAccess: z.literal("all") }).safeParse(await request.clone().json().catch(() => null)).success)
      throw new ApiError(403, "wiki_agent_project_access", "Ask the user to choose access to all projects in LegalWork.");
  }
  // LAWOSS: like allProjects above, a scheduled all-projects run reads only its own client's recordings.
  const scheduledProjects = origin.scheduledProjects === "all" ? (allProjects ? "all" : own ? [own.id] : []) : origin.scheduledProjects;
  return { directory, sessionId, originSessionId: origin.sessionId, generation: origin.generation, workspaceId: own?.id ?? null, allProjects, scheduledProjects,
    actor: { type: "remote", clientId: `wiki-agent:${sessionId}`, scope, tokenHash } };
}

/** Last listener shutdown revokes process credentials; a reused config starts a fresh generation. */
export function retainWikiAgentRuntime(config: ServerConfig): () => void {
  const access = runtime(config); access.owners++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--access.owners !== 0) return;
    for (const id of access.sessions.keys()) revokeProjectTree(config, id);
    if (runtimes.get(config) === access) runtimes.delete(config);
  };
}
