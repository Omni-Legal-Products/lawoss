import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { AI_BOUNDARIES_DENIAL_SOURCE } from "@legalwork/types/ai-governance";
import { writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import { openSqlite, runtimeDbPath } from "../runtime-db.js";
import { AI_BOUNDARIES_DEVICE_ENV, GLOBAL_AI_GUIDANCE_ID, preservedAiBoundaries, readAiBoundaries, writeAiBoundaries } from "./ai-boundaries.js";
import { createGovernedEngineFetch, requireGovernedEngineDispatch, requireAiBoundariesAdmission } from "./ai-governance-engine.js";
import { syntheticHostConfig } from "./test-support/host-config.js";

const roots: string[] = [];
const deviceEnv = process.env[AI_BOUNDARIES_DEVICE_ENV];
afterEach(async () => {
  if (deviceEnv === undefined) delete process.env[AI_BOUNDARIES_DEVICE_ENV]; else process.env[AI_BOUNDARIES_DEVICE_ENV] = deviceEnv;
  for (const root of roots.splice(0)) await rm(root, {recursive: true});
});
async function fixture() {
  const {root, config} = await syntheticHostConfig(); roots.push(root);
  return config;
}

test("alpha default leaves AI boundaries off and unlocked", async () => {
  delete process.env[AI_BOUNDARIES_DEVICE_ENV];
  expect(await readAiBoundaries(await fixture())).toEqual({enforced: false, locked: false, source: "default"});
});

test("the user setting turns boundaries on and off at request time", async () => {
  delete process.env[AI_BOUNDARIES_DEVICE_ENV];
  const config = await fixture();
  expect(await writeAiBoundaries(config, true)).toEqual({enforced: true, locked: false, source: "user"});
  expect(await readAiBoundaries(config)).toEqual({enforced: true, locked: false, source: "user"});
  await expect(requireAiBoundariesAdmission(config, "chat", "fixture")).rejects.toMatchObject({status: 403, code: "ai_transfer_denied", details: {source: AI_BOUNDARIES_DENIAL_SOURCE}});
  expect(await writeAiBoundaries(config, false)).toEqual({enforced: false, locked: false, source: "user"});
  await expect(requireAiBoundariesAdmission(config, "chat", "fixture")).resolves.toBeUndefined();
});

test("a lock from this computer forces boundaries on and the user cannot switch them off", async () => {
  const config = await fixture();
  await writeAiBoundaries(config, false);
  process.env[AI_BOUNDARIES_DEVICE_ENV] = "1";
  expect(await readAiBoundaries(config)).toEqual({enforced: true, locked: true, source: "device"});
  await expect(writeAiBoundaries(config, false)).rejects.toMatchObject({status: 409, code: "ai_boundaries_locked"});
  await expect(requireGovernedEngineDispatch(config, "fixture", "POST", "/session/s/prompt_async")).rejects.toMatchObject({status: 403, code: "ai_transfer_denied"});
  // Only an explicit enabling value locks; anything else cannot unlock or force off.
  process.env[AI_BOUNDARIES_DEVICE_ENV] = "0";
  expect(await readAiBoundaries(config)).toEqual({enforced: false, locked: false, source: "user"});
});

test("off: engine dispatch guard admits every chat operation; on: each is refused", async () => {
  delete process.env[AI_BOUNDARIES_DEVICE_ENV];
  const config = await fixture();
  const paths = ["/session/s/message", "/session/s/prompt_async", "/session/s/prompt", "/session/s/command", "/session/s/shell", "/session/s/summarize", "/session/s/compact", "/session/s/init", "/tui/submit-prompt"];
  for (const path of paths) await expect(requireGovernedEngineDispatch(config, "fixture", "POST", path)).resolves.toBeUndefined();
  await writeAiBoundaries(config, true);
  for (const path of paths) await expect(requireGovernedEngineDispatch(config, "fixture", "POST", path)).rejects.toMatchObject({status: 403, code: "ai_transfer_denied"});
});

test("off: the mounted SDK transport delivers the prompt to the engine receiver", async () => {
  delete process.env[AI_BOUNDARIES_DEVICE_ENV];
  const config = await fixture();
  const received: string[] = [];
  const receiver = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {received.push(await request.text()); return Response.json({ok: true});}});
  try {
    const guarded = createGovernedEngineFetch(config, "fixture");
    const response = await guarded(new Request(`${receiver.url.origin}/session/fixture/prompt_async`, {method: "POST", body: "SYNTHETIC-CHAT"}));
    expect(response.status).toBe(200);
    expect(received).toEqual(["SYNTHETIC-CHAT"]);
    await writeAiBoundaries(config, true);
    await expect(guarded(new Request(`${receiver.url.origin}/session/fixture/prompt_async`, {method: "POST", body: "SYNTHETIC-CHAT-2"})))
      .rejects.toMatchObject({status: 403, code: "ai_transfer_denied"});
    expect(received).toEqual(["SYNTHETIC-CHAT"]);
  } finally {receiver.stop(true);}
});

test("a damaged stored value fails closed until it is saved again", async () => {
  delete process.env[AI_BOUNDARIES_DEVICE_ENV];
  const config = await fixture();
  await writeRuntimeOpencodeConfig(config, GLOBAL_AI_GUIDANCE_ID, current => ({...current, aiBoundaries: {enforced: true}}));
  const db = await openSqlite(runtimeDbPath(config));
  try {
    for (const damaged of ['{"aiBoundaries":{"enforced":"no"}}', '{"aiBoundaries":false}', '[]', '{not json']) {
      db.run("UPDATE runtime_opencode_configs SET config_json = ? WHERE workspace_id = ?", [damaged, GLOBAL_AI_GUIDANCE_ID]);
      expect(await readAiBoundaries(config)).toEqual({enforced: true, locked: false, source: "invalid"});
      await expect(requireGovernedEngineDispatch(config, "fixture", "POST", "/session/s/prompt_async")).rejects.toMatchObject({status: 403, code: "ai_transfer_denied"});
      // Another writer of the shared row (the guidance acknowledgment) keeps it damaged, not off.
      expect(await preservedAiBoundaries(config)).toEqual({aiBoundaries: {invalid: true}});
    }
  } finally {db.close();}
  expect(await writeAiBoundaries(config, false)).toEqual({enforced: false, locked: false, source: "user"});
});
