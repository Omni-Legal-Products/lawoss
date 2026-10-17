import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { startEmbeddedServer } from "../embedded.js";
import { grantWikiAgentSession } from "../wiki/agent-access.js";

/**
 * LAWOSS: one managed engine serves every client folder. Its plugins may reach only the
 * workspace of the chat that runs them. The fake engine below calls the server with nothing
 * but what it inherited, the way a plugin (or a shell reading its environment) would.
 */
const engine = `#!${process.execPath}
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const server = Bun.serve({ hostname: "127.0.0.1", port, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/global/health") return Response.json({ healthy: true, version: "synthetic-test" });
  if (url.pathname !== "/probe") return Response.json({ healthy: true });
  const calls = await request.json();
  const results = [];
  for (const call of calls) {
    const headers = { "content-type": "application/json", ...(call.bearer ? { authorization: "Bearer " + call.bearer } : {}) };
    if (call.session) Object.assign(headers, {
      "x-legalwork-wiki-agent-token": process.env.LEGALWORK_WIKI_AGENT_TOKEN,
      "x-legalwork-wiki-agent-session": call.session,
      "x-legalwork-wiki-agent-directory": encodeURIComponent(call.directory),
    });
    else if (call.engineOnly) headers["x-legalwork-wiki-agent-token"] = process.env.LEGALWORK_WIKI_AGENT_TOKEN;
    const response = await fetch(process.env.LEGALWORK_SERVER_URL + call.path, { method: call.method ?? "GET", headers, body: call.body === undefined ? undefined : JSON.stringify(call.body) });
    results.push({ status: response.status, body: await response.text() });
  }
  return Response.json({ environment: JSON.stringify(process.env), results });
} });
console.log("opencode server listening on http://127.0.0.1:" + server.port);
`;

const probeSchema = z.object({ environment: z.string(), results: z.array(z.object({ status: z.number(), body: z.string() })) });
type Call = { path: string; method?: string; session?: string; directory?: string; body?: unknown; bearer?: string; engineOnly?: boolean };

// The fake engine is a shebang script (as in embedded.test.ts); the route rules themselves
// also run on Windows in engine-agent-routes.test.ts.
const boundary = test.skipIf(process.platform === "win32");

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });

async function twoClients() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-engine-boundary-")));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const previous = { ...process.env };
  cleanup.push(async () => {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  });
  for (const key of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "LEGALWORK_RUNTIME_DB", "LEGALWORK_TOKEN_STORE", "LEGALWORK_STORAGE_STORE"])
    process.env[key] = join(root, key);
  delete process.env.LEGALWORK_OPENCODE_BASE_URL;
  delete process.env.OPENCODE_DB;
  // Desktop child-server mode and the orchestrator hand the server its tokens this way.
  process.env.LEGALWORK_TOKEN = "client-token-from-env";
  process.env.LEGALWORK_HOST_TOKEN = "host-token-from-env";
  const clientA = join(root, "Klient A"), clientB = join(root, "Klient B");
  await mkdir(clientA); await mkdir(clientB);
  await writeFile(join(clientA, "poznamka.md"), "Spis klienta A");
  await writeFile(join(clientB, "tajne.md"), "DÔVERNÉ KLIENTA B");
  const bin = join(root, "engine");
  await writeFile(bin, engine); await chmod(bin, 0o755);
  const logs: string[] = [];
  for (const method of ["log", "info", "warn", "error"] as const) {
    const original = console[method];
    console[method] = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); original(...args); };
    cleanup.push(async () => { console[method] = original; });
  }
  const server = await startEmbeddedServer({
    host: "127.0.0.1", port: 0, workspaces: [clientA, clientB],
    configPath: join(root, "server.json"), readOnly: false, logRequests: true,
    token: "client-token", hostToken: "host-token", manageOpencode: true, opencodeBin: bin,
  });
  cleanup.push(() => server.stop());
  const [a, b] = server.config.workspaces;
  if (!a || !b) throw new Error("Both client folders must be registered");
  await grantWikiAgentSession(server.config, { sessionId: "ses_klient_a", directory: clientA, scope: "collaborator" });
  await grantWikiAgentSession(server.config, { sessionId: "ses_klient_b", directory: clientB, scope: "collaborator" });
  await grantWikiAgentSession(server.config, { sessionId: "ses_viewer_a", directory: clientA, scope: "viewer" });
  const probe = async (calls: Call[]) => probeSchema.parse(await (await fetch(`${server.config.opencodeBaseUrl}/probe`, { method: "POST", body: JSON.stringify(calls) })).json());
  const asA = (path: string, extra: Omit<Call, "path" | "session" | "directory"> = {}): Call => ({ path, session: "ses_klient_a", directory: clientA, ...extra });
  return { server, a, b, clientA, clientB, probe, asA, logs };
}

