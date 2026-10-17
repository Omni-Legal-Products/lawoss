import assert from "node:assert/strict";
import { test } from "node:test";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, mkdir, realpath, rm, rename, access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";

// Keep even incidental default config discovery in this process off the real profile.
const root = await realpath(await mkdtemp(join(os.tmpdir(), "runtime-node-lifecycle-")));
const home = os.homedir;
os.homedir = () => root;
syncBuiltinESMExports();
const originalOverride = process.env.LEGALWORK_RUNTIME_DB;
const originalAccount = process.env.LAWOSS_EIGENWELT_ACCOUNT;
process.env.LAWOSS_EIGENWELT_ACCOUNT = "1";
delete process.env.LEGALWORK_RUNTIME_DB;
const { startServer } = await import("../dist/server.js");
const { runtimeDbHandles } = await import("../dist/test-support/runtime-db-handles.js");
const { acquireRuntimeDbLifetime, runtimeDbResource, withRuntimeDb } = await import("../dist/runtime-db-lifecycle.js");
const { readRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } = await import("../dist/runtime-opencode-config-store.js");
const { readLegalworkWorkspaceConfig, writeLegalworkWorkspaceConfig } = await import("../dist/legalwork-workspace-config-store.js");
const { readSessionGroupState, writeSessionGroupState } = await import("../dist/session-groups.js");
const { readEigenweltConnection, writeEigenweltConnection } = await import("../dist/eigenwelt-connection-store.js");
const { readHubInstalls, recordHubInstall } = await import("../dist/eigenwelt-hub-installs-store.js");
const { readInstalledCloudPlugins } = await import("../dist/cloud-plugins.js");
const { CalendarStore, calendarStore } = await import("../dist/calendar/store.js");
const { TaskStore, taskStore } = await import("../dist/task-store.js");
const { ProjectSyncStore, projectSyncStore } = await import("../dist/project-sync-store.js");
const { startProjectSyncTimer, runProjectSync, scheduleProjectSync } = await import("../dist/project-sync.js");

const { openSqlite } = await import("../dist/runtime-db.js");
const { startTaskSyncTimer, scheduleTaskSync } = await import("../dist/task-sync.js");

