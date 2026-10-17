import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig } from "../../types.js";

/** All host storage belongs to the test; no user profile/provider is touched. */
export async function syntheticHostConfig(): Promise<{root: string; config: ServerConfig}> {
  const root = await mkdtemp(join(tmpdir(), "lawoss-host-decision-"));
  return {root, config: {host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture-host",
    configPath: join(root, "server.json"), approval: {mode: "auto", timeoutMs: 1000}, corsOrigins: [],
    workspaces: [], authorizedRoots: [root], readOnly: false, startedAt: Date.now(),
    tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false}};
}