boundary("the engine never inherits a server-wide or host token", async () => {
  const { server, probe } = await twoClients();
  const { environment } = await probe([]);
  for (const secret of ["client-token", "host-token", "client-token-from-env", "host-token-from-env"])
    expect(environment).not.toContain(`"${secret}"`);
  for (const name of ["LEGALWORK_SERVER_TOKEN", "LEGALWORK_TOKEN", "LEGALWORK_HOST_TOKEN"])
    expect(environment).not.toContain(`"${name}"`);
  const names = server.managedOpencodeExecution?.env.map((entry) => entry.name) ?? [];
  expect(names).toContain("LEGALWORK_WIKI_AGENT_TOKEN");
  expect(names).not.toContain("LEGALWORK_SERVER_TOKEN");
}, 30_000);

boundary("a chat in client A gets neither files nor metadata of client B", async () => {
  const { a, b, probe, asA } = await twoClients();
  const forB = (route: string, method = "GET", body?: unknown) => asA(`/workspace/${encodeURIComponent(b.id)}/${route}`, { method, body });
  const { results } = await probe([
    forB("files/content?path=tajne.md"),
    forB("files/list"),
    forB("files/raw?path=tajne.md"),
    forB("project/contents"),
    forB("project/content?kind=files&id=tajne.md"),
    forB("project/setup"),
    forB("project/metadata", "PATCH", { revision: 0, values: {} }),
    forB("tasks"),
    forB("office-tools/status"),
    forB("personalization"),
    forB("lawoss/memory/grants"),
    forB("lawoss/documents"),
    forB("skills"),
    // The engine's own API and server settings are closed even for the chat's own project.
    asA(`/workspace/${encodeURIComponent(a.id)}/config`),
    asA(`/workspace/${encodeURIComponent(a.id)}/mcp`),
    asA(`/workspace/${encodeURIComponent(a.id)}/opencode/session`),
    asA(`/workspace/${encodeURIComponent(a.id)}/files/list`),
    asA("/tokens"),
    // Host and owner-only routes stay closed to the engine credential.
    asA("/workspaces/project-defaults"),
    asA("/workspaces/project-templates", { method: "PUT", body: {} }),
    asA(`/workspace/${encodeURIComponent(a.id)}/sandbox/session/ses_klient_a`, { method: "PATCH", body: {} }),
  ]);
  for (const result of results) {
    expect(result.status).toBe(403);
    expect(result.body).not.toContain("DÔVERNÉ");
  }
}, 30_000);

boundary("a chat cannot borrow another chat's folder, and the engine has no bearer token to fall back on", async () => {
  const { b, clientB, probe } = await twoClients();
  const { results } = await probe([
    // Claims client B's folder while naming client A's chat.
    { path: `/workspace/${encodeURIComponent(b.id)}/files/content?path=tajne.md`, session: "ses_klient_a", directory: clientB },
    // An unknown chat.
    { path: `/workspace/${encodeURIComponent(b.id)}/files/content?path=tajne.md`, session: "ses_unknown", directory: clientB },
    // Without the chat credential the engine has nothing left that the server accepts.
    { path: `/workspace/${encodeURIComponent(b.id)}/files/content?path=tajne.md`, bearer: "undefined" },
    { path: "/workspaces", bearer: "" },
  ]);
  expect(results.map((result) => result.status)).toEqual([403, 403, 401, 401]);
  for (const result of results) expect(result.body).not.toContain("DÔVERNÉ");
}, 30_000);

