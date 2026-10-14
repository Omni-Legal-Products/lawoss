import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "../types.js";
import { authenticateWikiAgentRequest, configureWikiAgentSessionLookup, ensureWikiAgentToken, grantWikiAgentSession } from "./agent-access.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "legalwork-wiki-origin-"));
  roots.push(root);
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "collaborator", hostToken: "host",
    configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"],
    workspaces: [{ id: "project", name: "Project", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli",
    logFormat: "pretty", logRequests: false };
  const token = await ensureWikiAgentToken(config);
  const request = (path = "/wikis", input?: { token?: string; session?: string; directory?: string; method?: string }) =>
    new Request(`http://127.0.0.1${path}`, { method: input?.method ?? "GET", headers: {
      "x-legalwork-wiki-agent-token": input?.token ?? token,
      "x-legalwork-wiki-agent-session": input?.session ?? "session-1",
      "x-legalwork-wiki-agent-directory": encodeURIComponent(input?.directory ?? root),
    } });
  return { root, config, token, request };
}

test("runtime credential is stable per running server and never an owner/host credential", async () => {
  const { config, token, request } = await fixture();
  expect(await ensureWikiAgentToken(config)).toBe(token);
  expect(token).not.toBe(config.token);
  expect(token).not.toBe(config.hostToken);
  expect(await authenticateWikiAgentRequest(config, new Request("http://localhost/wikis"))).toBeNull();
  await expect(authenticateWikiAgentRequest(config, request())).rejects.toMatchObject({ code: "wiki_agent_session_unknown" });
  await expect(authenticateWikiAgentRequest(config, request("/wikis", { token: config.hostToken }))).rejects.toMatchObject({ code: "wiki_agent_unauthorized" });
});

test("server-recorded origin controls actor scope and collaborator takeover downgrades immediately", async () => {
  const { config, root, request } = await fixture();
  await grantWikiAgentSession(config, { sessionId: "session-1", directory: root, scope: "owner" });
  const owner = await authenticateWikiAgentRequest(config, request());
  expect(owner?.actor.scope).toBe("owner");
  expect(owner?.actor.type).toBe("remote");
  await grantWikiAgentSession(config, { sessionId: "session-1", directory: root, scope: "collaborator" });
  expect((await authenticateWikiAgentRequest(config, request()))?.actor.scope).toBe("collaborator");
  await grantWikiAgentSession(config, { sessionId: "session-1", directory: root, scope: "viewer" });
  expect((await authenticateWikiAgentRequest(config, request()))?.actor.scope).toBe("viewer");
});

test("session directory claims require the canonical recorded directory", async () => {
  const { config, root, request } = await fixture();
  await grantWikiAgentSession(config, { sessionId: "session-1", directory: root, scope: "owner" });
  const alias = `${root}-alias`;
  roots.push(alias);
  await symlink(root, alias);
  expect((await authenticateWikiAgentRequest(config, request("/wikis", { directory: alias })))?.directory).toBe(await realpath(root));
  const other = join(root, "other");
  await mkdir(other);
  await expect(authenticateWikiAgentRequest(config, request("/wikis", { directory: other }))).rejects.toMatchObject({ code: "wiki_agent_directory_mismatch" });
  await expect(grantWikiAgentSession(config, { sessionId: "session-1", directory: other, scope: "owner" })).rejects.toMatchObject({ code: "wiki_agent_directory_mismatch" });
});

test("Unicode directories use encoded headers and unavailable remote directories revoke stale grants", async () => {
  const { config, root, request } = await fixture();
  const unicode = join(root, "Prüfung 東京");
  await mkdir(unicode);
  await grantWikiAgentSession(config, { sessionId: "session-1", directory: unicode, scope: "owner" });
  expect((await authenticateWikiAgentRequest(config, request("/wikis", { directory: unicode })))?.directory).toBe(await realpath(unicode));
  await grantWikiAgentSession(config, { sessionId: "session-1", directory: join(root, "remote-unavailable"), scope: "collaborator" });
  await expect(authenticateWikiAgentRequest(config, request("/wikis", { directory: unicode }))).rejects.toMatchObject({ code: "wiki_agent_session_unknown" });
});

