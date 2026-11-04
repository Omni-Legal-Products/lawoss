import type { ServerConfig } from "../types.js";
import { runtimeDbResource, withRuntimeDb } from "../runtime-db-lifecycle.js";

type EngineScope = { workspaceId: string; directory: string; baseUrl: string; authHeader: string | null };
const resourceKey = Symbol("deferred-mcp-startup");

function startupState(config: ServerConfig) {
  return runtimeDbResource(config, resourceKey, async () => {
    const pending = new Map<string, Promise<void>>();
    return { armed: false, pending, close: () => pending.clear() };
  });
}

export function deferMcpStartup(config: ServerConfig): Promise<void> {
  return withRuntimeDb(config, async () => { (await startupState(config)).armed = true; });
}

export function startDeferredMcp(config: ServerConfig, scope: EngineScope, initialize: () => Promise<void>): Promise<void> {
  return withRuntimeDb(config, async () => {
    const state = await startupState(config);
    if (!state.armed) return;
    const { pending } = state;
    const key = JSON.stringify([scope.workspaceId, scope.directory, scope.baseUrl, scope.authHeader]);
    const existing = pending.get(key);
    if (existing) return existing;
    const task: Promise<void> = Promise.resolve().then(initialize).catch((error: unknown) => {
      if (pending.get(key) === task) pending.delete(key);
      throw error;
    });
    pending.set(key, task);
    return task;
  });
}