boundary("plugin calls for client A still work and list only client A", async () => {
  const { a, probe, asA, clientA } = await twoClients();
  const own = (route: string, method = "GET", body?: unknown) => asA(`/workspace/${encodeURIComponent(a.id)}/${route}`, { method, body });
  const { results } = await probe([
    asA("/workspaces"),
    own("files/content?path=poznamka.md"),
    own("project/contents"),
    own("project/setup"),
    own("tasks"),
    own("office-tools/status"),
    own("personalization"),
    own("skills"),
    own("lawoss/documents"),
    asA("/org-policy/guard"),
    asA("/scheduled-tasks/projects"),
    // The firm's guard applies even to a chat the server has not recorded yet.
    { path: "/org-policy/guard", engineOnly: true },
  ]);
  const [listed, ...rest] = results;
  expect(rest.map((result) => result.status)).toEqual(rest.map(() => 200));
  const items = z.object({ items: z.array(z.object({ id: z.string(), path: z.string() })) }).parse(JSON.parse(listed?.body ?? "{}")).items;
  expect(items.map((item) => item.id)).toEqual([a.id]);
  expect(listed?.body).not.toContain("Klient B");
  expect(rest[0]?.body).toContain("Spis klienta A");
  const projects = z.object({ projects: z.array(z.object({ id: z.string() })) }).parse(JSON.parse(rest[9]?.body ?? "{}")).projects;
  expect(projects.map((project) => project.id)).toEqual([a.id]);
  expect(clientA).toContain("Klient A");
}, 30_000);

boundary("a chat started by a viewer stays a viewer through the engine", async () => {
  const { a, probe } = await twoClients();
  const { results } = await probe([
    { path: `/workspace/${encodeURIComponent(a.id)}/files/content?path=poznamka.md`, session: "ses_viewer_a", directory: (await realpath(a.path)) },
    { path: `/workspace/${encodeURIComponent(a.id)}/files/content`, method: "POST", session: "ses_viewer_a", directory: (await realpath(a.path)), body: { path: "poznamka.md", content: "prepísané" } },
  ]);
  expect(results.map((result) => result.status)).toEqual([200, 403]);
}, 30_000);

boundary("an agent cannot schedule work across all clients", async () => {
  const { a, probe, asA } = await twoClients();
  const { results } = await probe([
    asA(`/workspace/${encodeURIComponent(a.id)}/scheduled-tasks`, { method: "POST", body: { title: "Prehľad", prompt: "Prečítaj všetkých klientov", projectAccess: "all", schedule: { kind: "once", at: new Date(Date.now() + 3_600_000).toISOString() } } }),
  ]);
  expect(results[0]?.status).toBe(403);
  expect(results[0]?.body).toContain("wiki_agent_project_access");
}, 30_000);

boundary("neither the engine credential nor a server token appears in the server log", async () => {
  const { server, probe, asA, a, b, logs } = await twoClients();
  await probe([asA("/workspaces"), asA(`/workspace/${encodeURIComponent(b.id)}/files/content?path=tajne.md`), asA(`/workspace/${encodeURIComponent(a.id)}/tasks`)]);
  const agentToken = server.managedOpencodeExecution?.env.find((entry) => entry.name === "LEGALWORK_WIKI_AGENT_TOKEN");
  expect(agentToken?.redacted).toBe(true);
  expect(agentToken?.value).toBe("<redacted>");
  const { environment } = await probe([]);
  const secret = z.record(z.string(), z.string()).parse(JSON.parse(environment)).LEGALWORK_WIKI_AGENT_TOKEN ?? "";
  expect(secret.length).toBeGreaterThan(16);
  expect(logs.length).toBeGreaterThan(0);
  const text = logs.join("\n");
  for (const value of [secret, "client-token", "host-token", "client-token-from-env", "host-token-from-env"]) expect(text).not.toContain(value);
}, 30_000);
