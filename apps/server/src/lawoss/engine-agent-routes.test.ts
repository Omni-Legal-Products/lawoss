import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "../types.js";
import { authenticateWikiAgentRequest, ensureWikiAgentToken, grantWikiAgentSession } from "../wiki/agent-access.js";
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

test("only a scheduled all-projects run reads another project, and only its contents", async () => {
  const { config, a, request } = await fixture();
  await expect(authenticateWikiAgentRequest(config, request("/workspace/ws_b/project/contents", { session: "chat_a" }))).rejects.toMatchObject({ code: "wiki_agent_workspace_denied" });
  await grantWikiAgentSession(config, { sessionId: "scheduled_all", directory: a, scope: "collaborator", allProjects: true });
  const scheduled = await authenticateWikiAgentRequest(config, request("/workspace/ws_b/project/contents", { session: "scheduled_all" }));
  expect(scheduled?.allProjects).toBe(true);
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
  const env = Object.fromEntries([...SERVER_CREDENTIAL_ENV, "PATH", "LEGALWORK_WIKI_AGENT_TOKEN"].map((name) => [name, `${name}-value`]));
  expect(Object.keys(withoutServerCredentials(env)).sort()).toEqual(["LEGALWORK_WIKI_AGENT_TOKEN", "PATH"]);
});