test("runtime auth permits only the page tool endpoints and refuses broader management/proxy access", async () => {
  const { config, root, request } = await fixture();
  await grantWikiAgentSession(config, { sessionId: "session-1", directory: root, scope: "owner" });
  for (const [path, method] of [["/wikis", "GET"], ["/wikis/wiki-id", "GET"], ["/workspaces", "GET"], ["/wikis/wiki-id/search?q=note", "GET"],
    ["/wikis/wiki-id/page?path=Note.md", "GET"], ["/wikis/wiki-id/page", "PUT"], ["/wikis/wiki-id/page", "DELETE"]])
    expect((await authenticateWikiAgentRequest(config, request(path, { method })))?.actor.scope).toBe("owner");
  for (const [path, method] of [["/wikis/deleted", "GET"], ["/wikis/wiki-id/archive", "POST"], ["/wikis/wiki-id/restore-wiki", "POST"], ["/wikis", "POST"], ["/wikis/wiki-id", "PATCH"], ["/workspaces", "POST"],
    ["/workspace/project/opencode/session", "POST"], ["/tokens", "GET"], ["/wikis/wiki-id/restore", "POST"],
    ["/wikis/team", "GET"], ["/wikis/join", "POST"], ["/wikis/wiki-id/share", "POST"],
    ["/wikis/wiki-id/share", "PATCH"], ["/wikis/wiki-id/share", "DELETE"]])
    await expect(authenticateWikiAgentRequest(config, request(path, { method }))).rejects.toMatchObject({ code: "wiki_agent_endpoint_denied" });
});

test("engine-verified descendants inherit current ancestor scope without becoming independent grants", async () => {
  const { config, root, request } = await fixture();
  await grantWikiAgentSession(config, { sessionId: "parent", directory: root, scope: "owner" });
  const parents: Record<string, string | undefined> = { grandchild: "child", child: "parent", parent: undefined };
  configureWikiAgentSessionLookup(config, async (workspace, id, directory) => {
    expect(workspace.id).toBe("project");
    expect(directory).toBe(await realpath(root));
    return { id, directory: root, parentID: parents[id] };
  });
  const descendant = request("/wikis", { session: "grandchild" });
  expect(await authenticateWikiAgentRequest(config, descendant)).toMatchObject({ sessionId: "grandchild", actor: { clientId: "wiki-agent:grandchild", scope: "owner" } });
  await grantWikiAgentSession(config, { sessionId: "parent", directory: root, scope: "collaborator" });
  expect((await authenticateWikiAgentRequest(config, descendant))?.actor.scope).toBe("collaborator");
  await grantWikiAgentSession(config, { sessionId: "parent", directory: join(root, "unavailable"), scope: "owner" });
  await expect(authenticateWikiAgentRequest(config, descendant)).rejects.toMatchObject({ code: "wiki_agent_session_unknown" });
});

test("claimed parents, mismatched engine IDs and changed directories cannot grant descendant access", async () => {
  const { config, root, request } = await fixture();
  const other = join(root, "other");
  await mkdir(other);
  await grantWikiAgentSession(config, { sessionId: "parent", directory: root, scope: "owner" });
  const child = request("/wikis", { session: "child" });
  child.headers.set("x-legalwork-wiki-agent-parent-session", "parent");
  for (const record of [
    { id: "child", directory: root },
    { id: "different-child", directory: root, parentID: "parent" },
    { id: "child", directory: other, parentID: "parent" },
    { id: "child", directory: root, parentID: ["parent"] },
  ]) {
    configureWikiAgentSessionLookup(config, async () => record);
    await expect(authenticateWikiAgentRequest(config, child)).rejects.toMatchObject({ code: "wiki_agent_session_unknown" });
  }
  configureWikiAgentSessionLookup(config, async () => { throw new Error("Unavailable engine"); });
  await expect(authenticateWikiAgentRequest(config, child)).rejects.toMatchObject({ code: "wiki_agent_session_unknown" });
});

test("cycles and excessive ancestry fail closed, and revoked ancestors cannot fall back to an older grant", async () => {
  const { config, root, request } = await fixture();
  const child = request("/wikis", { session: "child" });
  configureWikiAgentSessionLookup(config, async (_workspace, id) => ({ id, directory: root, parentID: id === "child" ? "loop" : "child" }));
  await expect(authenticateWikiAgentRequest(config, child)).rejects.toMatchObject({ code: "wiki_agent_session_unknown" });
  let lookups = 0;
  configureWikiAgentSessionLookup(config, async (_workspace, id) => ({ id, directory: root, parentID: `ancestor-${++lookups}` }));
  await expect(authenticateWikiAgentRequest(config, child)).rejects.toMatchObject({ code: "wiki_agent_session_unknown" });
  expect(lookups).toBe(64);
  await grantWikiAgentSession(config, { sessionId: "older", directory: root, scope: "owner" });
  await grantWikiAgentSession(config, { sessionId: "parent", directory: root, scope: "owner" });
  await grantWikiAgentSession(config, { sessionId: "parent", directory: join(root, "unavailable"), scope: "owner" });
  configureWikiAgentSessionLookup(config, async (_workspace, id) => ({ id, directory: root, parentID: id === "child" ? "parent" : "older" }));
  await expect(authenticateWikiAgentRequest(config, child)).rejects.toMatchObject({ code: "wiki_agent_session_unknown" });
});

