import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngineRestartBudget } from "./engine-restart.js";

test("#454: the restart budget is spent by engines that do not stay up and refilled by one that does", () => {
  let clock = 0;
  const budget = createEngineRestartBudget({ delaysMs: [10, 20], stableMs: 1_000 }, () => clock);
  budget.exited();
  expect([budget.nextDelay(), budget.nextDelay(), budget.nextDelay()]).toEqual([10, 20, null]);
  budget.started(); clock += 999; budget.exited();
  expect(budget.nextDelay()).toBe(null);
  budget.started(); clock += 1_000; budget.exited();
  expect(budget.nextDelay()).toBe(10);
});

// The lifecycle's native dependencies are replaced in a separate process (as in
// managed-engine-lifecycle.test.ts) so other suites keep their real implementations.
const lifecycleScript = (src: string, scenario: string) => `
  import { mock } from "bun:test";
  import assert from "node:assert/strict";
  const scenario = ${JSON.stringify(scenario)};
  const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
  const until = async (condition, label) => { const deadline = Date.now() + 5000; while (!condition()) { if (Date.now() > deadline) throw new Error("timed out: " + label); await new Promise(r => setTimeout(r, 5)); } };
  mock.module(${JSON.stringify(new URL("managed-image-affinity.ts", src).href)}, () => ({ createManagedImageAffinity: async () => ({ async connect() {}, disconnect() {}, resolve() { return undefined; } }) }));
  mock.module(${JSON.stringify(new URL("native-engine-recovery.ts", src).href)}, () => ({ inspectNativeEngineRecovery: async () => ({ sessions: [] }), assertNativeEngineRecoveryProjectsReady: async () => {} }));
  mock.module(${JSON.stringify(new URL("session-history-permissions.ts", src).href)}, () => ({ assertRegisteredLegacySessionPermissionsReady: async () => {}, restoreRegisteredLegacySessionPermissions: async () => {} }));
  mock.module(${JSON.stringify(new URL("legalwork-runtime-config.ts", src).href)}, () => ({ writeLegalworkRuntimeConfigFile: async () => "synthetic-config" }));
  mock.module(${JSON.stringify(new URL("native-saved-approval-migration.ts", src).href)}, () => ({ migrateStoppedNativeSavedApprovals: async () => ({ changed: false }) }));
  mock.module(${JSON.stringify(new URL("managed-opencode-service.ts", src).href)}, () => ({ stopManagedOpencodeService: async () => {} }));
  mock.module(${JSON.stringify(new URL("managed-opencode.ts", src).href)}, () => ({ createManagedOpencodeServer: async () => { throw new Error("Use the injected creator"); } }));
  mock.module(${JSON.stringify(import.meta.resolve("@opencode/client"))}, () => ({ OpenCode: { make: () => ({
    session: { active: async () => ({}) },
    event: { async *subscribe({ signal }) { await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener("abort", resolve, { once: true }); }); } },
  }) } }));
  const { startManagedEngineLifecycle } = await import(${JSON.stringify(new URL("managed-engine-lifecycle.ts", src).href)});
  const workspace = { id: "project", path: "/synthetic", name: "Project", preset: "starter", workspaceType: "local" };
  const config = { workspaces: [workspace] };
  const engines = [];
  let failStarts = false, crashOnStart = false;
  const published = [];
  const lifecycle = await startManagedEngineLifecycle({ config, database: "synthetic", service: {}, restart: { delaysMs: [20, 20, 20], stableMs: 60_000 },
    onEnginePublished: engine => published.push(engine),
    create: async mode => {
      if (failStarts) { engines.push({ failed: true }); throw new Error("Synthetic start failure"); }
      const exit = deferred();
      const engine = { mode, url: "http://127.0.0.1:" + (33100 + engines.length), username: "synthetic", password: "pw" + engines.length, closed: false,
        unexpectedExit: exit.promise, crash: () => exit.resolve({ code: null, signal: "SIGKILL" }), async close() { this.closed = true; } };
      engines.push(engine); config.managedEngineStatus = "ready";
      if (crashOnStart) { crashOnStart = false; engine.crash(); }
      return engine;
    } });
  try {
    assert.equal(engines.length, 1);
    assert.deepEqual(published, [], "the engine found at startup is settled by the caller");
    if (scenario === "restart") {
      engines[0].crash();
      await until(() => config.managedEngineStatus === "starting", "outage reported");
      await assert.rejects(config.withManagedEngineAdmission("new", async () => {}), error => error.code === "engine_restarting");
      await until(() => engines.length === 2 && config.opencodeBaseUrl === engines[1].url, "restarted engine published");
      assert.equal(workspace.baseUrl, engines[1].url);
      assert.equal(workspace.opencodePassword, "pw1");
      assert.equal(config.managedEngineStatus, "ready");
      assert.equal(lifecycle.engine, engines[1]);
      assert.deepEqual(published, [engines[1]], "a restarted engine is announced for its agent ticket");
      let admitted = false;
      await config.withManagedEngineAdmission("new", async () => { admitted = true; });
      assert.equal(admitted, true);
      engines[1].crash();
      await until(() => engines.length === 3 && config.opencodeBaseUrl === engines[2].url, "a restarted engine is supervised too");
    } else if (scenario === "crash-while-restarting") {
      crashOnStart = true;
      engines[0].crash();
      await until(() => engines.length === 3 && config.opencodeBaseUrl === engines[2].url && config.managedEngineStatus === "ready", "an engine that dies during its own restart is restarted again");
      await config.withManagedEngineAdmission("new", async () => {});
    } else if (scenario === "close") {
      await lifecycle.close();
      engines[0].crash();
      await new Promise(r => setTimeout(r, 100));
      assert.equal(engines.length, 1, "a closed lifecycle never restarts");
    } else if (scenario === "close-during-backoff") {
      engines[0].crash();
      await until(() => config.managedEngineStatus === "starting", "outage reported");
      await lifecycle.close();
      await new Promise(r => setTimeout(r, 100));
      assert.equal(engines.length, 1, "closing during the backoff cancels the restart");
    } else if (scenario === "exhausted") {
      failStarts = true;
      engines[0].crash();
      await until(() => config.managedEngineStatus === "error", "restart gives up");
      // Each attempt tries service mode, then falls back to recovery mode.
      assert.equal(engines.filter(engine => engine.failed).length, 6);
      await new Promise(r => setTimeout(r, 100));
      assert.equal(engines.filter(engine => engine.failed).length, 6, "no attempts after the budget is spent");
      assert.equal(config.managedEngineRecoveryState().error.code, "engine_restart_failed");
      await assert.rejects(config.withManagedEngineAdmission("new", async () => {}), error => error.code === "engine_restart_failed");
    } else if (scenario === "manual-retry") {
      assert.equal(config.retryManagedEngineRestart(), false, "a running engine is not restarted on request");
      failStarts = true;
      engines[0].crash();
      await until(() => config.managedEngineStatus === "error", "restart gives up");
      // A retry that fails again spends a fresh budget and reports the failure again.
      assert.equal(config.retryManagedEngineRestart(), true);
      assert.equal(config.managedEngineStatus, "starting");
      await assert.rejects(config.withManagedEngineAdmission("new", async () => {}), error => error.code === "engine_restarting");
      assert.equal(config.retryManagedEngineRestart(), false, "a retry while restarting does not queue another");
      await until(() => config.managedEngineStatus === "error", "the retry gives up too");
      assert.equal(engines.filter(engine => engine.failed).length, 12);
      failStarts = false;
      assert.equal(config.retryManagedEngineRestart(), true);
      await until(() => config.managedEngineStatus === "ready" && config.opencodeBaseUrl === engines.at(-1).url, "the retried engine is published");
      await config.withManagedEngineAdmission("new", async () => {});
      assert.equal(config.managedEngineRecoveryState().error, undefined);
      engines.at(-1).crash();
      await until(() => engines.filter(engine => !engine.failed).length === 3 && config.managedEngineStatus === "ready", "the retried engine is supervised");
    }
  } finally { await lifecycle.close(); }
  console.log("completed " + scenario);
`;

for (const scenario of ["restart", "crash-while-restarting", "close", "close-during-backoff", "exhausted", "manual-retry"]) {
  test(`#454: managed engine lifecycle after an unexpected engine exit: ${scenario}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "lawoss-engine-restart-")), script = join(root, "control.mjs");
    await writeFile(script, lifecycleScript(new URL("../", import.meta.url).href, scenario));
    try {
      const child = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe" });
      const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ exit, stdout, stderr: exit === 0 ? "" : stderr }).toEqual({ exit: 0, stdout: `completed ${scenario}\n`, stderr: "" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
