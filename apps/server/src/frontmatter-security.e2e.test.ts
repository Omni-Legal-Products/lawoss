import { expect, test } from "bun:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTestDir } from "./lawoss/test-support/remove-test-dir.js";
import { startServer } from "./server.js";
import { TokenService } from "./tokens.js";
import type { ServerConfig } from "./types.js";

test("command and skill previews cannot execute frontmatter; viewer is refused; ordinary preview still works", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-frontmatter-security-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "synthetic-collaborator", hostToken: "synthetic-host",
    configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: [{ id: "workspace", name: "workspace", path: workspace, preset: "default", workspaceType: "local" }],
    authorizedRoots: [workspace], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "json", logRequests: false,
  };
  const keys = ["LEGALWORK_RUNTIME_DB", "LEGALWORK_TOKEN_STORE"];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json");
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const probe = globalThis as typeof globalThis & { lawossPreviewProbe?: boolean };
  try {
    const token = await new TokenService(config).create("viewer");
    server = await startServer(config);
    const preview = (payload: unknown, bearer = config.token) => fetch(`http://127.0.0.1:${server!.port}/workspace/workspace/import/preview`, {
      method: "POST", headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    // Preview reveals planned actions and fingerprints of existing config, so it requires collaborator.
    expect((await preview({ commands: [{ name: "synthetic", content: "Ordinary command" }] }, token.token)).status).toBe(403);
    for (const kind of ["commands", "skills"]) {
      delete probe.lawossPreviewProbe;
      const response = await preview({ [kind]: [{ name: "synthetic", description: "Synthetic only", content: "---js\n(globalThis.lawossPreviewProbe = true, {name:'synthetic', description:'Synthetic only'})\n---\nBody" }] });
      expect(response.status).toBe(400);
      expect(probe.lawossPreviewProbe).toBeUndefined();
    }
    const valid = await preview({ commands: [{ name: "synthetic", content: "---\nname: synthetic\ndescription: Synthetic only\n---\nOrdinary command" }] });
    expect(valid.status).toBe(200);
  } finally {
    delete probe.lawossPreviewProbe;
    await server?.stop();
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    // Windows: server drží runtime.sqlite otvorenú aj po stop(), rm skončí EBUSY.
    await removeTestDir(root);
  }
});
