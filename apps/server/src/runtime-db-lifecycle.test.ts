import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RuntimeDbCleanupError, acquireRuntimeDbLifetime, runtimeDbPath, runtimeDbResource, withRuntimeDb } from "./runtime-db-lifecycle.js";
import { initializeSqlite, openSqlite } from "./runtime-db.js";
import { closeRuntimeOpencodeConfig, readRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import { readLegalworkWorkspaceConfig } from "./legalwork-workspace-config-store.js";
import { readSessionGroupState } from "./session-groups.js";
import { closeEigenweltConnection, readEigenweltConnection } from "./eigenwelt-connection-store.js";
import { readHubInstalls } from "./eigenwelt-hub-installs-store.js";
import { readInstalledCloudPlugins } from "./cloud-plugins.js";
import { TaskStore, taskStore } from "./task-store.js";
import { ProjectSyncStore, projectSyncStore } from "./project-sync-store.js";
import { runtimeDbHandles } from "./test-support/runtime-db-handles.js";
import type { ServerConfig } from "./types.js";
let previousRuntimeDb: string | undefined;
beforeEach(() => { previousRuntimeDb = process.env.LEGALWORK_RUNTIME_DB; delete process.env.LEGALWORK_RUNTIME_DB; });
const cleanups: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  try { while (cleanups.length) await cleanups.pop()?.(); }
  finally { if (previousRuntimeDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousRuntimeDb; }
});
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "runtime-ownership-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const config = { configPath: join(root, "server.json") } as ServerConfig;
  return { root, config, path: join(root, "runtime.sqlite") };
}
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test("independent TaskStore and ProjectSyncStore close only their own native connections", async () => {
  const f = await fixture();
  const a = await TaskStore.open(f.path, join(f.root, "attachments"));
  const b = await TaskStore.open(f.path, join(f.root, "attachments"));
  const c = await ProjectSyncStore.open(f.path); const d = await ProjectSyncStore.open(f.path);
  a.setSyncState({ orgId: "fixture", pullCursor: "kept", lastPullAt: 1, lastPushAt: null, lastError: null });
  a.close(); a.close(); c.close(); c.close();
  expect(b.getSyncState("fixture").pullCursor).toBe("kept"); expect(d.links()).toEqual([]);
  b.close(); d.close(); expect(await runtimeDbHandles(f.path)).toBe(0);
});

test("an explicit retained facade owner outlives another owner and releases idempotently", async () => {
  const f = await fixture(); const caller = acquireRuntimeDbLifetime(f.config), server = acquireRuntimeDbLifetime(f.config);
  const tasks = await taskStore(f.config), projects = await projectSyncStore(f.config);
  await server.release();
  await Promise.resolve(); tasks.setSyncState({ orgId: "fixture", pullCursor: "retained", lastPullAt: 1, lastPushAt: null, lastError: null });
  expect(projects.links()).toEqual([]); await caller.release(); await caller.release();
  expect(await runtimeDbHandles(f.path)).toBe(0);
  await withRuntimeDb(f.config, async () => expect((await taskStore(f.config)).getSyncState("fixture").pullCursor).toBe("retained"));
});

test("release waits for a reserved native opening and closes it once it finishes", async () => {
  const f = await fixture(), gate = barrier(), entered = barrier();
  const owner = acquireRuntimeDbLifetime(f.config);
  const opening = runtimeDbResource(f.config, Symbol(), async path => { entered.resolve(); await gate.promise; return openSqlite(path); });
  await entered.promise;
  let stopped = false; const release = owner.release().then(() => { stopped = true; });
  await Promise.resolve(); expect(stopped).toBe(false);
  gate.resolve(); await opening; await release;
  expect(await runtimeDbHandles(f.path)).toBe(0);
});

test("new generation waits for old close and cannot be evicted by that close", async () => {
  const f = await fixture(), gate = barrier(), entered = barrier(); const key = Symbol();
  const owner = acquireRuntimeDbLifetime(f.config);
  await runtimeDbResource(f.config, key, async path => {
    const db = await openSqlite(path); return { close: async () => { entered.resolve(); await gate.promise; db.close(); } };
  });
  const closing = owner.release(); await entered.promise;
  const next = acquireRuntimeDbLifetime(f.config);
  let opened = false;
  const read = next.run(async () => { const db = await runtimeDbResource(f.config, key, openSqlite); opened = true; db.exec("CREATE TABLE kept (value TEXT)"); });
  await Promise.resolve(); expect(opened).toBe(false);
  gate.resolve(); await closing; await read;
  await next.run(async () => expect((await runtimeDbResource(f.config, key, openSqlite)).get("SELECT count(*) AS n FROM kept")?.n).toBe(0));
  await next.release(); expect(await runtimeDbHandles(f.path)).toBe(0);
});

