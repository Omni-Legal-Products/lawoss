import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { AI_BOUNDARIES_DENIAL_SOURCE } from "@legalwork/types/ai-governance";
import { writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import { openSqlite, runtimeDbPath } from "../runtime-db.js";
import { NATIVE_CONFIG_TABLE } from "../native-config-state.js";
import { AI_BOUNDARIES_DEVICE_ENV, GLOBAL_AI_GUIDANCE_ID, preservedAiBoundaries, readAiBoundaries, repairAiBoundaries, writeAiBoundaries } from "./ai-boundaries.js";
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
  const paths = ["/session/s/message", "/session/s/prompt_async", "/session/s/prompt", "/session/s/command", "/session/s/shell", "/session/s/summarize", "/session/s/compact", "/session/s/init", "/tui/submit-prompt",
    // Installed engine v2: execution, generation and continuation routes.
    ...["prompt", "command", "shell", "synthetic", "compact", "generate", "background", "permission/per_1/reply", "form/frm_1/reply", "interrupt?resume=true"].map(end => `/api/session/s/${end}`),
    "/api/experimental/session/s/skill", "/api/experimental/generate", "/api/experimental/voice/session", "/api/websearch", "/api/rpc/legalwork.legalmemory/reply",
    "/workspace/w/opencode/api/session/s/prompt", "/api/session/s%2Fprompt"];
  const patches = ["/api/session/s/inbox/inb_1"];
  const passive = [["POST", "/api/session"], ["POST", "/api/session/s/interrupt"], ["POST", "/api/session/s/fork"], ["PATCH", "/api/session/s"], ["POST", "/api/session/s/permission"],
    ["POST", "/api/rpc/legalwork.managed-settings/refresh"], ["GET", "/api/session/s/message"], ["DELETE", "/api/session/s/inbox/inb_1"]] as const;
  for (const path of paths) await expect(requireGovernedEngineDispatch(config, "fixture", "POST", path)).resolves.toBeUndefined();
  await writeAiBoundaries(config, true);
  for (const path of paths) await expect(requireGovernedEngineDispatch(config, "fixture", "POST", path)).rejects.toMatchObject({status: 403, code: "ai_transfer_denied"});
  for (const path of patches) await expect(requireGovernedEngineDispatch(config, "fixture", "PATCH", path)).rejects.toMatchObject({status: 403, code: "ai_transfer_denied"});
  for (const [method, path] of passive) await expect(requireGovernedEngineDispatch(config, "fixture", method, path)).resolves.toBeUndefined();
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

test("a damaged stored value fails closed until it is saved again or its profile is repaired", async () => {
  delete process.env[AI_BOUNDARIES_DEVICE_ENV];
  const config = await fixture();
  await writeRuntimeOpencodeConfig(config, GLOBAL_AI_GUIDANCE_ID, current => ({...current, aiBoundaries: {enforced: true}}));
  const db = await openSqlite(runtimeDbPath(config));
  // Engine v2 stores the row in the native configuration state of runtime.sqlite.
  const damage = (value: string) => db.run(`UPDATE ${NATIVE_CONFIG_TABLE} SET config_json = ? WHERE workspace_id = ?`, [value, GLOBAL_AI_GUIDANCE_ID]);
  const failsClosed = async () => {
    expect(await readAiBoundaries(config)).toEqual({enforced: true, locked: false, source: "invalid"});
    await expect(requireGovernedEngineDispatch(config, "fixture", "POST", "/session/s/prompt_async")).rejects.toMatchObject({status: 403, code: "ai_transfer_denied"});
    // Another writer of the shared row (the guidance acknowledgment) keeps it damaged, not off.
    expect(await preservedAiBoundaries(config)).toEqual({aiBoundaries: {invalid: true}});
  };
  try {
    // A damaged value in a readable v2 row: saving the setting again repairs it.
    for (const value of [{enforced: "no"}, false, {enforced: true, extra: 1}]) {
      damage(JSON.stringify({configurationVersion: 2, aiBoundaries: value}));
      await failsClosed();
      expect(await writeAiBoundaries(config, true)).toEqual({enforced: true, locked: false, source: "user"});
    }
    // An unreadable row is never replaced by an ordinary save (that could reset other
    // saved settings); boundaries stay enforced until the profile is repaired.
    for (const damaged of ['{"aiBoundaries":{"enforced":"no"}}', '[]', '{not json']) {
      damage(damaged);
      await failsClosed();
      await expect(writeAiBoundaries(config, false)).rejects.toMatchObject({status: 409, code: "execution_settings_invalid"});
      await failsClosed();
    }
    damage(JSON.stringify({configurationVersion: 2}));
  } finally {db.close();}
  expect(await writeAiBoundaries(config, false)).toEqual({enforced: false, locked: false, source: "user"});
});

test("a damaged AI boundaries row is repaired only after confirmation, to enforced boundaries, keeping the original as a backup", async () => {
  delete process.env[AI_BOUNDARIES_DEVICE_ENV];
  const {readAiGovernanceView} = await import("./ai-governance-routes.js");
  const {readRuntimeConfigUpgradeBackups, runtimeConfigUpgradeNotices} = await import("../runtime-opencode-config-store.js");
  const config = await fixture();
  await expect(repairAiBoundaries(config)).rejects.toMatchObject({status: 409, code: "ai_boundaries_not_damaged"});
  await writeRuntimeOpencodeConfig(config, GLOBAL_AI_GUIDANCE_ID, current => ({...current, aiBoundaries: {enforced: false}}));
  await expect(repairAiBoundaries(config)).rejects.toMatchObject({status: 409, code: "ai_boundaries_not_damaged"});
  const db = await openSqlite(runtimeDbPath(config));
  const damage = (value: string) => db.run(`UPDATE ${NATIVE_CONFIG_TABLE} SET config_json = ? WHERE workspace_id = ?`, [value, GLOBAL_AI_GUIDANCE_ID]);
  try {
    // A readable row with a damaged value: the repair sets „on", never „off".
    damage(JSON.stringify({configurationVersion: 2, aiBoundaries: {enforced: "no"}, guidanceAck: {textVersion: "x"}}));
    expect(await repairAiBoundaries(config)).toEqual({enforced: true, locked: false, source: "user"});
    for (const damaged of ['{not json', '[]', '{"aiBoundaries":{"enforced":false}}']) {
      damage(damaged);
      // The settings view still loads and shows the damage instead of failing as a whole.
      expect((await readAiGovernanceView(config)).boundaries).toEqual({enforced: true, locked: false, source: "invalid"});
      await expect(requireGovernedEngineDispatch(config, "fixture", "POST", "/session/s/prompt_async")).rejects.toMatchObject({code: "ai_transfer_denied"});
      expect(await repairAiBoundaries(config)).toEqual({enforced: true, locked: false, source: "user"});
      expect((await readRuntimeConfigUpgradeBackups(config, GLOBAL_AI_GUIDANCE_ID)).map(backup => backup.configJson)).toContain(damaged);
      // After the repair the ordinary switch works again.
      expect(await writeAiBoundaries(config, false)).toEqual({enforced: false, locked: false, source: "user"});
    }
    expect(await runtimeConfigUpgradeNotices(config, GLOBAL_AI_GUIDANCE_ID)).toContainEqual({code: "ai_boundaries_repaired", fields: ["aiBoundaries"]});
  } finally {db.close();}
});
