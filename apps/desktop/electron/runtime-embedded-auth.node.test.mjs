import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRuntimeManager } from "./runtime.mjs";

// Keep disposal and listener close at one fixture boundary.
async function withFixtureCleanup(run, { dispose, close, remove }) {
  let primary, failed = false;
  try { await run(); } catch (error) { primary = error; failed = true; }
  const cleanup = [];
  for (const release of [dispose, close]) {
    try { await release(); } catch (error) { cleanup.push(error); }
  }
  // A rejected disposer is not proof of released resources. Keep their root
  // for diagnosis; removal is independent only after both releases succeeded.
  if (!cleanup.length) {
    try { await remove(); } catch (error) { cleanup.push(error); }
  }
  if (!failed && cleanup.length) { primary = cleanup.shift(); failed = true; }
  if (failed) {
    if (cleanup.length) {
      const previous = Object.getOwnPropertyDescriptor(primary, "cleanup")?.value;
      Object.defineProperty(primary, "cleanup", {
        value: new AggregateError([...(previous instanceof AggregateError ? previous.errors : previous ? [previous] : []), ...cleanup], "Fixture cleanup failed"), configurable: true,
      });
    }
    throw primary;
  }
}

// Postbuild Node gate: real desktop manager and embedded server, with only an
// inert, authenticated loopback engine. No Electron, provider or original engine.
async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "desktop-private-auth-"));
  const selected = path.join(root, "matter");
  const configPath = path.join(root, "server.json");
  const overrides = {
    HOME: root, USERPROFILE: root, APPDATA: path.join(root, "appdata"),
    XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"),
    XDG_CACHE_HOME: path.join(root, "cache"), XDG_STATE_HOME: path.join(root, "state"),
    LEGALWORK_SERVER_CONFIG: configPath, LEGALWORK_DATA_DIR: path.join(root, "server-data"),
    LEGALWORK_RUNTIME_DB: path.join(root, "runtime.sqlite"), LEGALWORK_TOKEN_STORE: path.join(root, "tokens.json"),
    LEGALWORK_ENV_STORE: path.join(root, "env.json"), LEGALWORK_DEV_MODE: undefined,
    LEGALWORK_OPENCODE_BASE_URL: undefined, LEGALWORK_OPENCODE_USERNAME: undefined,
    LEGALWORK_OPENCODE_PASSWORD: undefined, LEGALWORK_OPENCODE_DIRECTORY: undefined,
    LEGALWORK_WORKSPACES: undefined, LEGALWORK_PROJECTS_DIR: undefined,
    LEGALWORK_BENCHMARKS_DB: undefined, LEGALWORK_BENCHMARKS_DIR: undefined,
    OPENCODE_CONFIG: undefined, OPENCODE_CONFIG_DIR: path.join(root, "opencode"),
    OPENCODE_DB: undefined, NODE_OPTIONS: undefined,
    LEGALWORK_LOG_REQUESTS: "false", LEGALWORK_LOG_FORMAT: "pretty",
  };
  const previous = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") throw new Error("Non-loopback fixture request refused");
    return originalFetch(input, options);
  };
  const originalWrite = process.stdout.write;
  let watcherLogs = 0;
  process.stdout.write = function (...args) {
    if (args.length === 1 && args[0] === "Reload watcher enabled (1)\n") { watcherLogs++; return true; }
    return Reflect.apply(originalWrite, this, args);
  };
  let manager, externalServer, removed = false;
  try {
    await withFixtureCleanup(async () => {
      await mkdir(selected); await mkdir(path.join(root, "user-data"));
      manager = createRuntimeManager({
        app: { isPackaged: false, getPath: key => key === "exe" ? process.execPath : key === "userData" ? path.join(root, "user-data") : root },
        desktopRoot: path.join(root, "desktop"), listLocalWorkspacePaths: async () => [selected],
        listLocalWorkspaceAppFiles: async () => [{ path: selected, appFiles: "outside" }],
        listLocalWorkspaces: async () => [], reconnectHostWorkspace: async () => null,
        recorder: undefined, onSidecarExit: () => {}, getApprovalWindow: () => null,
      });
      await run({ root, selected, configPath, manager, ownHttpServer: server => { externalServer = server; } });
      assert.equal(watcherLogs, 2, "Expected one watcher startup per real server generation");
    }, {
      dispose: async () => { await manager?.dispose(); },
      close: async () => { if (externalServer) await new Promise((resolve, reject) => externalServer.close(error => error ? reject(error) : resolve(undefined))); },
      remove: async () => { await rm(root, { recursive: true }); removed = true; },
    });
  } catch (error) {
    if (!removed) Object.defineProperty(error, "fixtureRoot", { value: root, configurable: true });
    throw error;
  } finally {
    process.stdout.write = originalWrite;
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!Object.hasOwn(previous, key)) delete process.env[key];
    Object.assign(process.env, previous);
  }
}