test("release waiting for an operation is not held hostage by a newly overlapping owner", async () => {
  const f = await fixture(), gate = barrier(), entered = barrier();
  const first = acquireRuntimeDbLifetime(f.config);
  const work = first.run(async () => { await readRuntimeOpencodeConfig(f.config, "fixture"); entered.resolve(); await gate.promise; });
  await entered.promise; const release = first.release(); const next = acquireRuntimeDbLifetime(f.config);
  gate.resolve(); await work;
  try { expect(await Promise.race([release.then(() => "released"), new Promise(resolve => setTimeout(() => resolve("blocked"), 100))])).toBe("released"); }
  finally { await next.release(); await release; }
  expect(await runtimeDbHandles(f.path)).toBe(0);
});

test("fixed acquisition path survives config and environment mutation across awaits", async () => {
  const f = await fixture(); const owner = acquireRuntimeDbLifetime(f.config); const prior = process.env.LEGALWORK_RUNTIME_DB;
  try {
    await owner.run(async () => {
      await writeRuntimeOpencodeConfig(f.config, "fixture", () => ({ default_agent: "original" }));
      process.env.LEGALWORK_RUNTIME_DB = join(f.root, "other.sqlite"); f.config.configPath = join(f.root, "elsewhere", "server.json");
      await Promise.resolve(); expect(runtimeDbPath(f.config)).toBe(f.path);
      expect((await readRuntimeOpencodeConfig(f.config, "fixture")).default_agent).toBe("original");
    });
  } finally {
    await owner.release(); if (prior === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = prior;
  }
  expect(await runtimeDbHandles(f.path)).toBe(0);
});

test("lexical and symlink aliases share ownership before the DB exists", async () => {
  const f = await fixture(); const target = join(f.root, "actual"), alias = join(f.root, "alias"); await mkdir(target); await symlink(target, alias, "junction");
  const a = { ...f.config, configPath: join(target, "server.json") }, b = { ...f.config, configPath: join(alias, "server.json") };
  const one = acquireRuntimeDbLifetime(a), two = acquireRuntimeDbLifetime(b);
  expect(one.path).toBe(two.path);
  await writeRuntimeOpencodeConfig(a, "fixture", () => ({ default_agent: "alias" })); await one.release();
  expect((await readRuntimeOpencodeConfig(b, "fixture")).default_agent).toBe("alias"); await two.release();
  expect(await runtimeDbHandles(join(target, "runtime.sqlite"))).toBe(0);
});

test("failed table initialization closes its native handle and permits a corrected retry", async () => {
  const f = await fixture();
  await writeFile(f.path, "not a SQLite database");
  await expect(readRuntimeOpencodeConfig(f.config, "fixture")).rejects.toThrow();
  expect(await runtimeDbHandles(f.path)).toBe(0); await rm(f.path);
  expect(await readRuntimeOpencodeConfig(f.config, "fixture")).toEqual({}); expect(await runtimeDbHandles(f.path)).toBe(0);
});

test("all resources close even when one close rejects, and the error remains visible", async () => {
  const f = await fixture(); const owner = acquireRuntimeDbLifetime(f.config);
  await runtimeDbResource(f.config, Symbol(), async path => { const db = await openSqlite(path); return { close: () => { db.close(); throw new Error("fixture close failure"); } }; });
  await runtimeDbResource(f.config, Symbol(), openSqlite);
  await expect(owner.release()).rejects.toThrow("Failed to close runtime database resources");
  await expect(owner.release()).rejects.toThrow("Failed to close runtime database resources");
  expect(await runtimeDbHandles(f.path)).toBe(0);
});

test("an owner's release waits for its accepted operation even while another owner stays live", async () => {
  const f = await fixture(), gate = barrier(), entered = barrier();
  const first = acquireRuntimeDbLifetime(f.config), second = acquireRuntimeDbLifetime(f.config);
  const writing = first.run(async () => { entered.resolve(); await gate.promise; await writeRuntimeOpencodeConfig(f.config, "fixture", () => ({ default_agent: "finished" })); });
  await entered.promise; let stopped = false; const release = first.release().then(() => { stopped = true; });
  try { await new Promise(resolve => setTimeout(resolve, 10)); expect(stopped).toBe(false); }
  finally { gate.resolve(); await writing; await release; }
  expect((await readRuntimeOpencodeConfig(f.config, "fixture")).default_agent).toBe("finished"); await second.release();
  expect(await runtimeDbHandles(f.path)).toBe(0);
});

test("operation failure remains visible when final resource cleanup also fails", async () => {
  const f = await fixture();
  const primary = new Error("fixture operation failure");
  const result = await withRuntimeDb(f.config, async () => {
    await runtimeDbResource(f.config, Symbol(), async path => { const db = await openSqlite(path); return { close: () => { db.close(); throw new Error("fixture close failure"); } }; });
    throw primary;
  }).catch(error => error);
  expect(result).toBeInstanceOf(AggregateError);
  expect(result.errors).toContain(primary);
  expect(await runtimeDbHandles(f.path)).toBe(0);
});

test("failed close retains its native resource until explicit captured-generation recovery", async () => {
  const f = await fixture(), owner = acquireRuntimeDbLifetime(f.config);
  const db = await openSqlite(f.path); let attempts = 0, siblingCloses = 0;
  cleanups.push(() => db.close());
  await runtimeDbResource(f.config, Symbol(), async () => ({ close: () => { if (++attempts === 1) throw new Error("before native close"); db.close(); } }));
  await runtimeDbResource(f.config, Symbol(), async path => { const sibling = await openSqlite(path); return { close: () => { siblingCloses++; sibling.close(); } }; });
  await expect(owner.release()).rejects.toThrow("Failed to close runtime database resources");
  expect(attempts).toBe(1); expect(siblingCloses).toBe(1);
  if (process.platform !== "win32") expect(await runtimeDbHandles(f.path)).toBeGreaterThan(0);
  const successor = acquireRuntimeDbLifetime(f.config);
  let state = "waiting";
  const reading = successor.run(() => readRuntimeOpencodeConfig(f.config, "fixture")).then(() => { state = "read"; }, () => { state = "rejected"; });
  await new Promise(resolve => setTimeout(resolve, 20));
  try {
    expect(state).toBe("waiting");
    await owner.retryCleanup(); await owner.retryCleanup(); await reading;
    expect(state).toBe("read"); expect(attempts).toBe(2); expect(siblingCloses).toBe(1);
    await expect(owner.release()).rejects.toThrow("Failed to close runtime database resources");
  } finally { await owner.retryCleanup?.().catch(() => undefined); db.close(); await successor.release().catch(() => undefined); }
  expect(await runtimeDbHandles(f.path)).toBe(0); await rm(f.root, { recursive: true });
});

const initializationCases: Array<[string, (config: ServerConfig, path: string, root: string) => Promise<unknown>]> = [
  ["runtime config", config => readRuntimeOpencodeConfig(config, "fixture")],
  ["workspace config", config => readLegalworkWorkspaceConfig(config, "fixture")],
  ["session groups", config => readSessionGroupState(config, "fixture")],
  ["account", config => readEigenweltConnection(config)],
  ["hub installs", config => readHubInstalls(config, "fixture")],
  ["cloud plugins", config => readInstalledCloudPlugins(config, "fixture")],
  ["cached tasks", config => withRuntimeDb(config, async () => (await taskStore(config)).getSyncState("fixture"))],
  ["cached projects", config => withRuntimeDb(config, async () => (await projectSyncStore(config)).links())],
  ["independent tasks", async (_config, path, root) => (await TaskStore.open(path, join(root, "attachments"))).close()],
  ["independent projects", async (_config, path) => (await ProjectSyncStore.open(path)).close()],
];
for (const [name, open] of initializationCases) test(`initialization preserves and recovers the partial native handle: ${name}`, async () => {
  const f = await fixture(); await writeFile(f.path, "not a sqlite database");
  const { Database } = await import("bun:sqlite");
  const close = Database.prototype.close; let partial: InstanceType<typeof Database> | undefined;
  Database.prototype.close = function(...args) { if (!partial) { partial = this; throw new Error("injected cleanup before native close"); } return close.apply(this, args); };
  let failure: unknown;
  try {
    failure = await open(f.config, f.path, f.root).catch(error => error);
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof RuntimeDbCleanupError)) throw new Error("Expected recoverable initialization failure", { cause: failure });
    const messages = (error: unknown): string => error instanceof AggregateError ? error.errors.map(messages).join("\n") : String(error);
    expect(messages(failure)).toContain("not a database");
    expect(messages(failure)).toContain("injected cleanup before native close");
    if (process.platform !== "win32") expect(await runtimeDbHandles(f.path)).toBeGreaterThan(0);
    await failure.retryCleanup(); await failure.retryCleanup(); expect(await runtimeDbHandles(f.path)).toBe(0);
    await rm(f.path); await open(f.config, f.path, f.root); expect(await runtimeDbHandles(f.path)).toBe(0);
    await rm(f.root, { recursive: true });
  } finally {
    try { if (failure instanceof RuntimeDbCleanupError) await failure.retryCleanup(); }
    finally { Database.prototype.close = close; if (partial) close.call(partial); }
  }
});