test("ancestor downgrades during engine lookup and explicit child grants cannot be elevated", async () => {
  const { config, root, request } = await fixture();
  await grantWikiAgentSession(config, { sessionId: "parent", directory: root, scope: "owner" });
  configureWikiAgentSessionLookup(config, async (_workspace, id) => {
    if (id === "parent") await grantWikiAgentSession(config, { sessionId: "parent", directory: root, scope: "viewer" });
    return { id, directory: root, ...(id === "child" ? { parentID: "parent" } : {}) };
  });
  expect((await authenticateWikiAgentRequest(config, request("/wikis", { session: "child" })))?.actor.scope).toBe("viewer");
  await grantWikiAgentSession(config, { sessionId: "parent", directory: root, scope: "owner" });
  await grantWikiAgentSession(config, { sessionId: "child", directory: root, scope: "collaborator" });
  configureWikiAgentSessionLookup(config, async () => { throw new Error("A directly registered child must not use ancestor permissions"); });
  expect((await authenticateWikiAgentRequest(config, request("/wikis", { session: "child" })))?.actor.scope).toBe("collaborator");
});

test("workspace tools retain the session origin and cannot borrow another workspace or chat", async () => {
  const { config, root, request } = await fixture();
  const nested = join(root, "wiki"); await mkdir(nested);
  config.workspaces.push({ id: "wiki", name: "Wiki", path: nested, preset: "starter", workspaceType: "local" });
  await grantWikiAgentSession(config, { sessionId: "session-1", directory: root, scope: "owner" });
  for (const path of ["/workspace/project/storage/roots", "/workspace/project/storage/source/children", "/workspace/project/sandbox/session/session-1"])
    expect((await authenticateWikiAgentRequest(config, request(path)))?.actor.scope).toBe("owner");
  await expect(authenticateWikiAgentRequest(config, request("/workspace/wiki/storage/roots"))).rejects.toMatchObject({ code: "wiki_agent_workspace_denied" });
  await expect(authenticateWikiAgentRequest(config, request("/workspace/project/sandbox/session/another-chat"))).rejects.toMatchObject({ code: "wiki_agent_session_mismatch" });
  await expect(authenticateWikiAgentRequest(config, request("/workspace/project/storage", { method: "POST" }))).rejects.toMatchObject({ code: "wiki_agent_endpoint_denied" });
  await expect(authenticateWikiAgentRequest(config, request("/workspace/project/sandbox/settings", { method: "POST" }))).rejects.toMatchObject({ code: "wiki_agent_endpoint_denied" });
  const shellRequest = request("/workspace/project/sandbox/execute", { method: "POST" });
  const shell = (sessionID: string) => new Request(shellRequest.url, { method: "POST", headers: shellRequest.headers, body: JSON.stringify({ sessionID, command: "pwd" }) });
  expect((await authenticateWikiAgentRequest(config, shell("session-1")))?.actor.scope).toBe("owner");
  await expect(authenticateWikiAgentRequest(config, shell("another-chat"))).rejects.toMatchObject({ code: "wiki_agent_session_mismatch" });
  await grantWikiAgentSession(config, { sessionId: "nested", directory: nested, scope: "owner" });
  expect((await authenticateWikiAgentRequest(config, request("/workspace/wiki/storage/roots", { session: "nested", directory: nested })))?.actor.scope).toBe("owner");
  await expect(authenticateWikiAgentRequest(config, request("/workspace/project/storage/roots", { session: "nested", directory: nested }))).rejects.toMatchObject({ code: "wiki_agent_workspace_denied" });
  await grantWikiAgentSession(config, { sessionId: "session-1", directory: root, scope: "viewer" });
  expect((await authenticateWikiAgentRequest(config, request("/workspace/project/storage/roots")))?.actor.scope).toBe("viewer");
});
