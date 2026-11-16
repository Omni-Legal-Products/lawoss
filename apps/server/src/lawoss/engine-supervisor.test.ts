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
    async advance(ms: number) { time += ms; const due = pending.filter(entry => entry.at <= time); pending = pending.filter(entry => entry.at > time); for (const entry of due) entry.run(); for (let i = 0; i < 5; i++) await Bun.sleep(0); },
    get pending() { return pending.length; },
  };
};
/** Životný cyklus v malom: `current` je publikovaný engine, náhrada sa vytvorí, sleduje a publikuje. */
const harness = (time: ReturnType<typeof clock>, publish: (engine: FakeEngine) => Promise<void> = async () => {}) => {
  let next = 1, current = fakeEngine(0);
  const statuses: string[] = [], created: FakeEngine[] = [];
  const supervisor = createEngineSupervisor<FakeEngine>({ ...time, delays: [100, 200], slowMs: 1_000, stableMs: 10_000, log: () => {},
    current: () => current, status: status => statuses.push(status),
    restart: async () => {
      const exited = current;
      const replacement = supervisor.watch(fakeEngine(next++));
      created.push(replacement);
      current = replacement;
      try { await publish(replacement); } catch (error) { current = exited; throw error; }
    } });
  supervisor.watch(current);
  return { supervisor, statuses, created, get current() { return current; } };
};

test("#454: zlyhané pokusy po limite hlásia error a skúšajú ďalej pomaly (výpadok nie je konečný)", async () => {
  const time = clock();
  let failures = 3;
  const h = harness(time, async () => { if (failures-- > 0) throw new Error("synthetic start failure"); });
  h.current.exit();
  expect(h.statuses).toEqual(["starting"]);
  await time.advance(99); expect(h.created.length).toBe(0);
  await time.advance(1); expect(h.created.length).toBe(1);
  await time.advance(200); expect(h.created.length).toBe(2);
  expect(h.statuses.at(-1)).toBe("error");
  await time.advance(1_000); expect(h.created.length).toBe(3);
  expect(h.current.id).toBe(0); // tretí pokus ešte zlyhal
  await time.advance(1_000); expect(h.created.length).toBe(4);
  expect(h.current.id).toBe(4);
  expect(time.pending).toBe(0);
});

test("#454: náhrada spadne počas publikovania a pokus zlyhá: ďalší pokus sa nezahodí", async () => {
  const time = clock();
  let crashFirst = true;
  const h = harness(time, async (engine) => {
    if (crashFirst) { crashFirst = false; engine.exit(); throw new Error("synthetic binding failure"); }
  });
  h.current.exit();
  await time.advance(100);
  expect(h.created.length).toBe(1);
  expect(h.current.id).toBe(0);
  expect(time.pending).toBe(1);
  await time.advance(200);
  expect(h.created.length).toBe(2);
  expect(h.current.id).toBe(2);
  expect(time.pending).toBe(0);
});

test("#454: náhrada spadne hneď po úspešnom publikovaní: nový pokus", async () => {
  const time = clock();
  let crash = true;
  const h = harness(time, async (engine) => { if (crash) { crash = false; engine.exit(); } });
  h.current.exit();
  await time.advance(100);
  expect(h.current.id).toBe(1);
  await time.advance(200);
  expect(h.current.id).toBe(2);
  expect(time.pending).toBe(0);
});

test("#454: po stabilnom behu sa počítadlo vynuluje; close() zruší čakajúci pokus; nahradený engine sa ignoruje", async () => {
  const time = clock();
  const h = harness(time);
  const first = h.current;
  first.exit();
  await time.advance(100); expect(h.current.id).toBe(1);
  first.exit();
  expect(time.pending).toBe(0);
  await time.advance(10_000);
  h.current.exit();
  expect(h.statuses.at(-1)).toBe("starting");
  await time.advance(100); expect(h.current.id).toBe(2);
  h.current.exit();
  h.supervisor.close();
  expect(time.pending).toBe(0);
  await time.advance(5_000); expect(h.created.length).toBe(2);
});

