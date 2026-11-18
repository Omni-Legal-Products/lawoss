import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../server.js";
import { runtimeDbPath } from "../runtime-db-lifecycle.js";
import { writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { removeTestDir } from "./test-support/remove-test-dir.js";

const previous = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE, db: process.env.LEGALWORK_RUNTIME_DB };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const [key, value] of Object.entries({ LEGALWORK_DATA_DIR: previous.data, LEGALWORK_TOKEN_STORE: previous.tokens, LEGALWORK_RUNTIME_DB: previous.db })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

const CORRUPT = "{\"broken\": ";

async function fixture(damaged: string) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-unreadable-guard-")));
  cleanups.push(() => removeTestDir(base));
  const javor = join(base, "javor"), hron = join(base, "hron");
  await mkdir(javor); await mkdir(hron);
  process.env.LEGALWORK_DATA_DIR = join(base, "data");
  process.env.LEGALWORK_TOKEN_STORE = join(base, "tokens.json");
  process.env.LEGALWORK_RUNTIME_DB = join(base, "runtime.sqlite");
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(base, "server.json"), token: "client", hostToken: "host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: [{ id: "javor", name: "Javor", preset: "starter", path: javor, workspaceType: "local" }, { id: "hron", name: "Hron", preset: "starter", path: hron, workspaceType: "local" }],
    authorizedRoots: [javor, hron], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  for (const workspace of config.workspaces) {
    await writeRuntimeOpencodeConfig(config, workspace.id, () => ({ mcp: { servers: { [`crm_${workspace.id}`]: { type: "remote", url: "https://crm.example/mcp", disabled: true } } } }));
  }
  const db = new Database(runtimeDbPath(config));
  try { db.run("UPDATE native_runtime_configs SET config_json = ? WHERE workspace_id = ?", [CORRUPT, damaged]); } finally { db.close(); }
  const server = await startServer(config);
  cleanups.push(async () => { await server.stop(); });
  const storedRow = () => {
    const reader = new Database(runtimeDbPath(config), { readonly: true });
    try { return reader.query<{ config_json: string }, [string]>("SELECT config_json FROM native_runtime_configs WHERE workspace_id = ?").get(damaged)?.config_json; }
    finally { reader.close(); }
  };
  const get = (path: string) => fetch(`http://127.0.0.1:${server.port}${path}`, { headers: { authorization: "Bearer client" } });
  return { get, storedRow };
}

// 🟡 LAWOSS #542: strážca politiky firmy platí pre všetkých klientov; poškodený riadok jedného ho nesmie zastaviť.
for (const damaged of ["javor", "hron"]) {
  test(`the firm's guard answers while client ${damaged} has an unreadable saved row, and that client stays blocked`, async () => {
    const { get, storedRow } = await fixture(damaged);
    const guard = await get("/org-policy/guard");
    expect(guard.status).toBe(200);
    expect(await guard.json()).toMatchObject({ blockedMcpServers: [], permission: [] });
    expect(storedRow()).toBe(CORRUPT);
    const own = await get(`/workspace/${damaged}/config`);
    expect(own.status).toBe(409);
    expect(await own.json()).toMatchObject({ code: "execution_settings_invalid" });
  });
}
