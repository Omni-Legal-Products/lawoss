import { afterEach, expect, spyOn, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startEmbeddedServer } from "./embedded.js";
import { serve } from "./serve-node.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { grantWikiAgentSession } from "./wiki/agent-access.js";
import * as managedOpencode from "./managed-opencode.js";
import * as fs from "node:fs/promises";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });

// The child calls back using only the credentials and address it actually
// inherited, rather than test code supplying the server's correct address.
const engine = `#!${process.execPath}
// Like the plugins: the first instance request loads them, which redeems the ticket once.
const ticket = process.env.LEGALWORK_WIKI_AGENT_TICKET;
delete process.env.LEGALWORK_WIKI_AGENT_TICKET;
let redemption;
const redeem = () => redemption ??= fetch(process.env.LEGALWORK_SERVER_URL + "/engine-agent/ticket", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket }) }).then((response) => response.json()).then((body) => body.secret);
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const server = Bun.serve({ hostname: "127.0.0.1", port, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/global/health") return Response.json({ healthy: true, version: "synthetic-test" });
  const secret = await redeem();
  if (url.pathname !== "/probe") return Response.json({ healthy: true });
  const results = [];
  for (const path of ["/wikis", "/workspace/" + url.searchParams.get("workspace") + "/storage/roots"]) {
    const response = await fetch(process.env.LEGALWORK_SERVER_URL + path, { headers: {
      "x-legalwork-wiki-agent-token": secret,
      "x-legalwork-wiki-agent-session": "verified-session",
      "x-legalwork-wiki-agent-directory": encodeURIComponent(url.searchParams.get("directory")),
    } });
    results.push({ path, status: response.status, data: await response.json() });
  }
  return Response.json({ url: process.env.LEGALWORK_SERVER_URL, results });
} });
console.log("opencode server listening on http://127.0.0.1:" + server.port);
`;

test.each(["first", "last", "only"])("an unavailable cloud project does not block startup (%s), stays registered and recovers on retry", async (position) => {
  const root = await mkdtemp(join(tmpdir(), "embedded-cloud-project-"));
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
  const cloud = join(root, "Cloud project"), local = join(root, "Local project");
  await mkdir(join(cloud, ".opencode"), { recursive: true }); await mkdir(local);
  const stamp = join(cloud, ".opencode", ".legalwork-core");
  await writeFile(stamp, "previous-bundle");
  const bin = join(root, "engine");
  await writeFile(bin, engine); await chmod(bin, 0o755);
  const read = fs.readFile;
  let unavailable = true;
  // Preserve readFile's encoding-dependent overloads while injecting this OS failure.
  const readCloudFile = async (path: Parameters<typeof read>[0], options: Parameters<typeof read>[1]) => {
    if (path === stamp && unavailable) throw Object.assign(new Error("Unknown system error -81, read"), {
      code: process.platform === "darwin" ? "Unknown system error -81" : "ENEEDAUTH", errno: -81,
    });
    return read(path, options);
  };
  const spy = spyOn(fs, "readFile").mockImplementation(readCloudFile as typeof read);
  cleanup.push(async () => { spy.mockRestore(); });
  const server = await startEmbeddedServer({
    host: "127.0.0.1", port: 0, workspaces: position === "only" ? [cloud] : position === "first" ? [cloud, local] : [local, cloud],
    configPath: join(root, "server.json"), logRequests: false,
    token: "test-client", hostToken: "test-host", manageOpencode: true, opencodeBin: bin,
  });
  cleanup.push(() => server.stop());
  const headers = { Authorization: "Bearer test-client" };
  expect((await fetch(`${server.url}/health`)).status).toBe(200);
  expect(server.managedOpencodeStatus()?.running).toBe(true);
  const list = await (await fetch(`${server.url}/workspaces`, { headers })).json();
  expect(list.items.map((item: { path: string }) => item.path).sort()).toEqual(position === "only" ? [cloud] : [cloud, local].sort());
  const cloudId = server.config.workspaces.find(workspace => workspace.path === cloud)!.id;
  if (position !== "only") {
    const localId = server.config.workspaces.find(workspace => workspace.path === local)!.id;
    expect((await fetch(`${server.url}/workspace/${localId}/project`, { headers })).status).toBe(200);
  }
  const failed = await fetch(`${server.url}/workspace/${cloudId}/project`, { headers });
  expect(failed.status).toBe(503);
  const failure = await failed.json();
  expect(failure.code).toBe("cloud_auth_required");
  expect(failure.message).toContain("sign in");
  expect(failure.message).toContain(`Folder: ${cloud}\n`);
  unavailable = false;
  expect((await fetch(`${server.url}/workspace/${cloudId}/project`, { headers })).status).toBe(200);
}, 30_000);

