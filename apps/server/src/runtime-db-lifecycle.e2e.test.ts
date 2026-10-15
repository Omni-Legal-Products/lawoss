import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rename, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { writeRuntimeOpencodeConfig, readRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import { writeLegalworkWorkspaceConfig, readLegalworkWorkspaceConfig } from "./legalwork-workspace-config-store.js";
import { writeSessionGroupState, readSessionGroupState } from "./session-groups.js";
import { readEigenweltConnection } from "./eigenwelt-connection-store.js";
import { recordHubInstall, readHubInstalls } from "./eigenwelt-hub-installs-store.js";
import { readInstalledCloudPlugins } from "./cloud-plugins.js";
import { taskStore } from "./task-store.js";
import { projectSyncStore } from "./project-sync-store.js";
import { runtimeDbHandles } from "./test-support/runtime-db-handles.js";
import { createSyncFixtureTiming } from "./test-support/sync-fixture-timing.js";

// Test-only allowlist: never retain configs, paths, HTTP payloads or error objects.
const ownerStopStages = ["fixture.enter", "fixture.ready", "http.listening", "connection.write.enter", "connection.write.done", "owner.first.start.enter", "owner.first.start.done", "owner.second.start.enter", "owner.second.start.done", "schedule.call.enter", "schedule.call.returned", "owner.first.stop.enter", "owner.first.stop.done", "owner.first.release.enter", "owner.first.release.done", "assertion.window.enter", "assertion.check", "http.arrived", "http.no-http-observed", "primary.failed", "cleanup.enter", "owner.second.stop.enter", "owner.second.stop.done", "cleanup.drained", "cleanup.attempts.done", "cleanup.failed", "fixture.cleanup.enter", "fixture.cleanup.done"] as const;
function createOwnerStopTiming() {
  return { ...createSyncFixtureTiming("tasks-owner-stop", ownerStopStages), primaryFailed: false, completed: false };
}
let ownerStopTiming: ReturnType<typeof createOwnerStopTiming> | undefined;

let previousRuntimeDb: string | undefined;
beforeEach(() => { previousRuntimeDb = process.env.LEGALWORK_RUNTIME_DB; delete process.env.LEGALWORK_RUNTIME_DB; });
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  const timing = ownerStopTiming; ownerStopTiming = undefined;
  const incompleteAtCleanup = timing ? !timing.completed : false;
  let cleanupFailed = false, cleanupError: unknown;
  timing?.record("fixture.cleanup.enter");
  try {
    while (cleanups.length) {
      try { await cleanups.pop()?.(); }
      catch (error) {
        if (!timing) throw error;
        timing.record("cleanup.failed");
        if (!cleanupFailed) { cleanupFailed = true; cleanupError = error; }
      }
    }
  } finally {
    if (previousRuntimeDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousRuntimeDb;
    timing?.record("fixture.cleanup.done");
    if (timing && (incompleteAtCleanup || timing.primaryFailed || cleanupFailed)) timing.publish(incompleteAtCleanup ? "incomplete-at-cleanup" : timing.primaryFailed ? "primary-failed" : "cleanup-failed");
  }
  if (cleanupFailed && timing && !incompleteAtCleanup && !timing.primaryFailed) throw cleanupError;
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "runtime-lifecycle-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "matter"); await mkdir(path);
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "client", hostToken: "host", configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces: [{id: "stable", name: "Matter", path, preset: "starter", workspaceType: "local", appFiles: "outside"}], authorizedRoots: [path], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const start = async () => { const server = await startServer({ ...config }); cleanups.push(() => Promise.resolve(server.stop())); return server; };
  return { root, config, start, db: join(root, "runtime.sqlite") };
}
async function warm(config: ServerConfig) {
  await writeRuntimeOpencodeConfig(config, "stable", () => ({ default_agent: "sentinel" }));
  await writeLegalworkWorkspaceConfig(config, "stable", () => ({ sentinel: 42 }));
  await writeSessionGroupState(config, "stable", { groups: [{ id: "kept", label: "Kept" }], assignments: { chat: "kept" } });
  await readEigenweltConnection(config);
  await recordHubInstall(config, "stable", "fixture", { kind: "workflow", name: "Sentinel", version: 7, installedAt: 1 });
  await readInstalledCloudPlugins(config, "stable");
  const tasks = await taskStore(config);
  tasks.setSyncState({ orgId: "fixture", pullCursor: "cursor", lastPullAt: 1, lastPushAt: 2, lastError: null });
  const projects = await projectSyncStore(config);
  return { tasks, projects };
}
async function assertSentinels(config: ServerConfig) {
  expect((await readRuntimeOpencodeConfig(config, "stable")).default_agent).toBe("sentinel");
  expect(await readLegalworkWorkspaceConfig(config, "stable")).toEqual({ sentinel: 42 });
  expect((await readSessionGroupState(config, "stable")).state.assignments).toEqual({ chat: "kept" });
  expect((await readHubInstalls(config, "stable")).fixture?.version).toBe(7);
  expect((await taskStore(config)).getSyncState("fixture").pullCursor).toBe("cursor");
  expect((await projectSyncStore(config)).links()).toEqual([]);
}

test("two servers retain all adapters until final stop, reopen persisted state and release real DB handles", async () => {
  const f = await fixture(); const first = await f.start(); const second = await f.start();
  const retained = await warm(f.config); await first.stop(); await first.stop();
  retained.tasks.setSyncState({ orgId: "fixture", pullCursor: "cursor", lastPullAt: 1, lastPushAt: 3, lastError: null });
  expect(retained.tasks.getSyncState("fixture").lastPushAt).toBe(3);
  expect(retained.projects.links()).toEqual([]);
  const response = await fetch(`http://127.0.0.1:${second.port}/workspace/stable/project`, { headers: { Authorization: "Bearer client" } });
  expect(response.status).toBe(200); await response.arrayBuffer();
  await assertSentinels(f.config); await second.stop();
  expect(await runtimeDbHandles(f.db)).toBe(0);
  const third = await f.start(); await assertSentinels(f.config); await third.stop();
  expect(await runtimeDbHandles(f.db)).toBe(0);
  await rm(f.root, { recursive: true }); expect(await access(f.root).then(() => true, () => false)).toBe(false);
}, 20_000);

test("canonical reconnect completes and final stop releases the actual runtime database", async () => {
  const f = await fixture(); const server = await f.start();
  const old = f.config.workspaces[0]!.path, moved = join(f.root, "moved");
  const base = `http://127.0.0.1:${server.port}`;
  expect((await fetch(`${base}/workspace/stable/project`, { headers: { Authorization: "Bearer client" } })).status).toBe(200);
  await rename(old, moved);
  const result = await fetch(`${base}/workspace/stable/reconnect`, { method: "POST", headers: { "X-LegalWork-Host-Token": "host", "Content-Type": "application/json" }, body: JSON.stringify({ folderPath: moved, expectedPath: old }) });
  expect(result.status).toBe(200); await result.arrayBuffer(); await server.stop();
  expect(await runtimeDbHandles(f.db)).toBe(0);
  await rm(f.root, { recursive: true });
}, 20_000);

test("standalone async configuration calls release handles and reopening a replaced root has fresh state", async () => {
  const f = await fixture();
  await writeRuntimeOpencodeConfig(f.config, "stable", () => ({ default_agent: "before" }));
  expect(await runtimeDbHandles(f.db)).toBe(0);
  const server = await f.start(); await server.stop();
  expect((await readRuntimeOpencodeConfig(f.config, "stable")).default_agent).toBe("before");
  expect(await runtimeDbHandles(f.db)).toBe(0);
  await rm(f.root, { recursive: true }); await mkdir(f.root);
  expect(await readRuntimeOpencodeConfig(f.config, "stable")).toEqual({});
  expect(await runtimeDbHandles(f.db)).toBe(0);
}, 20_000);

test("stop waits for a reconnect handler paused before its persistent writes", async () => {
  const f = await fixture();
  let entered!: () => void, resume!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { resume = resolve; });
  f.config.reconnectHostWorkspace = async () => { entered(); await barrier; return async () => {}; };
  const server = await f.start();
  const old = f.config.workspaces[0]!.path, moved = join(f.root, "moved"); await rename(old, moved);
  const request = fetch(`http://127.0.0.1:${server.port}/workspace/stable/reconnect`, { method: "POST", headers: { "X-LegalWork-Host-Token": "host", "Content-Type": "application/json" }, body: JSON.stringify({ folderPath: moved, expectedPath: old }) }).catch(() => null);
  await enteredPromise;
  let stopped = false; const stopping = Promise.resolve(server.stop()).then(() => { stopped = true; });
  try {
    await Promise.race([stopping, new Promise(resolve => setTimeout(resolve, 1_000))]);
    expect(stopped).toBe(false);
  } finally { resume(); await request; await stopping; }
  const { readFile } = await import("node:fs/promises");
  expect(JSON.parse(await readFile(f.config.configPath!, "utf8")).workspaces[0].path).toBe(moved);
  expect(await runtimeDbHandles(f.db)).toBe(0);
}, 20_000);

