import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import { GLOBAL_PROVIDERS_ID, readRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";
import { removeTestDir } from "./lawoss/test-support/remove-test-dir.js";

const previous = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE, db: process.env.LEGALWORK_RUNTIME_DB };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const [key, value] of Object.entries({ LEGALWORK_DATA_DIR: previous.data, LEGALWORK_TOKEN_STORE: previous.tokens, LEGALWORK_RUNTIME_DB: previous.db })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-global-providers-")));
  cleanups.push(() => removeTestDir(base));
  const office = join(base, "office");
  await mkdir(office, { recursive: true });
  process.env.LEGALWORK_DATA_DIR = join(base, "data");
  process.env.LEGALWORK_TOKEN_STORE = join(base, "tokens.json");
  process.env.LEGALWORK_RUNTIME_DB = join(base, "runtime.sqlite");
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(base, "server.json"), token: "client", hostToken: "host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [{ id: "office", name: "Office", preset: "starter", path: office, workspaceType: "local" }], authorizedRoots: [office], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const server = await startServer(config);
  cleanups.push(async () => { await server.stop(); });
  const baseUrl = `http://127.0.0.1:${server.port}`;
  const ws = config.workspaces[0]!;
  const patchConfig = async (id: string, body: unknown) => {
    const response = await fetch(`${baseUrl}/workspace/${id}/config`, { method: "PATCH", headers: { authorization: "Bearer client", "content-type": "application/json" }, body: JSON.stringify(body) });
    expect(response.ok).toBe(true);
    return response;
  };
  return { config, ws, baseUrl, patchConfig };
}

const ollama = { npm: "@ai-sdk/openai-compatible", name: "Ollama", options: { baseURL: "http://localhost:11434/v1" } };

test("PATCH provider zapíše do globálneho riadku; null odstráni z globálneho aj zo starého riadku priečinka", async () => {
  const { config, ws, patchConfig } = await fixture();
  await patchConfig(ws.id, { opencode: { provider: { ollama } } });
  expect((await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).provider).toEqual({ ollama });
  expect((await readRuntimeOpencodeConfig(config, ws.id)).provider ?? {}).toEqual({});
  await writeRuntimeOpencodeConfig(config, ws.id, (current) => ({ ...current, provider: { ollama } })); // starý stav
  await patchConfig(ws.id, { opencode: { provider: { ollama: null } } });
  expect((await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).provider ?? {}).toEqual({});
  expect((await readRuntimeOpencodeConfig(config, ws.id)).provider ?? {}).toEqual({});
});

test("GET /workspace/:id/config vráti globálneho poskytovateľa aj pre priečinok bez vlastného riadku", async () => {
  const { baseUrl, ws, patchConfig } = await fixture();
  await patchConfig(ws.id, { opencode: { provider: { ollama } } });
  const response = await fetch(`${baseUrl}/workspace/${ws.id}/config`, { headers: { authorization: "Bearer client" } });
  expect(response.ok).toBe(true);
  const body: { opencode?: { provider?: Record<string, unknown> } } = await response.json();
  expect(body.opencode?.provider?.ollama).toEqual(ollama);
});

test("úprava staršieho poskytovateľa z riadku priečinka platí: globálny riadok má v2, priečinok ho už nemá", async () => {
  const { config, baseUrl, ws, patchConfig } = await fixture();
  const v1 = { ...ollama, name: "Ollama v1" }, v2 = { ...ollama, name: "Ollama v2" };
  await writeRuntimeOpencodeConfig(config, ws.id, (current) => ({ ...current, provider: { ollama: v1 } }));
  await patchConfig(ws.id, { opencode: { provider: { ollama: v2 } } });
  expect((await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).provider).toEqual({ ollama: v2 });
  expect((await readRuntimeOpencodeConfig(config, ws.id)).provider ?? {}).toEqual({});
  const response = await fetch(`${baseUrl}/workspace/${ws.id}/config`, { headers: { authorization: "Bearer client" } });
  const body: { opencode?: { provider?: Record<string, unknown> } } = await response.json();
  expect(body.opencode?.provider?.ollama).toEqual(v2);
});