test("managed agent authenticates wiki and storage tools after the preferred server port is occupied", async () => {
  const root = await mkdtemp(join(tmpdir(), "embedded-agent-port-"));
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
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const bin = join(root, "engine");
  await writeFile(bin, engine); await chmod(bin, 0o755);
  const oldServer = await serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ code: "wrong_server" }, { status: 403 }) });
  cleanup.push(async () => oldServer.stop());
  const server = await startEmbeddedServer({
    host: "127.0.0.1", port: oldServer.port, workspaces: [workspace],
    configPath: join(root, "server.json"), readOnly: true, logRequests: false,
    token: "test-client", hostToken: "test-host", manageOpencode: true, opencodeBin: bin,
  });
  cleanup.push(() => server.stop());
  expect(server.port).not.toBe(oldServer.port);
  expect(server.config.port).toBe(server.port);
  const entry = server.config.workspaces[0];
  await grantWikiAgentSession(server.config, { sessionId: "verified-session", directory: workspace, scope: "owner" });
  const query = new URLSearchParams({ workspace: entry.id, directory: workspace });
  const probe = await fetch(`${server.config.opencodeBaseUrl}/probe?${query}`);
  const result = await probe.json();
  expect(result.url).toBe(server.url);
  expect(result.results.map((item: { status: number }) => item.status)).toEqual([200, 200]);
  expect(server.managedOpencodeExecution?.env.find(item => item.name === "LEGALWORK_WIKI_AGENT_TICKET")?.redacted).toBe(true);
}, 30_000);

test("startup stays unavailable until initialization succeeds and releases its listener on failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "server-init-failure-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, configPath: join(root, "server.json"),
    token: "test-client", hostToken: "test-host", workspaces: [], authorizedRoots: [],
    readOnly: true, approval: { mode: "manual", timeoutMs: 1000 }, corsOrigins: [],
    startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  let boundPort = 0;
  await expect(startServer(config, { onListening: async port => {
    boundPort = port;
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(503);
    throw new Error("engine startup failed");
  } })).rejects.toThrow("engine startup failed");
  expect(boundPort).toBeGreaterThan(0);
  await expect(fetch(`http://127.0.0.1:${boundPort}/health`)).rejects.toThrow();
});

test("an explicit missing desktop SDK prevents engine spawn and package downloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "embedded-missing-sdk-"));
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
  const workspace = join(root, "workspace"); await mkdir(workspace);
  const spawn = spyOn(managedOpencode, "createManagedOpencodeServer").mockRejectedValue(new Error("Engine must not be spawned"));
  try {
    await expect(startEmbeddedServer({
      host: "127.0.0.1", port: 0, workspaces: [workspace], configPath: join(root, "server.json"),
      readOnly: true, logRequests: false, token: "test-client", hostToken: "test-host", manageOpencode: true,
      opencodeSdkDirectory: join(root, "missing-desktop-resources"),
    })).rejects.toThrow("Bundled OpenCode plugin SDK is missing");
    expect(spawn).not.toHaveBeenCalled();
  } finally { spawn.mockRestore(); }
});
