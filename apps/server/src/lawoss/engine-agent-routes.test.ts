import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeStorageDir } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { authenticateWikiAgentRequest, CHAT_NOT_REGISTERED, ensureWikiAgentToken, grantWikiAgentSession } from "../wiki/agent-access.js";
import { WIKI_AGENT_LOCATION_HEADER, WIKI_AGENT_TICKET_ENV } from "./engine-agent-contract.js";
import { SERVER_CREDENTIAL_ENV, withoutServerCredentials } from "./engine-credentials.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-engine-routes-")));
  roots.push(root);
  const a = join(root, "a"), b = join(root, "b");
  await mkdir(a); await mkdir(b);
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "client", hostToken: "host",
    configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: [{ id: "ws_a", name: "A", path: a, preset: "starter", workspaceType: "local" }, { id: "ws_b", name: "B", path: b, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const token = await ensureWikiAgentToken(config);
  const request = (path: string, input: { session?: string; directory?: string; method?: string; body?: unknown } = {}) =>
    new Request(`http://127.0.0.1${path}`, { method: input.method ?? "GET", headers: {
      "x-legalwork-wiki-agent-token": token,
      ...(input.session === undefined ? {} : { "x-legalwork-wiki-agent-session": input.session, "x-legalwork-wiki-agent-directory": encodeURIComponent(input.directory ?? a) }),
    }, ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }) });
  await grantWikiAgentSession(config, { sessionId: "chat_a", directory: a, scope: "collaborator" });
  return { config, a, b, request };
}

test("project routes are bound to the chat's own workspace, and the main bearer is not an agent credential", async () => {
  const { config, request } = await fixture();
  expect((await authenticateWikiAgentRequest(config, request("/workspace/ws_a/files/content?path=x", { session: "chat_a" })))?.workspaceId).toBe("ws_a");
  await expect(authenticateWikiAgentRequest(config, request("/workspace/ws_b/files/content?path=x", { session: "chat_a" }))).rejects.toMatchObject({ code: "wiki_agent_workspace_denied" });
  await expect(authenticateWikiAgentRequest(config, request("/workspace/ws_a/files/list", { session: "chat_a" }))).rejects.toMatchObject({ code: "wiki_agent_endpoint_denied" });
  await expect(authenticateWikiAgentRequest(config, request("/workspace/ws_a/opencode/session", { session: "chat_a" }))).rejects.toMatchObject({ code: "wiki_agent_endpoint_denied" });
  const bearer = new Request("http://127.0.0.1/workspace/ws_b/files/content", { headers: { "x-legalwork-wiki-agent-token": config.token } });
  await expect(authenticateWikiAgentRequest(config, bearer)).rejects.toMatchObject({ code: "wiki_agent_unauthorized" });
});

test("routes naming a chat accept only the calling chat", async () => {
  const { config, request } = await fixture();
  expect(await authenticateWikiAgentRequest(config, request("/workspace/ws_a/sessions/chat_a/retry-stop", { session: "chat_a", method: "POST" }))).not.toBeNull();
  await expect(authenticateWikiAgentRequest(config, request("/workspace/ws_a/sessions/chat_b/retry-stop", { session: "chat_a", method: "POST" }))).rejects.toMatchObject({ code: "wiki_agent_session_mismatch" });
  await expect(authenticateWikiAgentRequest(config, request("/benchmarks/session-ablation?session=chat_b", { session: "chat_a" }))).rejects.toMatchObject({ code: "wiki_agent_session_mismatch" });
});

test("shared engine credentials cannot borrow scheduled all-project access", async () => {
  const { config, a, request } = await fixture();
  await expect(authenticateWikiAgentRequest(config, request("/workspace/ws_b/project/contents", { session: "chat_a" }))).rejects.toMatchObject({ code: "wiki_agent_workspace_denied" });
  await grantWikiAgentSession(config, { sessionId: "scheduled_all", directory: a, scope: "collaborator", allProjects: true });
  await expect(authenticateWikiAgentRequest(config, request("/workspace/ws_b/project/contents", { session: "scheduled_all" }))).rejects.toMatchObject({ code: "wiki_agent_workspace_denied" });
  await expect(authenticateWikiAgentRequest(config, request("/workspace/ws_b/files/content?path=x", { session: "scheduled_all" }))).rejects.toMatchObject({ code: "wiki_agent_workspace_denied" });
  await expect(authenticateWikiAgentRequest(config, request("/workspace/ws_a/scheduled-tasks", { session: "chat_a", method: "POST", body: { projectAccess: "all" } }))).rejects.toMatchObject({ code: "wiki_agent_project_access" });
  await expect(authenticateWikiAgentRequest(config, request("/workspace/ws_a/scheduled-tasks/task_1", { session: "chat_a", method: "PATCH", body: {} }))).rejects.toMatchObject({ code: "wiki_agent_endpoint_denied" });
  expect(await authenticateWikiAgentRequest(config, request("/workspace/ws_a/scheduled-tasks", { session: "chat_a", method: "POST", body: { projectAccess: "project" } }))).not.toBeNull();
});

