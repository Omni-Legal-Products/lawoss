import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";

test("#477: POST /engine/restart asks the supervisor for an immediate attempt and reports the engine status", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-engine-restart-route-")));
  const project = join(root, "project"); await mkdir(project);
  const previousTokens = process.env.LEGALWORK_TOKEN_STORE, previousDb = process.env.LEGALWORK_RUNTIME_DB;
  process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json");
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  let requests = 0;
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(root, "server.json"), token: "synthetic-owner", hostToken: "synthetic-host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [{ id: "matter", name: "Matter", path: project, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [project], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
    engineProjectTrustRequired: true, managedEngineStatus: "error",
    retryManagedEngineRestart: () => {
      requests++;
      if (config.managedEngineStatus !== "error") return false;
      config.managedEngineStatus = "starting";
      return true;
    },
  };
  const server = await startServer(config);
  const restart = (token?: string) => fetch(`http://127.0.0.1:${server.port}/engine/restart`, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {} });
  try {
    expect((await restart()).status).toBe(401);
    expect(requests).toBe(0);
    const accepted = await restart(config.token);
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("cache-control")).toBe("no-store");
    expect(await accepted.json()).toEqual({ restarting: true, engine: { status: "starting" } });
    expect(await (await restart(config.token)).json()).toEqual({ restarting: false, engine: { status: "starting" } });
    config.readOnly = true;
    expect((await restart(config.token)).status).toBe(403);
    expect(requests).toBe(2);
  } finally {
    await server.stop();
    if (previousTokens === undefined) delete process.env.LEGALWORK_TOKEN_STORE; else process.env.LEGALWORK_TOKEN_STORE = previousTokens;
    if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    await rm(root, { recursive: true, force: true });
  }
});
