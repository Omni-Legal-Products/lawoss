import { test } from "node:test";
import os from "node:os";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

// Isolate incidental config discovery before importing the production server.
const root = await mkdtemp(join(os.tmpdir(), "proxy-node-home-"));
const originalHome = os.homedir;
os.homedir = () => root;
syncBuiltinESMExports();
const names = ["LEGALWORK_SERVER_CONFIG", "LEGALWORK_RUNTIME_DB", "LEGALWORK_DATA_DIR", "LEGALWORK_PROJECTS_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME"];
const previous = new Map(names.map(name => [name, process.env[name]]));
for (const name of names) delete process.env[name];
test("Node production engine proxy cancellation", async context => {
  try {
    const { startServer } = await import("../dist/server.js");
    const { serve } = await import("../dist/serve-node.js");
    const { proxyCancellationCases, verifyProxyCancellation, adapterCancellationCases, verifyAdapterCancellation } = await import("../dist/test-support/opencode-proxy-cancellation.js");
    for (const scenario of proxyCancellationCases) {
      await context.test(scenario, () => verifyProxyCancellation(startServer, scenario));
    }
    for (const scenario of adapterCancellationCases) {
      await context.test(`HTTP adapter: ${scenario}`, () => verifyAdapterCancellation(serve, scenario));
    }
  } finally {
    os.homedir = originalHome;
    syncBuiltinESMExports();
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(root, { recursive: true });
  }
});
