import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireRuntimeDbLifetime, runtimeDbPath, runtimeDbResource, withRuntimeDb } from "./runtime-db-lifecycle.js";
import { openSqlite } from "./runtime-db.js";
import { readRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
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