test("Node native SQLite releases every adapter after overlapping servers, reconnect, retained direct owner and reopen", async () => {
  const path = join(root, "matter"); await mkdir(path);
  const config = { host: "127.0.0.1", port: 0, token: "client", hostToken: "host", configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces: [{ id: "stable", name: "Matter", path, preset: "starter", workspaceType: "local", appFiles: "outside" }], authorizedRoots: [path], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const db = join(root, "runtime.sqlite");
  const servers = [];
  const start = async () => { const server = await startServer({ ...config }); servers.push(server); return server; };
  let direct;
  try {
    await writeRuntimeOpencodeConfig(config, "stable", () => ({ default_agent: "sentinel" }));
    assert.equal(await runtimeDbHandles(db), 0);
    const first = await start(), second = await start();
    await writeLegalworkWorkspaceConfig(config, "stable", () => ({ sentinel: 42 }));
    await writeSessionGroupState(config, "stable", { groups: [{ id: "kept", label: "Kept" }], assignments: { chat: "kept" } });
    await readEigenweltConnection(config);
    await recordHubInstall(config, "stable", "fixture", { kind: "workflow", name: "Sentinel", version: 7, installedAt: 1 });
    await readInstalledCloudPlugins(config, "stable");
    const calendarRequest = async (server, suffix = "", method = "GET") => {
      const response = await fetch(`http://127.0.0.1:${server.port}/workspace/stable/calendar${suffix}`, {
        method, headers: { Authorization: "Bearer client", "Content-Type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({ title: "Lifecycle sentinel", start: "2026-10-16" }) } : {}),
      });
      const body = await response.json(); assert.equal(response.status, 200); return body;
    };
    const calendarItem = (await calendarRequest(first, "", "POST")).item;
    assert.equal((await calendarRequest(second, `/${calendarItem.id}`)).item.title, "Lifecycle sentinel");
    const tasks = await taskStore(config), projects = await projectSyncStore(config);
    tasks.setSyncState({ orgId: "fixture", pullCursor: "cursor", lastPullAt: 1, lastPushAt: 2, lastError: null });
    await first.stop(); await first.stop();
    assert.equal((await calendarRequest(second, `/${calendarItem.id}`)).item.id, calendarItem.id);
    const base = `http://127.0.0.1:${second.port}`;
    const project = await fetch(`${base}/workspace/stable/project`, { headers: { Authorization: "Bearer client" } }); assert.equal(project.status, 200); await project.arrayBuffer();
    assert.equal(tasks.getSyncState("fixture").pullCursor, "cursor"); assert.deepEqual(projects.links(), []);
    const moved = join(root, "moved"); await rename(path, moved);
    const reconnect = await fetch(`${base}/workspace/stable/reconnect`, { method: "POST", headers: { "X-LegalWork-Host-Token": "host", "Content-Type": "application/json" }, body: JSON.stringify({ folderPath: moved, expectedPath: path }) });
    assert.equal(reconnect.status, 200); await reconnect.arrayBuffer(); await second.stop();
    assert.equal(await runtimeDbHandles(db), 0);
    const restarted = JSON.parse(await readFile(config.configPath, "utf8"));
    config.workspaces = restarted.workspaces; config.authorizedRoots = restarted.authorizedRoots;
    const third = await start();
    assert.equal((await calendarRequest(third, `/${calendarItem.id}`)).item.id, calendarItem.id);
    direct = acquireRuntimeDbLifetime(config);
    const retained = await taskStore(config); await third.stop();
    assert.equal(retained.getSyncState("fixture").pullCursor, "cursor");
    assert.equal((await readRuntimeOpencodeConfig(config, "stable")).default_agent, "sentinel");
    assert.deepEqual(await readLegalworkWorkspaceConfig(config, "stable"), { sentinel: 42 });
    assert.deepEqual((await readSessionGroupState(config, "stable")).state.assignments, { chat: "kept" });
    assert.equal((await readHubInstalls(config, "stable")).fixture.version, 7);
    await direct.release(); assert.equal(await runtimeDbHandles(db), 0);
    const a = await TaskStore.open(db, join(root, "attachments")), b = await TaskStore.open(db, join(root, "attachments"));
    const c = await ProjectSyncStore.open(db), d = await ProjectSyncStore.open(db);
    a.close(); a.close(); c.close(); assert.equal(b.getSyncState("fixture").pullCursor, "cursor"); assert.deepEqual(d.links(), []); b.close(); d.close();
    const calendarA = await CalendarStore.open(db), calendarB = await CalendarStore.open(db);
    try {
      calendarA.close(); calendarA.close();
      assert.equal(calendarB.get("stable", calendarItem.id).id, calendarItem.id);
    } finally { calendarA.close(); calendarB.close(); }
    assert.equal(await runtimeDbHandles(db), 0);
    await verifyWatcherOwnerHandoff({ ...config, workspaces: [{ ...config.workspaces[0], path: moved }] });
    await verifyPendingOwnerHandoff(config);
    await verifyFailureRecovery();
    await verifyIndependentFailureRecovery();
    await verifyAtomicSchema();
    assert.equal(await runtimeDbHandles(db), 0);
    await rm(root, { recursive: true }); await mkdir(root);
    assert.deepEqual(await readRuntimeOpencodeConfig(config, "stable"), {});
    await mkdir(config.workspaces[0].path, { recursive: true });
    const fresh = await start();
    assert.deepEqual((await calendarRequest(fresh)).items, []);
    const replacement = (await calendarRequest(fresh, "", "POST")).item;
    assert.notEqual(replacement.id, calendarItem.id);
    assert.equal((await calendarRequest(fresh, `/${replacement.id}`)).item.title, "Lifecycle sentinel");
    await fresh.stop();
    assert.equal(await runtimeDbHandles(db), 0);
  } finally {
    for (const server of servers.reverse()) await server.stop();
    await direct?.release();
    os.homedir = home; syncBuiltinESMExports();
    if (originalOverride === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = originalOverride;
    if (originalAccount === undefined) delete process.env.LAWOSS_EIGENWELT_ACCOUNT; else process.env.LAWOSS_EIGENWELT_ACCOUNT = originalAccount;
    await rm(root, { recursive: true, force: true });
  }
  assert.equal(await access(root).then(() => true, () => false), false);
});


async function verifyWatcherOwnerHandoff(firstConfig) {
  const secondConfig = { ...firstConfig };
  const first = acquireRuntimeDbLifetime(firstConfig), second = acquireRuntimeDbLifetime(secondConfig);
  let calls = 0;
  const http = createServer((request, response) => {
    calls++; request.resume(); response.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ code: "unavailable" }));
  });
  const previousPlatform = process.env.EIGENWELT_PLATFORM_URL;
  const previousFirmServices = process.env.LAWOSS_EIGENWELT_FIRM_SERVICES;
  process.env.LAWOSS_EIGENWELT_FIRM_SERVICES = "1";
  let stopFirst, stopSecond;
  try {
    await new Promise(resolve => http.listen(0, "127.0.0.1", resolve));
    const address = http.address(); assert.ok(address && typeof address !== "string");
    process.env.EIGENWELT_PLATFORM_URL = `http://127.0.0.1:${address.port}`;
    // Watcher is born in the first owner's Node AsyncLocalStorage context.
    await first.run(async () => {
      stopFirst = startProjectSyncTimer(firstConfig, 60_000, 60_000);
      await writeEigenweltConnection(firstConfig, { platformToken: "fixture", platformURL: process.env.EIGENWELT_PLATFORM_URL, account: { userId: "fixture", userName: "Fixture", userEmail: "fixture@example.test", orgId: "fixture", orgName: "Fixture" } });
      const store = await projectSyncStore(firstConfig);
      store.saveLink({ workspaceId: "stable", projectId: "fixture", orgId: "fixture", origin: "local", role: "owner", ownerUserId: "fixture", settings: { access: "org", memberIds: [], scope: { documents: false, notes: false, tasks: false, recordings: false, metadata: false, reviews: false } }, confirmed: false, remoteUpdatedAt: null, filesReconciledAt: null, state: "active", allowDeletions: false, lastSyncAt: null, lastError: null, report: null });
      const round = await runProjectSync(firstConfig, { platform: { listProjects: async () => ({ projects: [], nextCursor: null, hidden: [] }) } });
      assert.equal(round.ran, true); assert.equal(round.error, null);
    });
    await second.run(async () => { stopSecond = startProjectSyncTimer(secondConfig, 60_000, 60_000); });
    await stopFirst(); await first.release();
    await writeFile(join(firstConfig.workspaces[0].path, "node-surviving-owner.txt"), "dispatch from the surviving owner");
    const deadline = Date.now() + 5_000;
    while (!calls && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(calls > 0, "Node watcher must reach the platform after its creating owner's scope is released");
  } finally {
    await stopFirst?.(); await stopSecond?.(); await first.release(); await second.release();
    if (previousPlatform === undefined) delete process.env.EIGENWELT_PLATFORM_URL; else process.env.EIGENWELT_PLATFORM_URL = previousPlatform;
    if (previousFirmServices === undefined) delete process.env.LAWOSS_EIGENWELT_FIRM_SERVICES; else process.env.LAWOSS_EIGENWELT_FIRM_SERVICES = previousFirmServices;
    await new Promise(resolve => http.close(() => resolve()));
  }
}


async function verifyPendingOwnerHandoff(config) {
  const previousPlatform = process.env.EIGENWELT_PLATFORM_URL, previousFirm = process.env.LAWOSS_EIGENWELT_FIRM_SERVICES;
  let calls = 0;
  const http = createServer((request, response) => { calls++; request.resume(); response.writeHead(500).end("unavailable"); });
  await new Promise(resolve => http.listen(0, "127.0.0.1", resolve));
  const address = http.address(); assert.ok(address && typeof address !== "string");
  process.env.EIGENWELT_PLATFORM_URL = `http://127.0.0.1:${address.port}`; process.env.LAWOSS_EIGENWELT_FIRM_SERVICES = "1";
  const results = {};
  try {
    for (const [name, start, schedule] of [["tasks", startTaskSyncTimer, scheduleTaskSync], ["projects", startProjectSyncTimer, scheduleProjectSync]]) {
      const firstConfig = { ...config }, secondConfig = { ...config };
      const first = acquireRuntimeDbLifetime(firstConfig), second = acquireRuntimeDbLifetime(secondConfig);
      let stopFirst, stopSecond, arrivalTimeout, onArrival, primaryFailed = false;
      try {
        await writeEigenweltConnection(config, { platformToken: "fixture", platformURL: process.env.EIGENWELT_PLATFORM_URL });
        await first.run(async () => { stopFirst = start(firstConfig, 60_000, 60_000); });
        await second.run(async () => { stopSecond = start(secondConfig, 60_000, 60_000); });
        const before = calls;
        // Observe only the real request, before scheduling, with a cancellable finite Node bound.
        const arrived = new Promise(resolve => {
          onArrival = () => resolve(true);
          http.once("request", onArrival);
          arrivalTimeout = setTimeout(() => resolve(false), 5_000);
        });
        await first.run(async () => { schedule(firstConfig, 25); });
        await stopFirst(); await first.release();
        results[name] = await arrived && calls > before;
        assert.ok(results[name], `pending ${name} round must reach HTTP within the bounded arrival wait`);
      } catch (error) { primaryFailed = true; throw error; }
      finally {
        clearTimeout(arrivalTimeout);
        if (onArrival) http.off("request", onArrival);
        let cleanupFailed = false, cleanupError;
        for (const release of [() => stopFirst?.(), () => stopSecond?.(), () => first.release(), () => second.release()]) {
          try { await release(); } catch (error) { if (!cleanupFailed) { cleanupFailed = true; cleanupError = error; } }
        }
        if (cleanupFailed && !primaryFailed) throw cleanupError;
      }
    }
    assert.deepEqual(results, { tasks: true, projects: true }, "pending 25ms rounds must transfer without manual schedule or 60s fallback");
  } finally {
    if (previousPlatform === undefined) delete process.env.EIGENWELT_PLATFORM_URL; else process.env.EIGENWELT_PLATFORM_URL = previousPlatform;
    if (previousFirm === undefined) delete process.env.LAWOSS_EIGENWELT_FIRM_SERVICES; else process.env.LAWOSS_EIGENWELT_FIRM_SERVICES = previousFirm;
    await new Promise(resolve => http.close(() => resolve()));
  }
}


async function verifyFailureRecovery() {
  const directory = join(root, "failed-close"); await mkdir(directory);
  const config = { configPath: join(directory, "server.json") }, path = join(directory, "runtime.sqlite");
  const owner = acquireRuntimeDbLifetime(config), db = await openSqlite(path);
  let attempts = 0, siblingCloses = 0, successor, failure;
  try {
    await runtimeDbResource(config, Symbol(), async () => ({ close: () => { if (++attempts === 1) throw new Error("before native close"); db.close(); } }));
    await runtimeDbResource(config, Symbol(), async path => { const sibling = await openSqlite(path); return { close: () => { siblingCloses++; sibling.close(); } }; });
    failure = await owner.release().catch(error => error);
    assert.ok(failure instanceof AggregateError); assert.equal(attempts, 1); assert.equal(siblingCloses, 1);
    if (process.platform !== "win32") assert.ok(await runtimeDbHandles(path) > 0);
    successor = acquireRuntimeDbLifetime(config);
    let state = "waiting";
    const reading = successor.run(() => readRuntimeOpencodeConfig(config, "fixture")).then(() => { state = "read"; }, () => { state = "rejected"; });
    await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(state, "waiting");
    config.configPath = join(root, "unrelated", "server.json");
    await failure.retryCleanup(); await owner.retryCleanup(); await reading;
    assert.equal(state, "read"); assert.equal(attempts, 2); assert.equal(siblingCloses, 1);
    await assert.rejects(owner.release(), /Failed to close runtime database resources/);
  } finally { await failure?.retryCleanup?.(); db.close(); await successor?.release(); }
  assert.equal(await runtimeDbHandles(path), 0); await rm(directory, { recursive: true });

  const cases = [
    ["runtime", config => readRuntimeOpencodeConfig(config, "fixture")],
    ["workspace", config => readLegalworkWorkspaceConfig(config, "fixture")],
    ["session", config => readSessionGroupState(config, "fixture")],
    ["account", config => readEigenweltConnection(config)],
    ["hub", config => readHubInstalls(config, "fixture")],
    ["cloud", config => readInstalledCloudPlugins(config, "fixture")],
    ["tasks", config => withRuntimeDb(config, async () => (await taskStore(config)).getSyncState("fixture"))],
    ["projects", config => withRuntimeDb(config, async () => (await projectSyncStore(config)).links())],
    ["direct-tasks", async (_config, path, root) => (await TaskStore.open(path, join(root, "attachments"))).close()],
    ["direct-projects", async (_config, path) => (await ProjectSyncStore.open(path)).close()],
  ];
  const { DatabaseSync } = await import("node:sqlite");
  for (const [name, open] of cases) {
    const directory = join(root, `failed-init-${name}`); await mkdir(directory);
    const path = join(directory, "runtime.sqlite"), config = { configPath: join(directory, "server.json") };
    await writeFile(path, "not a sqlite database");
    const close = DatabaseSync.prototype.close; let partial, recovered = false, failure;
    DatabaseSync.prototype.close = function(...args) { if (!partial) { partial = this; throw new Error("injected cleanup before native close"); } return close.apply(this, args); };
    try {
      failure = await open(config, path, directory).catch(error => error);
      assert.ok(failure instanceof AggregateError, name);
      const messages = error => error instanceof AggregateError ? error.errors.map(messages).join("\n") : String(error);
      assert.match(messages(failure), /not a database/); assert.match(messages(failure), /injected cleanup before native close/);
      if (process.platform !== "win32") assert.ok(await runtimeDbHandles(path) > 0);
      await failure.retryCleanup(); await failure.retryCleanup(); recovered = true;
      assert.equal(await runtimeDbHandles(path), 0);
      await rm(path); await open(config, path, directory); assert.equal(await runtimeDbHandles(path), 0);
      await rm(directory, { recursive: true });
    } finally {
      await failure?.retryCleanup?.(); DatabaseSync.prototype.close = close;
      if (partial && !recovered) { try { close.call(partial); } catch {} }
    }
  }
}


async function verifyIndependentFailureRecovery() {
  const directory = join(root, "independent-failed-init"); await mkdir(directory);
  const path = join(directory, "runtime.sqlite");
  const healthy = await TaskStore.open(path, join(directory, "attachments"));
  healthy.setSyncState({ orgId: "fixture", pullCursor: "kept", lastPullAt: 1, lastPushAt: null, lastError: null });
  const { DatabaseSync } = await import("node:sqlite");
  const exec = DatabaseSync.prototype.exec, close = DatabaseSync.prototype.close;
  let partial, failedClose = false, failure;
  DatabaseSync.prototype.exec = function(...args) { if (!partial) { partial = this; return exec.call(this, "SELECT * FROM missing_initialization_table"); } return exec.apply(this, args); };
  DatabaseSync.prototype.close = function(...args) { if (this === partial && !failedClose) { failedClose = true; throw new Error("independent cleanup before native close"); } return close.apply(this, args); };
  try {
    failure = await ProjectSyncStore.open(path).catch(error => error);
    assert.ok(failure instanceof AggregateError);
    await failure.retryCleanup(); await failure.retryCleanup();
    assert.equal(healthy.getSyncState("fixture").pullCursor, "kept");
  } finally { await failure?.retryCleanup?.(); DatabaseSync.prototype.exec = exec; DatabaseSync.prototype.close = close; healthy.close(); }
  assert.equal(await runtimeDbHandles(path), 0); await rm(directory, { recursive: true });
}


async function verifyAtomicSchema() {
  const { DatabaseSync } = await import("node:sqlite");
  for (const [name, open] of [
    ["tasks", (path, directory) => TaskStore.open(path, join(directory, "attachments"))],
    ["projects", path => ProjectSyncStore.open(path)],
  ]) {
    const directory = await mkdtemp(join(root, `atomic-${name}-`));
    const path = join(directory, "runtime.sqlite");
    const exec = DatabaseSync.prototype.exec;
    let creates = 0;
    DatabaseSync.prototype.exec = function(sql) {
      if (sql.startsWith("CREATE TABLE") && ++creates === 2) return exec.call(this, "SELECT * FROM missing_initialization_table");
      return exec.call(this, sql);
    };
    try { await assert.rejects(open(path, directory), /missing_initialization_table/); }
    finally { DatabaseSync.prototype.exec = exec; }
    const check = await openSqlite(path);
    try { assert.equal(check.get("SELECT count(*) AS n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").n, 0, name); }
    finally { check.close(); }
    const reopened = await open(path, directory);
    reopened.close();
    assert.equal(await runtimeDbHandles(path), 0, name);
    await rm(directory, { recursive: true });
  }
}