test("freshness unsubscribe drains accepted writes and ignores another runtime's matching workspace", async () => {
  const f = await fixture(), other = await fixture(); const server = await f.start(); const otherServer = await other.start();
  const { keepLegalworkRuntimeConfigFileFresh, writeLegalworkRuntimeConfigFile, legalworkRuntimeConfigFilePath } = await import("./legalwork-runtime-config.js");
  const { readFile } = await import("node:fs/promises");
  await writeLegalworkRuntimeConfigFile(f.config, "stable");
  const stop = keepLegalworkRuntimeConfigFileFresh(f.config, "stable");
  cleanups.push(async () => { await stop(); });
  await writeRuntimeOpencodeConfig(other.config, "stable", () => ({ default_agent: "foreign" }));
  await writeRuntimeOpencodeConfig(f.config, "stable", () => ({ default_agent: "accepted" }));
  await stop();
  expect(JSON.parse(await readFile(legalworkRuntimeConfigFilePath(f.config), "utf8")).default_agent).toBe("accepted");
  expect(await access(legalworkRuntimeConfigFilePath(other.config)).then(() => true, () => false)).toBe(false);
  await server.stop(); await otherServer.stop();
}, 20_000);

test("failed listener startup releases its database owner and all started producers", async () => {
  const f = await fixture();
  await expect(startServer({ ...f.config, host: "192.0.2.1" })).rejects.toThrow();
  expect(await runtimeDbHandles(f.db)).toBe(0);
  await rm(f.root, { recursive: true });
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(await access(f.root).then(() => true, () => false)).toBe(false);
});

