import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { startServer } from "../server.js";
import { syntheticHostConfig } from "./test-support/host-config.js";

const saved = {LEGALWORK_TOKEN_STORE: process.env.LEGALWORK_TOKEN_STORE, LEGALWORK_RUNTIME_DB: process.env.LEGALWORK_RUNTIME_DB};
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  try {for (const cleanup of cleanups.splice(0).reverse()) await cleanup();}
  finally {for (const [key, value] of Object.entries(saved)) {if (value === undefined) delete process.env[key]; else process.env[key] = value;}}
});

test("native Settings read and change YOLO Mode; only the host may write a strict boolean", async () => {
  const {root, config} = await syntheticHostConfig();
  cleanups.push(() => rm(root, {recursive: true}));
  process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json");
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const server = await startServer(config);
  cleanups.push(() => server.stop());
  const base = `http://127.0.0.1:${server.port}`;
  const host = {"x-legalwork-host-token": config.hostToken, "content-type": "application/json"};
  const client = {authorization: `Bearer ${config.token}`, "content-type": "application/json"};
  const set = (headers: Record<string, string>, enabled: unknown) => fetch(`${base}/lawoss/yolo`, {method: "PUT", headers, body: JSON.stringify({enabled})});

  expect(await fetch(`${base}/lawoss/yolo`, {headers: client}).then(response => response.json())).toEqual({enabled: false, locked: false, source: "default"});
  expect((await set(client, true)).status).toBe(401);
  expect((await set(host, "yes")).status).toBe(400);
  const on = await set(host, true);
  expect(on.status).toBe(200);
  expect(await on.json()).toEqual({enabled: true, locked: false, source: "user"});
  expect(await fetch(`${base}/lawoss/yolo`, {headers: client}).then(response => response.json())).toEqual({enabled: true, locked: false, source: "user"});
  expect(await (await set(host, false)).json()).toEqual({enabled: false, locked: false, source: "default"});
});
