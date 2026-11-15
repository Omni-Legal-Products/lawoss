import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfiguredManagedEngine, startManagedEngineLifecycle } from "../managed-engine-lifecycle.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;

test.skipIf(!binary)("#454: a released engine killed after startup is restarted and its new endpoint is published", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-engine-restart-")));
  const project = join(root, "project"), home = join(root, "home");
  await Promise.all([project, home].map(directory => mkdir(directory)));
  const workspace: WorkspaceInfo = { id: "project", path: project, name: "Project", workspaceType: "local", preset: "starter" };
  const config: ServerConfig = { configPath: join(root, "private", "server.json"), host: "127.0.0.1", port: 0,
    token: "synthetic", hostToken: "synthetic-host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: [workspace], authorizedRoots: [project], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli",
    logFormat: "pretty", logRequests: false, engineProjectTrustRequired: true };
  const database = join(root, "engine.db"), service = { configDirectory: join(root, "config"), stateDirectory: join(root, "state") };
  const env = { HOME: home, USERPROFILE: home, OPENCODE_TEST_HOME: home, XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"),
    XDG_STATE_HOME: service.stateDirectory, OPENCODE_DB: database, OPENCODE_CONFIG_DIR: service.configDirectory, OPENCODE_CONFIG_PROJECT_DISABLE: "1",
    OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1" };
  const info = (url: string, password: string) => fetch(new URL("/api/info", url), { headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` } });
  const until = async (condition: () => boolean, label: string) => {
    const deadline = Date.now() + 60_000;
    while (!condition()) { if (Date.now() > deadline) throw new Error(`Timed out: ${label}`); await Bun.sleep(20); }
  };
  const lifecycle = await startManagedEngineLifecycle({ config, database, service, restart: { delaysMs: [100, 100], stableMs: 60_000 },
    create: (mode, beforeSpawn) => createConfiguredManagedEngine(config, { bin: binary, cwd: home, timeoutMs: 30_000, env, beforeSpawn,
      ...(mode === "service" ? { service } : { parentLease: true }) }) });
  try {
    const original = lifecycle.engine;
    if (!original.pid) throw new Error("An engine PID is required");
    expect((await info(original.url, original.password)).status).toBe(200);
    process.kill(original.pid, "SIGKILL");
    await until(() => config.managedEngineStatus !== "ready", "outage reported to /health");
    await until(() => lifecycle.engine !== original && config.managedEngineStatus === "ready" && config.opencodeBaseUrl === lifecycle.engine.url, "engine restarted");
    const restarted = lifecycle.engine;
    expect(restarted.running()).toBe(true);
    expect(restarted.pid).not.toBe(original.pid);
    expect(workspace.baseUrl).toBe(restarted.url);
    expect(workspace.opencodePassword).toBe(restarted.password);
    expect((await info(workspace.baseUrl!, workspace.opencodePassword!)).status).toBe(200);
    expect(config.managedEngineRecoveryState?.().mode).toBe("service");
  } finally {
    await lifecycle.close();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