test("release racing a partial initialization keeps its failed native cleanup recoverable", async () => {
  const f = await fixture(), owner = acquireRuntimeDbLifetime(f.config), gate = barrier(), entered = barrier();
  let attempts = 0;
  const opening = runtimeDbResource(f.config, Symbol(), path => initializeSqlite(path, async db => {
    const close = db.close;
    db.close = () => { if (++attempts === 1) throw new Error("partial close failed before native close"); close(); };
    entered.resolve(); await gate.promise;
    db.exec("SELECT * FROM missing_initialization_table");
    return db;
  })).catch(error => error);
  await entered.promise;
  const releasing = owner.release().catch(error => error);
  gate.resolve();
  const [initialization, cleanup] = await Promise.all([opening, releasing]);
  try {
    expect(initialization).toBeInstanceOf(AggregateError); expect(cleanup).toBeInstanceOf(AggregateError);
    expect(attempts).toBe(1);
    if (process.platform !== "win32") expect(await runtimeDbHandles(f.path)).toBeGreaterThan(0);
    await owner.retryCleanup(); expect(attempts).toBe(2); expect(await runtimeDbHandles(f.path)).toBe(0);
  } finally { await owner.retryCleanup(); }
});

test("recovering a failed independent open cannot close another caller's connection", async () => {
  const f = await fixture(), healthy = await TaskStore.open(f.path, join(f.root, "attachments"));
  cleanups.push(() => healthy.close());
  healthy.setSyncState({ orgId: "fixture", pullCursor: "kept", lastPullAt: 1, lastPushAt: null, lastError: null });
  const { Database } = await import("bun:sqlite");
  const exec = Database.prototype.exec, close = Database.prototype.close;
  let partial: InstanceType<typeof Database> | undefined, failedClose = false, failure: unknown;
  Database.prototype.exec = function(...args) {
    if (!partial) { partial = this; return exec.call(this, "SELECT * FROM missing_initialization_table"); }
    return exec.apply(this, args);
  };
  Database.prototype.close = function(...args) {
    if (this === partial && !failedClose) { failedClose = true; throw new Error("independent cleanup before native close"); }
    return close.apply(this, args);
  };
  try {
    failure = await ProjectSyncStore.open(f.path).catch(error => error);
    expect(failure).toBeInstanceOf(AggregateError);
    if (!(failure instanceof RuntimeDbCleanupError)) throw new Error("Expected recoverable independent-open failure", { cause: failure });
    await failure.retryCleanup(); await failure.retryCleanup();
    expect(healthy.getSyncState("fixture").pullCursor).toBe("kept");
  } finally {
    try { if (failure instanceof RuntimeDbCleanupError) await failure.retryCleanup(); }
    finally { Database.prototype.exec = exec; Database.prototype.close = close; healthy.close(); }
  }
  expect(await runtimeDbHandles(f.path)).toBe(0); await rm(f.root, { recursive: true });
});

