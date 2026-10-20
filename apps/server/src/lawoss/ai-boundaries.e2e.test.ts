import { afterEach, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { startServer } from "../server.js";
import { AI_BOUNDARIES_DENIAL_SOURCE } from "@legalwork/types/ai-governance";
import { AI_BOUNDARIES_DEVICE_ENV } from "./ai-boundaries.js";
import { syntheticHostConfig } from "./test-support/host-config.js";

const saved = {LEGALWORK_TOKEN_STORE: process.env.LEGALWORK_TOKEN_STORE, LEGALWORK_RUNTIME_DB: process.env.LEGALWORK_RUNTIME_DB, [AI_BOUNDARIES_DEVICE_ENV]: process.env[AI_BOUNDARIES_DEVICE_ENV]};
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  try {for (const cleanup of cleanups.splice(0).reverse()) await cleanup();}
  finally {for (const [key, value] of Object.entries(saved)) {if (value === undefined) delete process.env[key]; else process.env[key] = value;}}
});

async function fixture(receiver?: {url: URL}) {
  const {root, config} = await syntheticHostConfig();
  cleanups.push(() => rm(root, {recursive: true}));
  process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json");
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  delete process.env[AI_BOUNDARIES_DEVICE_ENV];
  if (receiver) {
    const workspace = join(root, "matter"); await mkdir(workspace);
    config.workspaces.push({id: "fixture", name: "Synthetic", path: workspace, workspaceType: "local", preset: "starter", baseUrl: receiver.url.origin});
  }
  const server = await startServer(config);
  cleanups.push(() => server.stop());
  const base = `http://127.0.0.1:${server.port}`;
  const host = {"x-legalwork-host-token": config.hostToken, "content-type": "application/json"};
  const setEnforced = (enforced: unknown) => fetch(`${base}/lawoss/ai-governance/boundaries`, {method: "PUT", headers: host, body: JSON.stringify({enforced})});
  return {base, host, setEnforced, client: {authorization: `Bearer ${config.token}`, "content-type": "application/json"}};
}

test("native AI settings read and change the boundaries; only the host may write a strict boolean", async () => {
  const {base, host, setEnforced, client} = await fixture();
  expect((await fetch(`${base}/lawoss/ai-governance`, {headers: host}).then(response => response.json())).boundaries)
    .toEqual({enforced: false, locked: false, source: "default"});
  expect((await fetch(`${base}/lawoss/ai-governance/boundaries`, {method: "PUT", headers: client, body: JSON.stringify({enforced: true})})).status).toBe(401);
  expect((await setEnforced("yes")).status).toBe(400);
  const on = await setEnforced(true);
  expect(on.status).toBe(200);
  expect((await on.json()).boundaries).toEqual({enforced: true, locked: false, source: "user"});
  expect((await fetch(`${base}/lawoss/ai-governance`, {headers: host}).then(response => response.json())).boundaries)
    .toEqual({enforced: true, locked: false, source: "user"});
});

test("a lock from this computer shows as locked and refuses switching boundaries off", async () => {
  const {base, host, setEnforced} = await fixture();
  process.env[AI_BOUNDARIES_DEVICE_ENV] = "1";
  expect((await fetch(`${base}/lawoss/ai-governance`, {headers: host}).then(response => response.json())).boundaries)
    .toEqual({enforced: true, locked: true, source: "device"});
  const refused = await setEnforced(false);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({code: "ai_boundaries_locked"});
});

test("off: an ordinary chat prompt passes the engine proxy; on: it is refused before the receiver without a restart", async () => {
  const received: string[] = [];
  const receiver = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (request.method === "POST") received.push(await request.text());
    return Response.json({ok: true});
  }});
  cleanups.push(() => receiver.stop(true));
  const {base, client, setEnforced} = await fixture(receiver);
  const send = () => fetch(`${base}/workspace/fixture/opencode/session/fixture/prompt_async`, {method: "POST", headers: client,
    body: JSON.stringify({parts: [{type: "text", text: "SYNTHETIC-CHAT"}]})});
  const passed = await send();
  expect(passed.status).not.toBe(403);
  expect(received.some(body => body.includes("SYNTHETIC-CHAT"))).toBe(true);
  received.length = 0;
  expect((await setEnforced(true)).status).toBe(200);
  const refused = await send();
  expect(refused.status).toBe(403);
  // The renderer recognises this refusal by the shared typed marker, not by its English text.
  expect(await refused.json()).toMatchObject({code: "ai_transfer_denied", details: {source: AI_BOUNDARIES_DENIAL_SOURCE}});
  expect(received).toEqual([]);
});

test("voice capability follows the switch", async () => {
  const {base, host, setEnforced} = await fixture();
  const capability = () => fetch(`${base}/voice/realtime/capability`, {headers: host}).then(response => response.json());
  expect((await capability()).reason).not.toBe("unsupported-transport");
  await setEnforced(true);
  expect(await capability()).toEqual({supported: false, providerId: null, model: null, reason: "unsupported-transport"});
  const voice = await fetch(`${base}/voice/realtime/call`, {method: "POST", headers: host, body: JSON.stringify({sdp: "SYNTHETIC-VOICE"})});
  expect(voice.status).toBe(403);
});