test("a standalone retained facade remains usable after a real server stops until its caller releases", async () => {
  const f = await fixture(); const { acquireRuntimeDbLifetime } = await import("./runtime-db-lifecycle.js");
  const owner = acquireRuntimeDbLifetime(f.config); cleanups.push(() => owner.release());
  const tasks = await taskStore(f.config), projects = await projectSyncStore(f.config);
  const server = await f.start(); await server.stop();
  tasks.setSyncState({ orgId: "fixture", pullCursor: "survived", lastPullAt: 1, lastPushAt: null, lastError: null });
  expect(projects.links()).toEqual([]);
  expect(tasks.getSyncState("fixture").pullCursor).toBe("survived");
  await owner.release(); expect(await runtimeDbHandles(f.db)).toBe(0);
});

test("embedded bootstrap and repeated stop release its initial and server database owners", async () => {
  const f = await fixture(); const { startEmbeddedServer } = await import("./embedded.js");
  const server = await startEmbeddedServer({ host: "127.0.0.1", port: 0, configPath: f.config.configPath, workspaces: [f.config.workspaces[0]!.path], token: "client", hostToken: "host", logRequests: false, wordAddin: false, manageOpencode: false, hostWorkspaceAppFiles: [{ path: f.root, appFiles: "outside" }] });
  cleanups.push(() => server.stop());
  await writeRuntimeOpencodeConfig(server.config, server.config.workspaces[0]!.id, () => ({ default_agent: "bootstrap-sentinel" }));
  await server.stop(); await server.stop(); expect(await runtimeDbHandles(f.db)).toBe(0);
  await rm(f.root, { recursive: true });
});


