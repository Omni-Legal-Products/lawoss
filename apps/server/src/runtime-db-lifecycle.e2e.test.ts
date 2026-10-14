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

let previousRuntimeDb: string | undefined;
beforeEach(() => { previousRuntimeDb = process.env.LEGALWORK_RUNTIME_DB; delete process.env.LEGALWORK_RUNTIME_DB; });
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  try { while (cleanups.length) await cleanups.pop()?.(); }
  finally { if (previousRuntimeDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousRuntimeDb; }
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
