import type { ServerConfig } from "../types.js";
import { runtimeDbResource, withRuntimeDb } from "../runtime-db-lifecycle.js";

type EngineScope = { workspaceId: string; directory: string; baseUrl: string; authHeader: string | null };
type Pending = { workspaceId: string; task: Promise<void>; names: Set<string> };
const resourceKey = Symbol("deferred-mcp-startup");

function startupState(config: ServerConfig) {
  return runtimeDbResource(config, resourceKey, async () => {
    const pending = new Map<string, Pending>();
    const used = new Set<string>();
    return { armed: false, pending, used, close: () => { pending.clear(); used.clear(); } };
  });
}

function scopeKey(scope: EngineScope): string {
  return JSON.stringify([scope.workspaceId, scope.directory, scope.baseUrl, scope.authHeader]);
}

export function hasUsedMcpScope(config: ServerConfig, scope: EngineScope): Promise<boolean> {
  return withRuntimeDb(config, async () => (await startupState(config)).used.has(scopeKey(scope)));
}

export function deferMcpStartup(config: ServerConfig): Promise<void> {
  return withRuntimeDb(config, async () => { (await startupState(config)).armed = true; });
}

// Persisted local connector changes become visible on the next authorized use,
// without constructing an engine instance in any other directory.
export function deferLocalMcpUpdates(config: ServerConfig, workspaceIds: string[], names: string[]): Promise<void> {
  return withRuntimeDb(config, async () => {
    const state = await startupState(config);
    state.armed = true;
    for (const entry of state.pending.values()) {
      if (workspaceIds.includes(entry.workspaceId)) for (const name of names) entry.names.add(name);
    }
  });
}

export function startDeferredMcp(config: ServerConfig, scope: EngineScope, initialize: (names?: string[]) => Promise<void>): Promise<void> {
  return withRuntimeDb(config, async () => {
    const state = await startupState(config);
    const key = scopeKey(scope);
    state.used.add(key);
    if (!state.armed) return;
    const { pending } = state;
    const existing = pending.get(key);
    if (existing && existing.names.size === 0) return existing.task;
    const names = existing ? [...existing.names] : undefined;
    const entry: Pending = { workspaceId: scope.workspaceId, names: new Set(), task: Promise.resolve() };
    // A changed connector must not race an already accepted initialization.
    entry.task = (existing ? existing.task.catch(() => undefined) : Promise.resolve())
      .then(() => initialize(names)).catch((error: unknown) => {
        if (pending.get(key) === entry) pending.delete(key);
        throw error;
      });
    pending.set(key, entry);
    return entry.task;
  });
}