for (const kind of ["tasks", "projects"] as const) test(`an accepted pending ${kind} round survives its originating owner stopping`, async () => {
  const timing = kind === "tasks" ? createOwnerStopTiming() : undefined;
  ownerStopTiming = timing;
  timing?.record("fixture.enter");
  try {
    const f = await fixture();
    timing?.record("fixture.ready");
    const { createServer } = await import("node:http");
    const { acquireRuntimeDbLifetime } = await import("./runtime-db-lifecycle.js");
    const { writeEigenweltConnection } = await import("./eigenwelt-connection-store.js");
    const task = await import("./task-sync.js"), project = await import("./project-sync.js");
    const start = kind === "tasks" ? task.startTaskSyncTimer : project.startProjectSyncTimer;
    const schedule = kind === "tasks" ? task.scheduleTaskSync : project.scheduleProjectSync;
    const firstConfig = f.config, secondConfig = { ...f.config };
    const first = acquireRuntimeDbLifetime(firstConfig), second = acquireRuntimeDbLifetime(secondConfig);
    const previousPlatform = process.env.EIGENWELT_PLATFORM_URL;
    let calls = 0, stopFirst: (() => Promise<void>) | undefined, stopSecond: (() => Promise<void>) | undefined;
    const http = createServer((request, response) => { calls++; if (calls === 1) timing?.record("http.arrived", calls); request.resume(); response.writeHead(500).end("unavailable"); });
    let primaryFailed = false, cancelArrival = () => {};
    let cleanupPromise: Promise<void> | undefined;
    const cleanup = () => cleanupPromise ??= (async () => {
      cancelArrival();
      timing?.record("cleanup.enter");
      let cleanupFailed = false, cleanupError: unknown;
      const failed = (error: unknown) => { timing?.record("cleanup.failed"); if (!cleanupFailed) { cleanupFailed = true; cleanupError = error; } };
      try {
        try { await stopFirst?.(); } catch (error) { failed(error); }
        timing?.record("owner.second.stop.enter");
        try { await stopSecond?.(); timing?.record("owner.second.stop.done"); } catch (error) { failed(error); }
        try { await first.release(); } catch (error) { failed(error); }
        try { await second.release(); } catch (error) { failed(error); }
        try { await new Promise<void>(resolve => http.close(() => resolve())); } catch (error) { failed(error); }
      } finally {
        if (previousPlatform === undefined) delete process.env.EIGENWELT_PLATFORM_URL; else process.env.EIGENWELT_PLATFORM_URL = previousPlatform;
        if (!cleanupFailed) timing?.record("cleanup.drained", calls);
        timing?.record("cleanup.attempts.done", calls);
        if (!calls) timing?.record("http.no-http-observed");
      }
      if (cleanupFailed && !primaryFailed) throw cleanupError;
    })();
    // Bun owns the unchanged 5000ms bound. A runner timeout must still release the waiter and owners.
    cleanups.push(async () => { primaryFailed = true; await cleanup(); });
    try {
      await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
      timing?.record("http.listening");
      const address = http.address(); if (!address || typeof address === "string") throw new Error("platform failed to bind");
      process.env.EIGENWELT_PLATFORM_URL = `http://127.0.0.1:${address.port}`;
      timing?.record("connection.write.enter");
      await writeEigenweltConnection(f.config, { platformToken: "fixture", platformURL: process.env.EIGENWELT_PLATFORM_URL, account: { userId: "fixture", userName: "Fixture", userEmail: "fixture@example.test", orgId: "fixture", orgName: "Fixture" } });
      timing?.record("connection.write.done");
      timing?.record("owner.first.start.enter");
      await first.run(async () => { stopFirst = start(firstConfig, 60_000, 60_000); });
      timing?.record("owner.first.start.done");
      timing?.record("owner.second.start.enter");
      await second.run(async () => { stopSecond = start(secondConfig, 60_000, 60_000); });
      timing?.record("owner.second.start.done");
      let onArrival!: () => void;
      const arrived = new Promise<true>(resolve => {
        onArrival = () => resolve(true);
        http.once("request", onArrival);
      });
      const cancelled = new Promise<false>(resolve => {
        cancelArrival = () => { http.off("request", onArrival); resolve(false); };
      });
      timing?.record("schedule.call.enter");
      await first.run(async () => { schedule(firstConfig, 25); });
      timing?.record("schedule.call.returned");
      timing?.record("owner.first.stop.enter");
      await stopFirst!();
      timing?.record("owner.first.stop.done");
      timing?.record("owner.first.release.enter");
      await first.release();
      timing?.record("owner.first.release.done");
      const windowStarted = timing ? performance.now() : 0;
      timing?.record("assertion.window.enter");
      // Only runner-owned cleanup can cancel; it must not reject an already timed-out test.
      if (!await Promise.race([arrived, cancelled])) return;
      timing?.record("assertion.check", calls, performance.now() - windowStarted);
      expect(calls).toBeGreaterThan(0);
    } catch (error) {
      primaryFailed = true;
      if (timing) { timing.primaryFailed = true; timing.record("primary.failed"); }
      throw error;
    } finally { await cleanup(); }
    expect(await runtimeDbHandles(f.db)).toBe(0); await rm(f.root, { recursive: true });
  } catch (error) {
    if (timing && !timing.primaryFailed) { timing.primaryFailed = true; timing.record("primary.failed"); }
    throw error;
  } finally { if (timing) timing.completed = true; }
});