async function lifecycle(scenario: "publish-retry" | "recovery-fallback") {
  const root = await mkdtemp(join(tmpdir(), "lawoss-engine-supervisor-")), script = join(root, "control.mjs");
  const at = (path: string) => JSON.stringify(new URL(path, import.meta.url).href);
  await writeFile(script, `
    import { mock } from "bun:test";
    import assert from "node:assert/strict";
    const scenario = ${JSON.stringify(scenario)};
    let affinity, created = [], serviceStops = 0, failConnect = 0, blockApprovals = false;
    mock.module(${at("../managed-image-affinity.ts")}, () => ({ createManagedImageAffinity: async () => ({
      async connect() { if (failConnect > 0) { failConnect--; throw new Error("synthetic binding failure"); } affinity = { storageNamespace: "owned", connectionGeneration: {} }; }, disconnect() { affinity = undefined; }, resolve() { return affinity; } }) }));
    mock.module(${at("../native-engine-recovery.ts")}, () => ({ inspectNativeEngineRecovery: async () => ({ sessions: [] }),
      assertNativeEngineRecoveryProjectsReady: async () => { if (blockApprovals) throw new Error("synthetic project approval held"); } }));
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
    const lifecycle = await startManagedEngineLifecycle({ config, database: "synthetic", service: {}, create: async (mode, beforeSpawn) => {
      await beforeSpawn?.();
      const listeners = new Set();
      const child = { mode, url: "http://127.0.0.1:" + (32700 + created.length), username: "synthetic", password: "synthetic", closed: false,
        async close() { this.closed = true; }, onUnexpectedExit(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        crash() { for (const listener of listeners) listener(); } };
      created.push(child); config.managedEngineStatus = "ready"; return child;
    } });
    const until = async (condition, ms) => { for (let i = 0; i < ms / 50 && !condition(); i++) await Bun.sleep(50); };
    try {
      assert.equal(config.managedEngineRecoveryState().mode, "service");
      const stopsBefore = serviceStops;
      if (scenario === "publish-retry") {
        failConnect = 1;
        created[0].crash();
        assert.equal(config.managedEngineStatus, "starting", "health reports the engine as not ready while it is down");
        // Prvý pokus (po 1 s) zlyhá pri publikovaní, druhý (o 3 s neskôr) uspeje.
        await until(() => config.opencodeBaseUrl === created[2]?.url, 8_000);
        assert.equal(created.length, 3);
        assert.equal(created[1].closed, true, "the failed attempt is closed");
        assert.equal(created[2].mode, "service");
        assert.equal(serviceStops, stopsBefore + 2, "a stale service registration is cleared before each attempt");
        assert.equal(workspace.baseUrl, created[2].url);
        assert.equal(config.managedEngineStatus, "ready");
        assert.equal(config.managedImageAffinity(workspace).storageNamespace, "owned");
        created[0].crash();
        await Bun.sleep(1_200);
        assert.equal(created.length, 3, "an engine already replaced is not restarted again");
      } else {
        blockApprovals = true;
        created[0].crash();
        await until(() => config.opencodeBaseUrl === created[1]?.url, 4_000);
        assert.equal(created.length, 2);
        assert.equal(created[1].mode, "recovery", "a failed service preflight falls back to recovery like startup");
        assert.equal(config.managedEngineRecoveryState().mode, "recovery");
        assert.match(config.managedEngineRecoveryState().error.message, /synthetic project approval held/);
        assert.equal(config.managedEngineStatus, "ready");
      }
    } finally { await lifecycle.close(); }
    created.at(-1).crash();
    await Bun.sleep(1_200);
    assert.equal(created.length, scenario === "publish-retry" ? 3 : 2, "nothing restarts after the lifecycle closed");
    assert(created.every(child => child.closed));
    console.log("completed " + scenario);
  `);
  try {
    const child = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe" });
    const [exit, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ exit, stderr: exit === 0 ? "" : stderr, stdout }).toEqual({ exit: 0, stderr: "", stdout: `completed ${scenario}\n` });
  } finally { await rm(root, { recursive: true, force: true }); }
}

test("#454: životný cyklus nahradí spadnutý engine a zlyhané publikovanie zopakuje; zámerné close() nie", () => lifecycle("publish-retry"), 30_000);
test("#454: zlyhaný preflight služby po páde prejde do režimu obnovy ako pri štarte", () => lifecycle("recovery-fallback"), 30_000);