test("the firm's guard is readable with the engine credential alone, nothing else is", async () => {
  const { config, request } = await fixture();
  expect((await authenticateWikiAgentRequest(config, request("/org-policy/guard")))?.actor.scope).toBe("collaborator");
  await expect(authenticateWikiAgentRequest(config, request("/workspaces"))).rejects.toMatchObject({ code: "wiki_agent_session_unknown" });
});

test("server credentials are removed from an inherited environment", () => {
  const env = Object.fromEntries([...SERVER_CREDENTIAL_ENV, "PATH", WIKI_AGENT_TICKET_ENV].map((name) => [name, `${name}-value`]));
  expect(Object.keys(withoutServerCredentials(env)).sort()).toEqual([WIKI_AGENT_TICKET_ENV, "PATH"]);
});

// See coordination record. Each chat stays limited to its own workspace, directory and registration.
test("a chat in client B uses B's tools after client A in the same run, and A keeps working", async () => {
  const { config, a, b, request } = await fixture();
  expect((await authenticateWikiAgentRequest(config, request("/workspace/ws_a/files/content?path=x", { session: "chat_a", directory: a })))?.workspaceId).toBe("ws_a");
  await grantWikiAgentSession(config, { sessionId: "chat_b", directory: b, scope: "collaborator" });
  const own = await authenticateWikiAgentRequest(config, request("/workspace/ws_b/files/content?path=private.md", { session: "chat_b", directory: b }));
  expect(own).toMatchObject({ workspaceId: "ws_b", sessionId: "chat_b", directory: b });
  expect((await authenticateWikiAgentRequest(config, request("/workspace/ws_a/files/content?path=x", { session: "chat_a", directory: a })))?.workspaceId).toBe("ws_a");
});

test("after B opened, neither client's chat reaches the other's workspace or directory", async () => {
  const { config, a, b, request } = await fixture();
  await grantWikiAgentSession(config, { sessionId: "chat_b", directory: b, scope: "collaborator" });
  await authenticateWikiAgentRequest(config, request("/workspace/ws_b/files/content?path=x", { session: "chat_b", directory: b }));
  await expect(authenticateWikiAgentRequest(config, request("/workspace/ws_b/files/content?path=private.md", { session: "chat_a", directory: a }))).rejects.toMatchObject({ status: 403, code: "wiki_agent_workspace_denied" });
  await expect(authenticateWikiAgentRequest(config, request("/workspace/ws_a/files/content?path=x", { session: "chat_b", directory: b }))).rejects.toMatchObject({ status: 403, code: "wiki_agent_workspace_denied" });
  await expect(authenticateWikiAgentRequest(config, request("/workspace/ws_b/files/content?path=private.md", { session: "chat_a", directory: b }))).rejects.toMatchObject({ status: 403, code: "wiki_agent_directory_mismatch" });
  await expect(authenticateWikiAgentRequest(config, request("/workspace/ws_b/files/content?path=private.md", { session: "unregistered", directory: b }))).rejects.toMatchObject({ status: 403, code: "wiki_agent_session_unknown", message: CHAT_NOT_REGISTERED });
});

test("two client directories inside one office workspace cannot borrow each other's existing sessions", async () => {
  const {config, a, request} = await fixture();
  const clientA = join(a, "office", "AK", "A"), clientB = join(a, "office", "AK", "B");
  await mkdir(clientA, {recursive: true}); await mkdir(clientB, {recursive: true});
  // Use a fresh host runtime so the first trusted grant is the selected client directory.
  const selected = {...config};
  const profile = join(runtimeStorageDir(selected), "lawoss-onboarding");
  await mkdir(profile, {recursive: true});
  await writeFile(join(profile, "profile.json"), JSON.stringify({officeRoot: a, clientRoot: clientA}));
  const token = await ensureWikiAgentToken(selected);
  await grantWikiAgentSession(selected, {sessionId: "client_a", directory: clientA, scope: "collaborator"});
  await grantWikiAgentSession(selected, {sessionId: "client_b", directory: clientB, scope: "collaborator"});
  const attack = request("/workspace/ws_a/files/content?path=office/AK/B/private.md", {session: "client_b", directory: clientB});
  attack.headers.set("x-legalwork-wiki-agent-token", token);
  await expect(authenticateWikiAgentRequest(selected, attack)).rejects.toMatchObject({code: "wiki_agent_client_workspace_required"});
  const broadRead = request("/workspace/ws_a/files/content?path=office/AK/B/private.md", {session: "client_a", directory: clientA});
  broadRead.headers.set("x-legalwork-wiki-agent-token", token);
  await expect(authenticateWikiAgentRequest(selected, broadRead)).rejects.toMatchObject({code: "wiki_agent_client_workspace_required"});
});


