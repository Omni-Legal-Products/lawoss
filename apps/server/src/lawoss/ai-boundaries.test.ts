import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { AI_BOUNDARIES_FIRM_ENV, readAiBoundaries, writeAiBoundaries } from "./ai-boundaries.js";
import { createGovernedEngineFetch, requireGovernedEngineDispatch, requireUnsupportedProtectedTransport } from "./ai-governance-engine.js";
import { syntheticHostConfig } from "./test-support/host-config.js";

const roots: string[] = [];
const firmEnv = process.env[AI_BOUNDARIES_FIRM_ENV];
afterEach(async () => {
  if (firmEnv === undefined) delete process.env[AI_BOUNDARIES_FIRM_ENV]; else process.env[AI_BOUNDARIES_FIRM_ENV] = firmEnv;
  for (const root of roots.splice(0)) await rm(root, {recursive: true});
});
async function fixture() {
  const {root, config} = await syntheticHostConfig(); roots.push(root);
  return config;
}

test("alpha default leaves AI boundaries off and unlocked", async () => {
  delete process.env[AI_BOUNDARIES_FIRM_ENV];
  expect(await readAiBoundaries(await fixture())).toEqual({enforced: false, locked: false, source: "default"});
});

test("the user setting turns boundaries on and off at request time", async () => {
  delete process.env[AI_BOUNDARIES_FIRM_ENV];
  const config = await fixture();
  expect(await writeAiBoundaries(config, true)).toEqual({enforced: true, locked: false, source: "user"});
  expect(await readAiBoundaries(config)).toEqual({enforced: true, locked: false, source: "user"});
  await expect(requireUnsupportedProtectedTransport(config, "chat", "fixture")).rejects.toMatchObject({status: 403, code: "ai_transfer_denied"});
  expect(await writeAiBoundaries(config, false)).toEqual({enforced: false, locked: false, source: "user"});
  await expect(requireUnsupportedProtectedTransport(config, "chat", "fixture")).resolves.toBeUndefined();
});

test("a firm lock forces boundaries on and the user cannot switch them off", async () => {
  const config = await fixture();
  await writeAiBoundaries(config, false);
  process.env[AI_BOUNDARIES_FIRM_ENV] = "1";
  expect(await readAiBoundaries(config)).toEqual({enforced: true, locked: true, source: "firm"});
  await expect(writeAiBoundaries(config, false)).rejects.toMatchObject({status: 409, code: "ai_boundaries_locked"});
  await expect(requireGovernedEngineDispatch(config, "fixture", "POST", "/session/s/prompt_async")).rejects.toMatchObject({status: 403, code: "ai_transfer_denied"});
  // Only an explicit enabling value locks; anything else cannot unlock or force off.
  process.env[AI_BOUNDARIES_FIRM_ENV] = "0";
  expect(await readAiBoundaries(config)).toEqual({enforced: false, locked: false, source: "user"});
});

test("off: engine dispatch guard admits every chat operation; on: each is refused", async () => {
  delete process.env[AI_BOUNDARIES_FIRM_ENV];
  const config = await fixture();
  const paths = ["/session/s/message", "/session/s/prompt_async", "/session/s/prompt", "/session/s/command", "/session/s/shell", "/session/s/summarize", "/session/s/compact", "/session/s/init", "/tui/submit-prompt"];
  for (const path of paths) await expect(requireGovernedEngineDispatch(config, "fixture", "POST", path)).resolves.toBeUndefined();
  await writeAiBoundaries(config, true);
  for (const path of paths) await expect(requireGovernedEngineDispatch(config, "fixture", "POST", path)).rejects.toMatchObject({status: 403, code: "ai_transfer_denied"});
});

test("off: the mounted SDK transport delivers the prompt to the engine receiver", async () => {
  delete process.env[AI_BOUNDARIES_FIRM_ENV];
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