async function authenticatedEngine(engine) {
  // Keep credentials out of assertion diagnostics: test the actual HTTP result.
  const response = await fetch(`${engine.baseUrl}/global/health`, {
    headers: { Authorization: `Basic ${Buffer.from(`${engine.opencodeUsername}:${engine.opencodePassword}`).toString("base64")}` },
  });
  assert.equal(response.status, 200, "Desktop must receive working private engine authentication");
  assert.equal((await response.json()).healthy, true);
}

async function publicProjection(manager, engine) {
  const server = await manager.legalworkServerInfo();
  assert.equal(typeof server.ownerToken === "string" && !!server.ownerToken, true);
  for (const token of [server.ownerToken, server.clientToken]) {
    const response = await fetch(`${server.baseUrl}/workspaces`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.items.length, 1);
    const workspace = payload.items[0];
    for (const object of [workspace, workspace.opencode]) {
      for (const key of ["username", "password", "opencodeUsername", "opencodePassword"]) assert.equal(Object.hasOwn(object, key), false);
    }
    const serialized = JSON.stringify(payload);
    for (const secret of [engine.opencodeUsername, engine.opencodePassword]) {
      if (secret) assert.equal(serialized.includes(secret), false, "Public workspace projection must omit engine credentials");
    }
  }
}

test("fresh managed desktop authentication survives healthy reuse and embedded-server restart privately", { timeout: 20_000 }, async () => {
  await fixture(async ({ root, selected, manager }) => {
    const preload = path.join(root, "inert-engine.mjs");
    await writeFile(preload, `
import { createServer } from "node:http";
import { basename } from "node:path";
if (process.argv.includes("--help")) process.exit(0);
if (basename(process.argv[1] ?? "") !== "serve") throw new Error("Unexpected fixture entry");
const expected = "Basic " + Buffer.from(process.env.OPENCODE_SERVER_USERNAME + ":" + process.env.OPENCODE_SERVER_PASSWORD).toString("base64");
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
createServer((request, response) => {
  request.resume();
  if (request.headers.authorization !== expected) return response.writeHead(401).end();
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(request.url === "/global/health" ? { healthy: true, version: "inert-private-auth-fixture" } : {}));
}).listen(port, "127.0.0.1", () => process.stdout.write("opencode server listening on http://127.0.0.1:" + port + "\\n"));
await new Promise(() => {});
`);
    // A genuine Node executable with an awaited fixture import is portable and
    // never executes the original engine or a shell wrapper.
    process.env.NODE_OPTIONS = `--import=${pathToFileURL(preload).href}`;
    const before = await manager.engineInfo();
    assert.equal(before.opencodeUsername == null && before.opencodePassword == null, true);
    const first = await manager.engineStart(selected, { appFiles: "outside", opencodeBinPath: process.execPath });
    await authenticatedEngine(first);
    await publicProjection(manager, first);
    const server = await manager.legalworkServerInfo();
    const reused = await manager.engineStart(selected, { appFiles: "outside", opencodeBinPath: process.execPath });
    assert.equal(reused.baseUrl, first.baseUrl);
    assert.equal(reused.pid, first.pid);
    assert.equal((await manager.legalworkServerInfo()).baseUrl, server.baseUrl);
    await authenticatedEngine(reused);
    await manager.legalworkServerRestart({});
    const restarted = await manager.engineInfo();
    await authenticatedEngine(restarted);
    await publicProjection(manager, restarted);
    // Old credentials cannot authenticate the replacement engine.
    const stale = await fetch(`${restarted.baseUrl}/global/health`, { headers: { Authorization: `Basic ${Buffer.from(`${first.opencodeUsername}:${first.opencodePassword}`).toString("base64")}` } });
    assert.equal(stale.status, 401); await stale.arrayBuffer();
  });
});