test("registered client workspace retains child matter tools and the process cannot borrow a higher role", async () => {
  const {config, a, request} = await fixture();
  const matter = join(a, "matter"); await mkdir(matter);
  await grantWikiAgentSession(config, {sessionId: "matter", directory: matter, scope: "owner"});
  expect((await authenticateWikiAgentRequest(config, request("/workspace/ws_a/files/content?path=x", {session: "matter", directory: matter})))?.actor.scope).toBe("collaborator");
  await grantWikiAgentSession(config, {sessionId: "viewer", directory: matter, scope: "viewer"});
  expect((await authenticateWikiAgentRequest(config, request("/workspace/ws_a/files/content?path=x", {session: "matter", directory: matter})))?.actor.scope).toBe("viewer");
});

test("a chat reads case memory only through its own client's route (lawoss_memory)", async () => {
  const { config, request } = await fixture();
  expect((await authenticateWikiAgentRequest(config, request("/workspace/ws_a/lawoss/memory/read", { session: "chat_a", method: "POST", body: { action: "read", matter: "/x" } })))?.workspaceId).toBe("ws_a");
  await expect(authenticateWikiAgentRequest(config, request("/workspace/ws_b/lawoss/memory/read", { session: "chat_a", method: "POST", body: {} }))).rejects.toMatchObject({ code: "wiki_agent_workspace_denied" });
  // Writing (lawoss_memory_write, N-A7-10): this client only and bound to this chat, like lawoss/files/apply.
  expect((await authenticateWikiAgentRequest(config, request("/workspace/ws_a/lawoss/memory/write", { session: "chat_a", method: "POST", body: { sessionID: "chat_a" } })))?.workspaceId).toBe("ws_a");
  await expect(authenticateWikiAgentRequest(config, request("/workspace/ws_a/lawoss/memory/write", { session: "chat_a", method: "POST", body: { sessionID: "chat_b" } }))).rejects.toMatchObject({ code: "wiki_agent_session_mismatch" });
  await expect(authenticateWikiAgentRequest(config, request("/workspace/ws_b/lawoss/memory/write", { session: "chat_a", method: "POST", body: { sessionID: "chat_a" } }))).rejects.toMatchObject({ code: "wiki_agent_workspace_denied" });
  await expect(authenticateWikiAgentRequest(config, request("/workspace/ws_a/lawoss/memory/delete", { session: "chat_a", method: "POST", body: {} }))).rejects.toMatchObject({ code: "wiki_agent_endpoint_denied" });
  await expect(authenticateWikiAgentRequest(config, request("/workspace/ws_a/lawoss/memory/read", { session: "chat_a" }))).rejects.toMatchObject({ code: "wiki_agent_endpoint_denied" });
});

