import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

// Exercise the native file surface used by loadProfilePreview, not a permissive mock.
test("native file API reads only the named OKF configuration and retains authorization", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-config-read-"));
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "test-okf-config-client", hostToken: "test-okf-config-host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Workspace", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root], readOnly: true, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  // The test runtime is Bun; startServer also exposes a Node return type.
  const server = await startServer(config) as { port: number; stop(closeActiveConnections?: boolean): void | Promise<void> };
  try {
    await mkdir(join(root, "Office"));
    const content = "matter_folders:\n  - Drafty\n";
    await writeFile(join(root, "Office", "okf.config"), content);
    await writeFile(join(root, "Office", "unrelated.config"), "private configuration");
    const base = `http://127.0.0.1:${server.port}/workspace/ws_1/files/content?path=`;
    const headers = { Authorization: `Bearer ${config.token}` };
    const response = await fetch(base + encodeURIComponent("Office/okf.config"), { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ path: "Office/okf.config", content });
    expect((await fetch(base + encodeURIComponent("Office/unrelated.config"), { headers })).status).toBe(400);
    expect((await fetch(base + encodeURIComponent("Office/okf.config"))).status).toBe(401);
    expect((await fetch(base + encodeURIComponent("../okf.config"), { headers })).status).toBe(400);
    const write = await fetch(`http://127.0.0.1:${server.port}/workspace/ws_1/files/content`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "Office/okf.config", content: "replacement" }),
    });
    expect(write.status).toBe(403);
  } finally {
    await server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});
