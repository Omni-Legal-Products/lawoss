import { scopedWikiRuntime } from "./scoped-runtime.test-helper.js";
import { enforceAiBoundaries } from "../lawoss/test-support/ai-boundaries.js";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../server.js";
import { registerLocalProject } from "../routes/workspaces.js";
import { LegalWorkWikiTools } from "../opencode-plugins/legalwork-wiki-tools.js";
import { ensureWikiAgentToken, grantWikiAgentSession } from "./agent-access.js";
import { WikiStore } from "./store.js";
import type { ServerConfig } from "../types.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });

test("wiki tools respect project access without overriding host file access", async () => {
  const root = await mkdtemp(join(tmpdir(), "wiki-file-policy-api-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "file-policy-client", hostToken: "file-policy-host", configPath: join(root, "private", "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false,
    startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false, agentSandboxEnabled: false,
  };
  const { workspace } = await registerLocalProject(config, { folderPath: join(root, "project"), name: "Project", preset: "starter" });
  const enginePosts: string[] = [];
  const engine = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (request.method === "POST") enginePosts.push(await request.text());
    return Response.json({});
  }});
  cleanup.push(async () => {engine.stop(true);});
  workspace.baseUrl = engine.url.origin;
  const store = new WikiStore(config); cleanup.push(() => store.close());
  const wiki = await store.create({ name: "Private disabled wiki", template: "blank" });
  await store.update(wiki.id, { allowInProjects: false });
  const token = await ensureWikiAgentToken(config);
  await grantWikiAgentSession(config, { sessionId: "project-session", directory: workspace.path, scope: "owner" });
  await grantWikiAgentSession(config, { sessionId: "wiki-session", directory: wiki.root, scope: "owner" });
  const server = await startServer(config); cleanup.push(async () => { await server.stop(); });
  // #168 denial expectation for the project shell: „AI hranice" on explicitly.
  await enforceAiBoundaries(config);
  const base = `http://127.0.0.1:${server.port}`;
  const previous = { url: process.env.LEGALWORK_SERVER_URL, token: process.env.LEGALWORK_SERVER_TOKEN, agent: process.env.LEGALWORK_WIKI_AGENT_TOKEN };
  process.env.LEGALWORK_SERVER_URL = base; process.env.LEGALWORK_SERVER_TOKEN = config.token; process.env.LEGALWORK_WIKI_AGENT_TOKEN = token;
  cleanup.push(async () => {
    for (const [key, value] of Object.entries({ LEGALWORK_SERVER_URL: previous.url, LEGALWORK_SERVER_TOKEN: previous.token, LEGALWORK_WIKI_AGENT_TOKEN: previous.agent }))
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
  });
  const project = await LegalWorkWikiTools({ directory: workspace.path });
  await expect(project["tool.execute.before"]({ tool: "read", sessionID: "project-session" }, { args: { filePath: join(root, "outside.txt") } })).resolves.toBeUndefined();
  expect(project).not.toHaveProperty("shell.env");
  // The shared project credential cannot become a wiki credential by naming another session.
  const denied = await fetch(`${base}/wikis/file-policy`, { headers: {
    "x-legalwork-wiki-agent-token": token, "x-legalwork-wiki-agent-session": "wiki-session",
    "x-legalwork-wiki-agent-directory": encodeURIComponent(wiki.root),
  } });
  expect(denied.status).toBe(403);
  expect(await denied.json()).toMatchObject({ code: "wiki_agent_client_runtime_required" });
  const wikiRuntime = await scopedWikiRuntime(config,"wiki-session",wiki.root);
  cleanup.push(() => wikiRuntime.close());
  expect(wikiRuntime.config === config).toBe(false);
  expect(wikiRuntime.headers()["x-legalwork-wiki-agent-token"] === token).toBe(false);
  const ownWiki = await wikiRuntime.run(() => LegalWorkWikiTools({ directory: wiki.root }));
  await expect(wikiRuntime.run(() => ownWiki["tool.execute.before"]({ tool: "read", sessionID: "wiki-session" }, { args: { filePath: join(workspace.path, "outside.txt") } }))).rejects.toMatchObject({ code: "wiki_native_project_access" });
  await expect(wikiRuntime.run(() => ownWiki["tool.execute.before"]({ tool: "write", sessionID: "wiki-session" }, { args: { filePath: join(workspace.path, "new.txt") } }))).rejects.toMatchObject({ code: "wiki_native_project_access" });
  await expect(wikiRuntime.run(() => ownWiki["tool.execute.before"]({ tool: "read", sessionID: "wiki-session" }, { args: { filePath: join(wiki.root, "AGENTS.md") } }))).resolves.toBeUndefined();
  expect(JSON.parse(await project.tool.wiki_list.execute({}, { sessionID: "project-session" })).wikis).toEqual([]);
  const headers = { authorization: `Bearer ${config.token}`, "x-legalwork-host-token": config.hostToken, "content-type": "application/json" };
  for (const [path, code] of [["/session/project-session/shell", "ai_transfer_denied"], ["/pty", "sandbox_required"]]) {
    const response = await fetch(`${base}/workspace/${workspace.id}/opencode${path}`, { method: "POST", headers, body: JSON.stringify({command: "SYNTHETIC_DENIED_SHELL_CANARY"}) });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code });
  }
  expect(enginePosts).toEqual([]);
});