// LAWOSS: the native command plugin reads its definitions per engine location, before any chat exists.
test("the location credential finds only its own workspace and reads only its command definitions", async () => {
  const { config, a, b } = await fixture();
  const token = await ensureWikiAgentToken(config);
  const located = (path: string, location: string | null, method = "GET", extra: Record<string, string> = {}) => new Request(`http://127.0.0.1${path}`, {
    method, headers: { "x-legalwork-wiki-agent-token": token, ...(location === null ? {} : { [WIKI_AGENT_LOCATION_HEADER]: encodeURIComponent(location) }), ...extra } });
  const definitions = (workspace: string, directory: string) => `/workspace/${workspace}/commands/definitions?${new URLSearchParams({ directory })}`;
  const own = await authenticateWikiAgentRequest(config, located(definitions("ws_a", a), a));
  expect(own).toMatchObject({ location: true, workspaceId: "ws_a", directory: a, sessionId: "", allProjects: false, actor: { scope: "collaborator", clientId: "wiki-agent:location:ws_a" } });
  // A case folder inside A is A's location.
  const matter = join(a, "Spisy", "Úhrada"); await mkdir(matter, { recursive: true });
  expect((await authenticateWikiAgentRequest(config, located(definitions("ws_a", matter), matter)))?.workspaceId).toBe("ws_a");
  expect((await authenticateWikiAgentRequest(config, located("/workspaces", b)))?.workspaceId).toBe("ws_b");
  // Another client's workspace or directory.
  await expect(authenticateWikiAgentRequest(config, located(definitions("ws_b", b), a))).rejects.toMatchObject({ code: "wiki_agent_workspace_denied" });
  await expect(authenticateWikiAgentRequest(config, located(definitions("ws_a", a), b))).rejects.toMatchObject({ code: "wiki_agent_workspace_denied" });
  await expect(authenticateWikiAgentRequest(config, located(definitions("ws_a", matter), a))).rejects.toMatchObject({ code: "wiki_agent_directory_mismatch" });
  await expect(authenticateWikiAgentRequest(config, located("/workspace/ws_a/commands/definitions", a))).rejects.toMatchObject({ code: "wiki_agent_directory_mismatch" });
  // Nothing else: no other read, no write, no chat route.
  for (const [path, method] of [["/workspace/ws_a/files/content?path=x", "GET"], ["/workspace/ws_a/skills", "GET"], ["/workspace/ws_a/sandbox/command", "POST"],
    ["/workspace/ws_a/commands/definitions", "POST"], ["/workspaces/projects", "POST"], ["/workspace/ws_a/opencode/api/session", "GET"], ["/wikis", "GET"]] as const)
    await expect(authenticateWikiAgentRequest(config, located(path, a, method))).rejects.toMatchObject({ code: "wiki_agent_endpoint_denied" });
  // An unresolvable or relative location, or a folder outside every client.
  await expect(authenticateWikiAgentRequest(config, located("/workspaces", join(a, "missing")))).rejects.toMatchObject({ code: "wiki_agent_directory_mismatch" });
  await expect(authenticateWikiAgentRequest(config, located("/workspaces", "a"))).rejects.toMatchObject({ code: "wiki_agent_directory_mismatch" });
  await expect(authenticateWikiAgentRequest(config, located("/workspaces", tmpdir()))).rejects.toMatchObject({ code: "wiki_agent_workspace_denied" });
  // A chat header takes the chat path: an unregistered chat is refused even with a valid location.
  await expect(authenticateWikiAgentRequest(config, located("/workspaces", a, "GET", { "x-legalwork-wiki-agent-session": "unregistered", "x-legalwork-wiki-agent-directory": encodeURIComponent(a) })))
    .rejects.toMatchObject({ code: "wiki_agent_session_unknown" });
  // Without the secret the location claim is nothing.
  const forged = new Request(`http://127.0.0.1${definitions("ws_a", a)}`, { headers: { "x-legalwork-wiki-agent-token": "forged", [WIKI_AGENT_LOCATION_HEADER]: encodeURIComponent(a) } });
  await expect(authenticateWikiAgentRequest(config, forged)).rejects.toMatchObject({ code: "wiki_agent_unauthorized" });
  expect(await authenticateWikiAgentRequest(config, new Request(`http://127.0.0.1${definitions("ws_a", a)}`, { headers: { [WIKI_AGENT_LOCATION_HEADER]: encodeURIComponent(a) } }))).toBeNull();
  // A viewer chat lowers the process credential; the location read follows it.
  await grantWikiAgentSession(config, { sessionId: "viewer", directory: a, scope: "viewer" });
  expect((await authenticateWikiAgentRequest(config, located(definitions("ws_a", a), a)))?.actor.scope).toBe("viewer");
});

test("the location credential keeps the client boundary of the practice", async () => {
  const { config, a } = await fixture();
  const profile = join(runtimeStorageDir(config), "lawoss-onboarding");
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, "profile.json"), JSON.stringify({ officeRoot: a, clientRoot: join(a, "Klient") }));
  await mkdir(join(a, "Klient"));
  const token = await ensureWikiAgentToken(config);
  const request = new Request(`http://127.0.0.1/workspaces`, { headers: { "x-legalwork-wiki-agent-token": token, [WIKI_AGENT_LOCATION_HEADER]: encodeURIComponent(a) } });
  await expect(authenticateWikiAgentRequest(config, request)).rejects.toMatchObject({ code: "wiki_agent_client_workspace_required" });
});