test("fresh externally configured engine authentication survives embedded-server restart privately", { timeout: 20_000 }, async () => {
  await fixture(async ({ selected, configPath, manager, ownHttpServer }) => {
    const username = "synthetic-external-user", password = "synthetic-external-password";
    const expected = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    const http = createServer((request, response) => {
      request.resume();
      if (request.headers.authorization !== expected) return response.writeHead(401).end();
      response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ healthy: true }));
    });
    ownHttpServer(http);
    await new Promise(resolve => http.listen(0, "127.0.0.1", () => resolve(undefined)));
    const address = http.address(); assert.ok(address && typeof address !== "string");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await writeFile(configPath, JSON.stringify({ workspaces: [{ path: selected, appFiles: "outside" }], opencodeBaseUrl: baseUrl, opencodeUsername: username, opencodePassword: password, wordAddin: { enabled: false } }));
    const first = await manager.engineStart(selected, { appFiles: "outside", opencodeBinPath: process.execPath });
    await authenticatedEngine(first); await publicProjection(manager, first);
    const reused = await manager.engineStart(selected, { appFiles: "outside", opencodeBinPath: process.execPath });
    assert.equal(reused.baseUrl, first.baseUrl); await authenticatedEngine(reused);
    await manager.legalworkServerRestart({});
    const restarted = await manager.engineInfo();
    assert.equal(restarted.baseUrl, baseUrl);
    await authenticatedEngine(restarted); await publicProjection(manager, restarted);
  });
});


test("fixture preserves primary failure and ordered disposer failures without deleting unreleased resources", async () => {
  const primary = new Error("synthetic assertion"), disposal = new Error("synthetic disposal"), listener = new Error("synthetic listener close");
  const root = await mkdtemp(path.join(os.tmpdir(), "fixture-compound-cleanup-"));
  const marker = path.join(root, "keep.txt"), http = createServer();
  const attempted = [];
  let observed;
  try {
    await writeFile(marker, "Retain until release is proven");
    await new Promise(resolve => http.listen(0, "127.0.0.1", () => resolve(undefined)));
    try {
      await withFixtureCleanup(async () => { throw primary; }, {
        dispose: async () => { attempted.push("dispose"); throw disposal; },
        close: async () => {
          attempted.push("close");
          await new Promise((resolve, reject) => http.close(error => error ? reject(error) : resolve(undefined)));
          throw listener;
        },
        remove: async () => { attempted.push("remove"); await rm(root, { recursive: true }); },
      });
    } catch (error) { observed = error; }
    assert.equal(observed === primary, true, "Original assertion remains primary");
    assert.deepEqual(attempted, ["dispose", "close"], "Independent close is attempted and unsafe directory deletion is refused");
    assert.equal(http.listening, false, "Disposal failure must not leave the independent listener open");
    assert.equal(await readFile(marker, "utf8"), "Retain until release is proven");
    const cleanup = Object.getOwnPropertyDescriptor(primary, "cleanup")?.value;
    assert.equal(cleanup instanceof AggregateError, true);
    assert.equal(cleanup.errors.length, 2);
    assert.equal(cleanup.errors[0] === disposal && cleanup.errors[1] === listener, true);
    assert.equal(Object.keys(primary).includes("cleanup"), false);
  } finally {
    // The injected disposer owned no real child; the actual listener is closed
    // above. This control can now remove its retained synthetic remainder.
    try {
      if (http.listening) await new Promise((resolve, reject) => http.close(error => error ? reject(error) : resolve(undefined)));
    } finally { await rm(root, { recursive: true }); }
  }
});

test("fixture attempts ordinary removal after successful release while preserving primary failure", async () => {
  const primary = new Error("synthetic setup"), removal = new Error("synthetic directory removal");
  const attempted = [];
  let observed;
  try {
    await withFixtureCleanup(async () => { throw primary; }, {
      dispose: async () => { attempted.push("dispose"); },
      close: async () => { attempted.push("close"); },
      remove: async () => { attempted.push("remove"); throw removal; },
    });
  } catch (error) { observed = error; }
  assert.equal(observed === primary, true, "Original setup error remains primary");
  assert.deepEqual(attempted, ["dispose", "close", "remove"]);
  const cleanup = Object.getOwnPropertyDescriptor(primary, "cleanup")?.value;
  assert.equal(cleanup instanceof AggregateError && cleanup.errors[0] === removal, true);
});


test("fixture restores environment, fetch and logger after setup failure", async () => {
  const previous = { ...process.env }, fetch = globalThis.fetch, write = process.stdout.write;
  const primary = new Error("synthetic setup failure");
  let observed, ownedRoot;
  try { await fixture(async ({ root }) => { ownedRoot = root; throw primary; }); } catch (error) { observed = error; }
  assert.equal(observed === primary, true);
  assert.equal(await stat(ownedRoot).then(() => false, error => error.code === "ENOENT"), true);
  assert.equal(globalThis.fetch === fetch && process.stdout.write === write, true);
  assert.equal(Object.keys(process.env).length === Object.keys(previous).length && Object.entries(previous).every(([key, value]) => process.env[key] === value), true, "Environment restoration must not disclose its contents");
});