for (const close of [closeRuntimeOpencodeConfig, closeEigenweltConnection]) {
  test(`${close.name} drains the captured operation-only generation across environment drift`, async () => {
    const f = await fixture(), entered = barrier(), gate = barrier();
    const pending = withRuntimeDb(f.config, async () => {
      await writeRuntimeOpencodeConfig(f.config, "stable", () => ({ default_agent: "kept" }));
      entered.resolve(); await gate.promise;
    });
    await entered.promise;
    process.env.LEGALWORK_RUNTIME_DB = join(f.root, "other.sqlite");
    let finished = false;
    const drained = close(f.config, f.path).then(() => { finished = true; });
    try { await Promise.resolve(); expect(finished).toBe(false); }
    finally { gate.resolve(); await pending; }
    await drained;
    expect(await runtimeDbHandles(f.path)).toBe(0);
  });
  test(`${close.name} preserves a live borrowed owner and refuses self-drain`, async () => {
    const f = await fixture(), owner = acquireRuntimeDbLifetime(f.config);
    try {
      const tasks = await taskStore(f.config);
      await close(f.config, f.path);
      tasks.setSyncState({ orgId: "fixture", pullCursor: "kept", lastPullAt: 1, lastPushAt: null, lastError: null });
      expect(tasks.getSyncState("fixture").pullCursor).toBe("kept");
      await owner.run(async () => {
        await expect(close(f.config, f.path)).rejects.toThrow("active operation");
        await expect(close({ ...f.config }, f.path)).rejects.toThrow("active operation");
      });
    } finally { await owner.release(); }
    expect(await runtimeDbHandles(f.path)).toBe(0);
  });
}
