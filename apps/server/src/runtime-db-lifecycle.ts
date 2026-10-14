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
  predecessor?: Entry;
  closing?: Promise<void>;
  closeFailed: boolean;
  closeFailures: Map<symbol, unknown>;
  closed: Promise<void>;
  resolveClosed: () => void;
  waiters: Array<{ resolve: () => void; reject: (error: unknown) => void }>;
};
type Scope = { config: ServerConfig; entry: Entry; active: boolean };
const entries = new Map<string, Entry>();
const context = new AsyncLocalStorage<Scope>();

/** Recovery always targets the captured failed resource/generation, never the current path. */
export class RuntimeDbCleanupError extends AggregateError {
  constructor(errors: unknown[], message: string, public retryCleanup: () => Promise<void>) {
    super(errors, message);
  }
}

/** A factory could not initialize or release its partially opened native connection. */
export class RuntimeDbInitializationError extends RuntimeDbCleanupError {
  constructor(errors: unknown[], public resource: Resource, retryCleanup: () => Promise<void>) {
    super(errors, "Runtime database initialization and cleanup failed", retryCleanup);
  }
}

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
  let resolveClosed!: () => void;
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
  const entry: Entry = { path, owners: 0, operations: 0, resources: new Map(), ready: current?.closed ?? Promise.resolve(), predecessor: current, waiters: [], closeFailed: false, closeFailures: new Map(), closed, resolveClosed };
  entries.set(path, entry);
  // A readiness promise alone does not retain its failed predecessor/native resources.
  void entry.ready.then(() => { entry.predecessor = undefined; });
  return entry;
}

function closeIfIdle(entry: Entry, retry = false): Promise<void> | undefined {
  if (entry.operations) return;
  if (entry.owners) {
    for (const waiter of entry.waiters.splice(0)) waiter.resolve();
    return;
  }
  if (entry.closing) return entry.closing;
  entry.closeFailed = false;
  entry.closing = (async () => {
    await entry.ready;
    await Promise.all([...entry.resources].map(async ([key, resource]) => {
      if (!retry && entry.closeFailures.has(key)) return;
      try {
        await (await resource).close();
        if (entry.resources.get(key) === resource) entry.resources.delete(key);
        entry.closeFailures.delete(key);
      } catch (error) {
        // A failed factory already removed or retained its partial native handle.
        if (entry.resources.get(key) === resource) entry.closeFailures.set(key, error);
      }
    }));
    if (entry.closeFailures.size) {
      entry.closeFailed = true;
      throw new RuntimeDbCleanupError([...entry.closeFailures.values()], "Failed to close runtime database resources", () => retryCleanup(entry));
    }
  })();
  void entry.closing.then(() => {
    if (entries.get(entry.path) === entry) entries.delete(entry.path);
    entry.resolveClosed();
    for (const waiter of entry.waiters.splice(0)) waiter.resolve();
  }, error => {
    // Retain failed native resources; successors wait for explicit successful recovery.
    for (const waiter of entry.waiters.splice(0)) waiter.reject(error);
  });
  return entry.closing;
}

async function retryCleanup(entry: Entry): Promise<void> {
  if (entry.owners || entry.operations) throw new Error("Runtime database cleanup requires every owner and operation to release");
  if (entry.closing && !entry.closeFailed) return entry.closing;
  entry.closing = undefined;
  await closeIfIdle(entry, true);
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
    retryCleanup: () => retryCleanup(entry),
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
      if (failure) throw new RuntimeDbCleanupError([failure.error, cleanupError], "Runtime operation and cleanup failed", () => retryCleanup(entry));
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
  if (entry.closeFailures.has(key)) throw entry.closeFailures.get(key);
  const existing = entry.resources.get(key);
  // A private adapter symbol has exactly one resource type for this generation.
  if (existing) return existing as Promise<T>;
  const opened = entry.ready.then(() => open(entry.path));
  entry.resources.set(key, opened);
  try { return await opened; }
  catch (error) {
    if (entry.resources.get(key) === opened) {
      if (error instanceof RuntimeDbInitializationError) {
        entry.resources.set(key, Promise.resolve(error.resource));
        entry.closeFailures.set(key, error);
        error.retryCleanup = () => retryCleanup(entry);
      } else entry.resources.delete(key);
    }
    throw error;
  }
}
