import { afterEach, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { startServer } from "../server.js";
import { NATIVE_CONFIG_TABLE } from "../native-config-state.js";
import { openSqlite, runtimeDbPath } from "../runtime-db.js";
import { readRuntimeConfigUpgradeBackups, readRuntimeOpencodeConfig, runtimeConfigUpgradeNotices, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import { syntheticHostConfig } from "./test-support/host-config.js";

const saved = {LEGALWORK_TOKEN_STORE: process.env.LEGALWORK_TOKEN_STORE, LEGALWORK_RUNTIME_DB: process.env.LEGALWORK_RUNTIME_DB};
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  try {for (const cleanup of cleanups.splice(0).reverse()) await cleanup();}
  finally {for (const [key, value] of Object.entries(saved)) {if (value === undefined) delete process.env[key]; else process.env[key] = value;}}
});

const DAMAGED = "{poškodené";

async function fixture() {
  const {root, config} = await syntheticHostConfig();
  cleanups.push(() => rm(root, {recursive: true}));
  process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json");
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  for (const id of ["javor", "buk"]) {
    const path = join(root, id); await mkdir(path);
    config.workspaces.push({id, name: id, path, workspaceType: "local", preset: "starter", baseUrl: "http://127.0.0.1:9"});
    await writeRuntimeOpencodeConfig(config, id, () => ({permissions: [{action: "bash", resource: "*", effect: "ask"}]}));
  }
  const db = await openSqlite(runtimeDbPath(config));
  try {db.run(`UPDATE ${NATIVE_CONFIG_TABLE} SET config_json = ? WHERE workspace_id = ?`, [DAMAGED, "javor"]);}
  finally {db.close();}
  const server = await startServer(config);
  cleanups.push(() => server.stop());
  const base = `http://127.0.0.1:${server.port}`;
  return {config, base, client: {authorization: `Bearer ${config.token}`, "content-type": "application/json"},
    host: {"x-legalwork-host-token": config.hostToken, "content-type": "application/json"}};
}

test("the client's project details say when its saved settings cannot be read (#554)", async () => {
  const {base, client} = await fixture();
  const damaged = await fetch(`${base}/workspace/javor/project`, {headers: client});
  expect(damaged.status).toBe(200);
  expect(await damaged.json()).toMatchObject({version: 1, lawossClientSettingsUnreadable: true});
  const healthy = await fetch(`${base}/workspace/buk/project`, {headers: client}).then(response => response.json());
  expect(healthy).toMatchObject({version: 1});
  expect(healthy).not.toHaveProperty("lawossClientSettingsUnreadable");
});

test("only a confirmed host repair replaces the damaged client row with defaults and keeps the original (#554)", async () => {
  const {config, base, client, host} = await fixture();
  const repair = (headers: Record<string, string>, body: unknown, id = "javor") =>
    fetch(`${base}/workspace/${id}/lawoss/client-settings/repair`, {method: "POST", headers, body: JSON.stringify(body)});
  expect((await repair(client, {confirmed: true})).status).toBe(401);
  expect((await repair(host, {})).status).toBe(400);
  await expect(readRuntimeOpencodeConfig(config, "javor")).rejects.toMatchObject({status: 409, code: "execution_settings_invalid"});
  const healthyRefused = await repair(host, {confirmed: true}, "buk");
  expect(healthyRefused.status).toBe(409);
  expect(await healthyRefused.json()).toMatchObject({code: "client_settings_not_damaged"});

  expect((await repair(host, {confirmed: true})).status).toBe(200);
  expect((await readRuntimeOpencodeConfig(config, "javor")).permissions ?? []).toEqual([]);
  expect((await readRuntimeConfigUpgradeBackups(config, "javor")).map(backup => backup.configJson)).toContain(DAMAGED);
  expect(await runtimeConfigUpgradeNotices(config, "javor")).toContainEqual({code: "client_settings_repaired", fields: ["configuration"]});
  expect((await readRuntimeOpencodeConfig(config, "buk")).permissions).toEqual([{action: "bash", resource: "*", effect: "ask"}]);
  expect(await fetch(`${base}/workspace/javor/project`, {headers: client}).then(response => response.json())).not.toHaveProperty("lawossClientSettingsUnreadable");
  expect((await repair(host, {confirmed: true})).status).toBe(409);
});
