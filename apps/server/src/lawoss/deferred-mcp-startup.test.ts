import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "../types.js";
import { acquireRuntimeDbLifetime } from "../runtime-db-lifecycle.js";
import { deferLocalMcpUpdates, deferMcpStartup, startDeferredMcp } from "./deferred-mcp-startup.js";

test("deferred startup coalesces scope, retries failure and retains accepted work until owner release", async () => {
  const root = await mkdtemp(join(tmpdir(), "deferred-mcp-"));
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "synthetic", hostToken: "synthetic-host",
    configPath: join(root, "server.json"), approval: { mode: "manual", timeoutMs: 1000 },
    corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false,
    startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const owner = acquireRuntimeDbLifetime(config);
  const scope = { workspaceId: "a", directory: root, baseUrl: "http://localhost:1", authHeader: null };
  let calls = 0;
  const initialize = async () => { calls++; };
  try {
    await startDeferredMcp(config, scope, initialize);
    expect(calls).toBe(0);
    await deferMcpStartup(config);
    await Promise.all([startDeferredMcp(config, scope, initialize), startDeferredMcp(config, scope, initialize)]);
    expect(calls).toBe(1);
    await startDeferredMcp(config, { ...scope, authHeader: "Basic synthetic" }, initialize);
    await startDeferredMcp(config, { ...scope, directory: join(root, "b") }, initialize);
    expect(calls).toBe(3);
    const failed = { ...scope, workspaceId: "failed" };
    await expect(startDeferredMcp(config, failed, async () => { throw new Error("synthetic failure"); })).rejects.toThrow("synthetic failure");
    await startDeferredMcp(config, failed, initialize);
    expect(calls).toBe(4);
    await deferLocalMcpUpdates(config, [scope.workspaceId], ["changed-local"]);
    expect(calls).toBe(4);
    await Promise.all([1, 2].map(() => startDeferredMcp(config, scope, async (names) => {
      expect(names).toEqual(["changed-local"]);
      calls++;
    })));
    expect(calls).toBe(5);
    let unblock!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { unblock = resolve; });
    const pending = startDeferredMcp(config, { ...scope, workspaceId: "pending" }, async () => { entered(); await gate; });
    await ready;
    await deferLocalMcpUpdates(config, ["pending"], ["later-local"]);
    let refreshed = false;
    const refresh = startDeferredMcp(config, { ...scope, workspaceId: "pending" }, async (names) => {
      expect(names).toEqual(["later-local"]);
      refreshed = true;
    });
    await Promise.resolve();
    expect(refreshed).toBe(false);
    let released = false;
    const releasing = owner.release().then(() => { released = true; });
    await Promise.resolve();
    expect(released).toBe(false);
    unblock();
    await Promise.all([pending, refresh]);
    expect(refreshed).toBe(true);
    await releasing;
    expect(released).toBe(true);
  } finally {
    await owner.release();
    await rm(root, { recursive: true, force: true });
  }
});
