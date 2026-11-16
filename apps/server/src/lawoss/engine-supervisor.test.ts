import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngineSupervisor } from "./engine-supervisor.js";

type FakeEngine = { id: number; exit: () => void; onUnexpectedExit: (listener: () => void) => () => void };
const fakeEngine = (id: number): FakeEngine => {
  const listeners = new Set<() => void>();
  return { id, exit: () => { for (const listener of listeners) listener(); }, onUnexpectedExit: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
};
const clock = () => {
  let time = 0, pending: Array<{ run: () => void; at: number }> = [];
  return {
    now: () => time,
    setTimer: (run: () => void, ms: number) => { const entry = { run, at: time + ms }; pending.push(entry); return entry; },
    clearTimer: (timer: object) => { pending = pending.filter(entry => entry !== timer); },
    async advance(ms: number) { time += ms; const due = pending.filter(entry => entry.at <= time); pending = pending.filter(entry => entry.at > time); for (const entry of due) entry.run(); await Bun.sleep(0); },
    get pending() { return pending.length; },
  };
};

test("#454: neočakávané ukončenie spustí engine znova s odstupom, zlyhania opakuje až po limit", async () => {
  const time = clock(), statuses: string[] = [], restarts: number[] = [];
  let fail = true;
  const supervisor = createEngineSupervisor<FakeEngine>({ ...time, delays: [100, 200], stableMs: 1_000, log: () => {},
    status: status => statuses.push(status),
    restart: async exited => { restarts.push(exited.id); if (fail) throw new Error("synthetic start failure"); } });
  const engine = supervisor.watch(fakeEngine(1));
  engine.exit();
  expect(statuses).toEqual(["starting"]);
  await time.advance(99); expect(restarts).toEqual([]);
  await time.advance(1); expect(restarts).toEqual([1]);
  expect(statuses).toEqual(["starting", "starting"]);
  await time.advance(200); expect(restarts).toEqual([1, 1]);
  expect(statuses.at(-1)).toBe("error");
  expect(time.pending).toBe(0);
  fail = false;
});

test("#454: po stabilnom behu sa počítadlo vynuluje; close() zruší čakajúci pokus", async () => {
  const time = clock(), restarts: number[] = [];
  const supervisor = createEngineSupervisor<FakeEngine>({ ...time, delays: [100], stableMs: 1_000, log: () => {}, status: () => {},
    restart: async exited => { restarts.push(exited.id); } });
  supervisor.watch(fakeEngine(1)).exit();
  await time.advance(100); expect(restarts).toEqual([1]);
  const second = supervisor.watch(fakeEngine(2));
  await time.advance(1_000);
  second.exit();
  await time.advance(100); expect(restarts).toEqual([1, 2]);
  const third = supervisor.watch(fakeEngine(3));
  third.exit();
  supervisor.close();
  expect(time.pending).toBe(0);
  await time.advance(1_000); expect(restarts).toEqual([1, 2]);
});

test("#454: spravovaný životný cyklus nahradí ukončený engine, zámerné close() nie", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-engine-supervisor-")), script = join(root, "control.mjs");
  const at = (path: string) => JSON.stringify(new URL(path, import.meta.url).href);
  await writeFile(script, `
    import { mock } from "bun:test";
    import assert from "node:assert/strict";
    let affinity, created = [], serviceStops = 0, failConnect = 0;
    mock.module(${at("../managed-image-affinity.ts")}, () => ({ createManagedImageAffinity: async () => ({
      async connect() { if (failConnect > 0) { failConnect--; throw new Error("synthetic binding failure"); } affinity = { storageNamespace: "owned", connectionGeneration: {} }; }, disconnect() { affinity = undefined; }, resolve() { return affinity; } }) }));
    mock.module(${at("../native-engine-recovery.ts")}, () => ({ inspectNativeEngineRecovery: async () => ({ sessions: [] }), assertNativeEngineRecoveryProjectsReady: async () => {} }));
    mock.module(${at("../session-history-permissions.ts")}, () => ({ assertRegisteredLegacySessionPermissionsReady: async () => {}, restoreRegisteredLegacySessionPermissions: async () => {} }));
    mock.module(${at("../legalwork-runtime-config.ts")}, () => ({ writeLegalworkRuntimeConfigFile: async () => "synthetic-config" }));
    mock.module(${at("../native-saved-approval-migration.ts")}, () => ({ migrateStoppedNativeSavedApprovals: async () => ({ changed: false }) }));
    mock.module(${at("../managed-opencode-service.ts")}, () => ({ stopManagedOpencodeService: async () => { serviceStops++; } }));
    mock.module(${at("../managed-opencode.ts")}, () => ({ createManagedOpencodeServer: async () => { throw new Error("Use injected owned creator"); } }));
    mock.module(${JSON.stringify(import.meta.resolve("@opencode/client"))}, () => ({ OpenCode: { make: () => ({
      session: { active: async () => ({}) },
      event: { async *subscribe({ signal }) { await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener("abort", resolve, { once: true }); }); } },
    }) } }));
    const { startManagedEngineLifecycle } = await import(${at("../managed-engine-lifecycle.ts")});
    const workspace = { id: "project", path: ${JSON.stringify(root)}, name: "Project", preset: "starter", workspaceType: "local" }, config = { workspaces: [workspace] };
    const lifecycle = await startManagedEngineLifecycle({ config, database: "synthetic", service: {}, create: async mode => {
      const listeners = new Set();
      const child = { mode, url: "http://127.0.0.1:" + (32700 + created.length), username: "synthetic", password: "synthetic", closed: false,
        async close() { this.closed = true; }, onUnexpectedExit(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        crash() { for (const listener of listeners) listener(); } };
      created.push(child); config.managedEngineStatus = "ready"; return child;
    } });
    try {
      assert.equal(config.managedEngineRecoveryState().mode, "service");
      assert.equal(config.opencodeBaseUrl, created[0].url);
      const stopsBefore = serviceStops;
      failConnect = 1;
      created[0].crash();
      assert.equal(config.managedEngineStatus, "starting", "health reports the engine as not ready while it is down");
      // Prvý pokus (po 1 s) zlyhá pri publikovaní, druhý (o 3 s neskôr) uspeje.
      for (let i = 0; i < 160 && config.opencodeBaseUrl !== created[2]?.url; i++) await Bun.sleep(50);
      assert.equal(created.length, 3);
      assert.equal(created[1].closed, true, "the failed attempt is closed");
      assert.equal(created[2].mode, "service");
      assert.equal(created[0].closed, true);
      assert.equal(serviceStops, stopsBefore + 2, "a stale service registration is cleared before each attempt");
      assert.equal(config.opencodeBaseUrl, created[2].url);
      assert.equal(workspace.baseUrl, created[2].url);
      assert.equal(config.managedEngineStatus, "ready");
      assert.equal(config.managedImageAffinity(workspace).storageNamespace, "owned");
      created[0].crash();
      await Bun.sleep(1_200);
      assert.equal(created.length, 3, "an engine already replaced is not restarted again");
    } finally { await lifecycle.close(); }
    created[2].crash();
    await Bun.sleep(1_200);
    assert.equal(created.length, 3, "nothing restarts after the lifecycle closed");
    assert(created.every(child => child.closed));
    console.log("completed supervised restart");
  `);
  try {
    const child = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe" });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, stderr: exit === 0 ? "" : stderr, stdout }).toEqual({ exit: 0, stderr: "", stdout: "completed supervised restart\n" });
  } finally { await rm(root, { recursive: true, force: true }); }
}, 30_000);
