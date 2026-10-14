import { AsyncLocalStorage } from "node:async_hooks";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ServerConfig } from "./types.js";

type Resource = { close: () => void | Promise<void> };
type Entry = {
  path: string;
  owners: number;
  operations: number;
  resources: Map<symbol, Promise<Resource>>;
  ready: Promise<void>;
  closing?: Promise<void>;
  waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }>;
};
type Scope = { config: ServerConfig; entry: Entry; active: boolean };
const entries = new Map<string, Entry>();
const context = new AsyncLocalStorage<Scope>();

// Resolve existing symlink parents too, before the database itself exists.
function canonicalPath(path: string): string {
  try { return realpathSync.native(path); }
  catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    const parent = dirname(path);
    return parent === path ? path : join(canonicalPath(parent), basename(path));
  }
}

export function runtimeDbPath(config: ServerConfig): string {
  const scope = context.getStore();
  if (scope?.config === config) {
    if (!scope.active && !scope.entry.owners) throw new Error("Runtime database scope has been released");
    return scope.entry.path;
  }
  const override = process.env.LEGALWORK_RUNTIME_DB?.trim();
  const configDir = config.configPath?.trim() ? dirname(config.configPath) : join(homedir(), ".config", "legalwork");
  return canonicalPath(resolve(override || join(configDir, "runtime.sqlite")));
}

function entryFor(config: ServerConfig): Entry {
  const scope = context.getStore();
  if (scope?.config === config) {
    if (!scope.active && !scope.entry.owners) throw new Error("Runtime database scope has been released");
    return scope.entry;
  }
  const path = runtimeDbPath(config);
  const current = entries.get(path);
  if (current && !current.closing) return current;
  const entry: Entry = { path, owners: 0, operations: 0, resources: new Map(), ready: current?.closing ?? Promise.resolve(), waiters: [] };
  entries.set(path, entry);
  return entry;
}

function closeIfIdle(entry: Entry): Promise<void> | undefined {
  if (entry.operations) return;
  if (entry.owners) {
    for (const waiter of entry.waiters.splice(0)) waiter.resolve();
    return;
  }
  if (entry.closing) return entry.closing;
  entry.closing = (async () => {
    await entry.ready;
    const results = await Promise.allSettled([...entry.resources.values()].map(async resource => (await resource).close()));
    entry.resources.clear();
    const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, "Failed to close runtime database resources");
  })();
  void entry.closing.then(() => {
    if (entries.get(entry.path) === entry) entries.delete(entry.path);
    for (const waiter of entry.waiters.splice(0)) waiter.resolve();
  }, error => {
    // Keep a failed generation: a later acquisition must not silently reopen it.
    for (const waiter of entry.waiters.splice(0)) waiter.reject(error);
  });
  return entry.closing;
}

function waitForFinalClose(entry: Entry): Promise<void> {
  return closeIfIdle(entry) ?? new Promise((resolve, reject) => entry.waiters.push({ resolve, reject }));
}

/** A unique owner of a fixed path. Cached class facades are borrowed until release. */
export function acquireRuntimeDbLifetime(config: ServerConfig) {
  const entry = entryFor(config);
  entry.owners++;
  let released = false;
  const running = new Set<Promise<unknown>>();
  let releasePromise: Promise<void> | undefined;
  return {
    path: entry.path,
    run<T>(operation: () => Promise<T>): Promise<T> {
      if (released) return Promise.reject(new Error("Runtime database owner has been released"));
      const run = runOperation(config, entry, operation);
      running.add(run);
      void run.then(() => running.delete(run), () => running.delete(run));
      return run;
    },
    release(): Promise<void> {
      if (releasePromise) return releasePromise;
      released = true;
      releasePromise = (async () => {
        await Promise.allSettled([...running]);
        entry.owners--;
        if (!entry.owners) await waitForFinalClose(entry);
      })();
      return releasePromise;
    },
  };
}

async function runOperation<T>(config: ServerConfig, entry: Entry, operation: () => Promise<T>): Promise<T> {
  entry.operations++;
  const scope: Scope = { config, entry, active: true };
  let failure: { error: unknown } | undefined;
  try {
    await entry.ready;
    return await context.run(scope, operation);
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    scope.active = false;
    entry.operations--;
    try { await closeIfIdle(entry); }
    catch (cleanupError) {
      if (failure) throw new AggregateError([failure.error, cleanupError], "Runtime operation and cleanup failed");
      throw cleanupError;
    }
  }
}

/** Delayed callbacks inherited from a completed generation cannot resurrect its storage. */
export function runtimeDbScopeActive(config: ServerConfig): boolean {
  const scope = context.getStore();
  return scope?.config !== config || scope.active || scope.entry.owners > 0;
}

/** Scope the entire asynchronous operation, including nested calls and queued work. */
export function withRuntimeDb<T>(config: ServerConfig, operation: () => Promise<T>): Promise<T> {
  return runOperation(config, entryFor(config), operation);
}

/** Only borrowed from a live operation/lifetime; independent .open stores never enter this cache. */
export async function runtimeDbResource<T extends Resource>(config: ServerConfig, key: symbol, open: (path: string) => Promise<T>): Promise<T> {
  const entry = entryFor(config);
  if (!entry.owners && !entry.operations) throw new Error("Cached runtime stores require an active database lifetime");
  const existing = entry.resources.get(key);
  // A private adapter symbol has exactly one resource type for this generation.
  if (existing) return existing as Promise<T>;
  const opened = entry.ready.then(() => open(entry.path));
  entry.resources.set(key, opened);
  try { return await opened; }
  catch (error) {
    if (entry.resources.get(key) === opened) entry.resources.delete(key);
    throw error;
  }
}
