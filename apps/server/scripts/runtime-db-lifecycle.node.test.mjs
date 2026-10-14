import assert from "node:assert/strict";
import { test } from "node:test";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, mkdir, realpath, rm, rename, access, writeFile } from "node:fs/promises";
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
const { acquireRuntimeDbLifetime } = await import("../dist/runtime-db-lifecycle.js");
const { readRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } = await import("../dist/runtime-opencode-config-store.js");
const { readLegalworkWorkspaceConfig, writeLegalworkWorkspaceConfig } = await import("../dist/legalwork-workspace-config-store.js");
const { readSessionGroupState, writeSessionGroupState } = await import("../dist/session-groups.js");
const { readEigenweltConnection, writeEigenweltConnection } = await import("../dist/eigenwelt-connection-store.js");
const { readHubInstalls, recordHubInstall } = await import("../dist/eigenwelt-hub-installs-store.js");
const { readInstalledCloudPlugins } = await import("../dist/cloud-plugins.js");
const { TaskStore, taskStore } = await import("../dist/task-store.js");
const { ProjectSyncStore, projectSyncStore } = await import("../dist/project-sync-store.js");
const { startProjectSyncTimer, runProjectSync } = await import("../dist/project-sync.js");

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
    const tasks = await taskStore(config), projects = await projectSyncStore(config);
    tasks.setSyncState({ orgId: "fixture", pullCursor: "cursor", lastPullAt: 1, lastPushAt: 2, lastError: null });
    await first.stop(); await first.stop();
    const base = `http://127.0.0.1:${second.port}`;
    const project = await fetch(`${base}/workspace/stable/project`, { headers: { Authorization: "Bearer client" } }); assert.equal(project.status, 200); await project.arrayBuffer();
    assert.equal(tasks.getSyncState("fixture").pullCursor, "cursor"); assert.deepEqual(projects.links(), []);
    const moved = join(root, "moved"); await rename(path, moved);
    const reconnect = await fetch(`${base}/workspace/stable/reconnect`, { method: "POST", headers: { "X-LegalWork-Host-Token": "host", "Content-Type": "application/json" }, body: JSON.stringify({ folderPath: moved, expectedPath: path }) });
    assert.equal(reconnect.status, 200); await reconnect.arrayBuffer(); await second.stop();
    assert.equal(await runtimeDbHandles(db), 0);
    const third = await start();
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
    assert.equal(await runtimeDbHandles(db), 0);
    await verifyWatcherOwnerHandoff({ ...config, workspaces: [{ ...config.workspaces[0], path: moved }] });
    assert.equal(await runtimeDbHandles(db), 0);
    await rm(root, { recursive: true }); await mkdir(root);
    assert.deepEqual(await readRuntimeOpencodeConfig(config, "stable"), {});
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