// Collector boundary checks do not start a runtime or alter the target fixture.
test("owner-stop collector bounds and allowlists failure evidence without replacing errors", () => {
  const timing = createOwnerStopTiming();
  const privateValue = "https://private.test/token/private-path?body=secret";
  for (let i = 0; i < 80; i++) timing.record("fixture.enter", i);
  Reflect.apply(timing.record, undefined, [privateValue, privateValue]);
  let output = "";
  timing.publish("primary-failed", (line) => { output = line; });
  const result = JSON.parse(output);
  expect(result.events).toHaveLength(64);
  expect(result.dropped).toBe(17);
  expect(result.events.every((event: { elapsedMs: number; count: number }) => Number.isFinite(event.elapsedMs) && Number.isInteger(event.count))).toBe(true);
  expect(output).not.toContain(privateValue);
  expect(Object.keys(result).sort()).toEqual(["dropped", "events", "fixture", "outcome", "schema"]);
  let publishedAgain = false;
  timing.publish("primary-failed", () => { publishedAgain = true; });
  expect(publishedAgain).toBe(false);
  const sanitized = createOwnerStopTiming();
  Reflect.apply(sanitized.record, undefined, [privateValue, 1]);
  Reflect.apply(sanitized.record, undefined, ["fixture.enter", privateValue, { token: privateValue, cause: privateValue }]);
  sanitized.record("fixture.enter", Infinity);
  sanitized.record("fixture.enter", -1);
  sanitized.record("fixture.enter", 1e100);
  sanitized.publish("primary-failed", (line) => { output = line; });
  const safe = JSON.parse(output);
  expect(safe.events).toHaveLength(4);
  expect(safe.dropped).toBe(1);
  expect(output).not.toContain(privateValue);
  expect(safe.events.map((event: { count?: number }) => event.count)).toEqual([undefined, undefined, 0, 65_535]);
  expect(safe.events.every((event: { elapsedMs: number }, i: number) => i === 0 || event.elapsedMs >= safe.events[i - 1].elapsedMs)).toBe(true);
  const invalidOutcome = createOwnerStopTiming();
  let invalidPublished = false;
  Reflect.apply(invalidOutcome.publish, undefined, [privateValue, () => { invalidPublished = true; }]);
  expect(invalidPublished).toBe(false);
  const signout = createSyncFixtureTiming("task-signout", ["fixture.enter"]);
  signout.record("fixture.enter");
  signout.publish("incomplete-at-cleanup", (line) => { output = line; });
  expect(JSON.parse(output).fixture).toBe("task-signout");
  const primary = new Error(privateValue);
  const brokenOutput = createOwnerStopTiming();
  let caught: unknown;
  try { try { throw primary; } finally { brokenOutput.publish("primary-failed", () => { throw new Error(privateValue); }); } }
  catch (error) { caught = error; }
  expect(caught).toBe(primary);
  const brokenStages: string[] = [];
  brokenStages.includes = () => { throw new Error(privateValue); };
  const brokenRecord = createSyncFixtureTiming("tasks-owner-stop", brokenStages);
  try { try { throw primary; } finally { brokenRecord.record("fixture.enter"); } }
  catch (error) { caught = error; }
  expect(caught).toBe(primary);
});
