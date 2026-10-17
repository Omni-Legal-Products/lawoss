import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import { TokenService } from "./tokens.js";
import type { ServerConfig } from "./types.js";

// 🟡 LAWOSS: online aktualizácia katalógu modelov (upstream #223/#230) je natrvalo vypnutá.
// Server nesprístupňuje relé katalógu a nastavenie ju nedovolí zapnúť; engine číta pribalený katalóg.
test("katalóg modelov sa nesťahuje: nastavenie je vypnuté a relé neexistuje", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-catalog-routes-"));
  const previousStore = process.env.LEGALWORK_TOKEN_STORE;
  process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json");
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "catalog-client-token", hostToken: "catalog-host-token",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [root],
    readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli",
    logFormat: "pretty", logRequests: false, configPath: join(root, "server.json"),
  };
  const server = await startServer(config);
  try {
    const baseURL = `http://127.0.0.1:${server.port}`;
    const headers = { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" };
    expect((await fetch(`${baseURL}/model-catalog/settings`)).status).toBe(401);
    expect(await (await fetch(`${baseURL}/model-catalog/settings`, { headers })).json()).toEqual({ onlineUpdatesEnabled: false });
    const viewer = await new TokenService(config).create("viewer");
    expect((await fetch(`${baseURL}/model-catalog/settings`, {
      method: "PUT", headers: { ...headers, Authorization: `Bearer ${viewer.token}` }, body: JSON.stringify({ onlineUpdatesEnabled: false }),
    })).status).toBe(403);
    expect((await fetch(`${baseURL}/model-catalog/settings`, { method: "PUT", headers, body: JSON.stringify({ onlineUpdatesEnabled: "false" }) })).status).toBe(400);
    expect((await fetch(`${baseURL}/model-catalog/settings`, { method: "PUT", headers, body: JSON.stringify({ onlineUpdatesEnabled: true }) })).status).toBe(409);
    const off = await fetch(`${baseURL}/model-catalog/settings`, { method: "PUT", headers, body: JSON.stringify({ onlineUpdatesEnabled: false }) });
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ onlineUpdatesEnabled: false });
    expect((await fetch(`${baseURL}/model-catalog/api.json`)).status).toBe(404);
  } finally {
    await server.stop();
    if (previousStore === undefined) delete process.env.LEGALWORK_TOKEN_STORE;
    else process.env.LEGALWORK_TOKEN_STORE = previousStore;
    await rm(root, { recursive: true, force: true });
  }
});
