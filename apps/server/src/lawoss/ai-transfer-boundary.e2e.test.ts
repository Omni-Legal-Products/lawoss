import { AI_GUIDANCE_VERSION } from "@legalwork/types/ai-governance";
import { createGovernedEngineFetch } from "./ai-governance-engine.js";
import { expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startServer } from "../server.js";
import { openSqlite, runtimeDbPath } from "../runtime-db.js";
import { syntheticHostConfig } from "./test-support/host-config.js";
import { enforceAiBoundaries } from "./test-support/ai-boundaries.js";

// This proves host admission only. It does not claim engine-internal provider egress isolation.
test("with AI boundaries on, protected prompt/attachment/compaction/command are refused before the engine receiver; manual files remain available", async () => {
  const {root, config} = await syntheticHostConfig();
  const received: string[] = [];
  const receiver = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) { if (request.method === "GET") return Response.json({id: "fixture", directory: config.workspaces[0]?.path}); received.push(await request.text()); return Response.json({id: "synthetic"});}});
  const previous = {LEGALWORK_TOKEN_STORE: process.env.LEGALWORK_TOKEN_STORE, LEGALWORK_RUNTIME_DB: process.env.LEGALWORK_RUNTIME_DB};
  process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json");
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  let stop: (() => void | Promise<void>) | undefined;
  try {
    await fetch(receiver.url, {method: "POST", body: "PUBLIC-SYNTHETIC-PROBE"});
    expect(received).toEqual(["PUBLIC-SYNTHETIC-PROBE"]); received.length = 0;
    const workspace = join(root, "matter"); await mkdir(workspace); await writeFile(join(workspace, "manual.md"), "manual-path");
    config.workspaces.push({id: "fixture", name: "Synthetic", path: workspace, workspaceType: "local", preset: "starter", baseUrl: receiver.url.origin});
    const server = await startServer(config); stop = () => server.stop();
    await enforceAiBoundaries(config);
    const base = `http://127.0.0.1:${server.port}`;
    const headers = {authorization: `Bearer ${config.token}`, "content-type": "application/json"};
    for (const operation of ["message", "prompt_async", "prompt", "summarize", "compact", "command", "shell", "init", "%6dessage"]) {
      const response = await fetch(`${base}/workspace/fixture/opencode/session/fixture/${operation}`, {method: "POST", headers,
        body: JSON.stringify({parts: [{type: "text", text: "PROTECTED-CANARY"}, {type: "file", url: "data:text/plain;base64,UFJPVEVDVEVE"}]})});
      expect(response.status).toBe(403);
      expect(await response.text()).toContain("ai_transfer_denied");
    }
    for (const operation of ["prompt", "compact"]) {
      const response = await fetch(`${base}/workspace/fixture/opencode/api/session/fixture/${operation}`, {method: "POST", headers, body: JSON.stringify({prompt: [{type: "text", text: "PROTECTED-V2-PROXY-CANARY"}]})});
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({code: "ai_transfer_denied"});
    }
    const queued = await fetch(`${base}/workspace/fixture/sessions/fixture/queue`, {method: "POST", headers,
      body: JSON.stringify({type: "enqueue", id: "bb8f20ae-b86c-4c31-a84c-5d929a79982e",
        draft: {mode: "prompt", text: "PROTECTED-QUEUE-CANARY", parts: [], attachments: [], editor: {mentions: {}, pasteParts: []}},
        execution: {kind: "prompt", model: {providerID: "fixture", modelID: "fixture"}, parts: [{type: "text", text: "PROTECTED-QUEUE-CANARY"}]}})});
    expect(queued.status).toBe(403); expect(await queued.text()).toContain("ai_transfer_denied");
    expect(received).toEqual([]);
    const manual = await fetch(`${base}/workspace/fixture/files/content?path=manual.md`, {headers});
    expect(manual.status).toBe(200); expect(await manual.text()).toContain("manual-path");
  } finally {
    try {await stop?.(); receiver.stop(true);} finally {
      for (const [key, value] of Object.entries(previous)) {if (value === undefined) delete process.env[key]; else process.env[key] = value;}
      await rm(root, {recursive: true});
    }
  }
});

test("with AI boundaries on, a mounted SDK transport also rejects dispatch before a receiver gets content", async () => {
  const {root, config} = await syntheticHostConfig();
  const received: string[] = [];
  const receiver = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {received.push(await request.text()); return Response.json({ok: true});}});
  try {
    await fetch(receiver.url, {method: "POST", body: "PUBLIC-SYNTHETIC-PROBE"});
    expect(received).toEqual(["PUBLIC-SYNTHETIC-PROBE"]); received.length = 0;
    await enforceAiBoundaries(config);
    const guarded = createGovernedEngineFetch(config, "fixture");
    await expect(guarded(new Request(`${receiver.url.origin}/w/fixture/opencode/session/fixture/message`, {
      method: "POST", body: "PROTECTED-SDK-CANARY",
    }))).rejects.toMatchObject({status: 403, code: "ai_transfer_denied"});
    for (const path of ["/api/session/fixture/prompt", "/api/session/fixture/compact", "/api/session/fixture/permission/request/reply", "/api/session/fixture/question/request/reply", "/tui/submit-prompt", "/tui/execute-command", "/session/fixture/permissions/request", "/experimental/session/fixture/background", "/experimental/project/fixture/copy/generate-name"]) {
      await expect(guarded(new Request(receiver.url.origin + path, {method: "POST", body: "PROTECTED-V2-CANARY"}))).rejects.toMatchObject({status: 403, code: "ai_transfer_denied"});
    }
    expect(received).toEqual([]);
  } finally {receiver.stop(true); await rm(root, {recursive: true});}
});

test("acknowledgment cannot inject an actor or approve a provider", async () => {
  const {root, config} = await syntheticHostConfig();
  const previous = {LEGALWORK_TOKEN_STORE: process.env.LEGALWORK_TOKEN_STORE, LEGALWORK_RUNTIME_DB: process.env.LEGALWORK_RUNTIME_DB};
  process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json"); process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  let stop: (() => void | Promise<void>) | undefined;
  try {
    const server = await startServer(config); stop = () => server.stop();
    await enforceAiBoundaries(config);
    const base = `http://127.0.0.1:${server.port}`;
    const host = {"x-legalwork-host-token": config.hostToken, "content-type": "application/json"};
    const forged = await fetch(base + "/lawoss/ai-governance/acknowledge", {method: "POST", headers: host,
      body: JSON.stringify({textVersion: AI_GUIDANCE_VERSION, jurisdiction: "CZ", actorRef: "lawyer", approved: true})});
    expect(forged.status).toBe(400);
    const ack = await fetch(base + "/lawoss/ai-governance/acknowledge", {method: "POST", headers: host,
      body: JSON.stringify({textVersion: AI_GUIDANCE_VERSION, jurisdiction: "CZ"})});
    expect(ack.status).toBe(200);
    expect(await ack.json()).toMatchObject({protectedProcessing: "unsupported", guidanceAck: {actorRef: "native-host"}});
    expect((await fetch(base + "/lawoss/ai-governance/commit", {method: "POST", headers: host, body: JSON.stringify({approved: true})})).status).toBe(409);
    const voice = await fetch(base + "/voice/realtime/call", {method: "POST", headers: host, body: JSON.stringify({sdp: "SYNTHETIC-VOICE-CANARY"})});
    expect(voice.status).toBe(403);
    expect(await voice.text()).toContain("ai_transfer_denied");
    expect((await fetch(base + "/voice/realtime/capability", {headers: host}).then(response => response.json())).supported).toBe(false);
    expect((await fetch(base + "/lawoss/ai-governance/commit", {method: "POST", headers: {authorization: `Bearer ${config.token}`}})).status).toBe(401);
  } finally {
    try {await stop?.();} finally {
      for (const [key, value] of Object.entries(previous)) {if (value === undefined) delete process.env[key]; else process.env[key] = value;}
      await rm(root, {recursive: true});
    }
  }
});

test("read-only native governance refuses notice and migration writes without changing stored preferences", async () => {
  const {root, config} = await syntheticHostConfig();
  config.readOnly = true;
  const server = await startServer(config);
  const base = `http://127.0.0.1:${server.port}/lawoss/ai-governance`;
  const headers = {"x-legalwork-host-token": config.hostToken, "content-type": "application/json"};
  const request = (path: string, body: unknown) => fetch(base + path, {method: "POST", headers, body: JSON.stringify(body)});
  try {
    const before = await fetch(base, {headers}).then(response => response.json());
    const preview = await request("/migration/preview", {}).then(response => response.json());
    const db = await openSqlite(runtimeDbPath(config));
    const storedRows = () => db.all("SELECT workspace_id,config_json,updated_at FROM runtime_opencode_configs WHERE workspace_id IN (?,?) ORDER BY workspace_id", ["__global_ai_guidance__", "__global_ai_legacy_preference__"]);
    const beforeRows = storedRows();
    try {
    for (const [path, body] of [["/acknowledge", {textVersion: AI_GUIDANCE_VERSION, jurisdiction: "CZ"}], ["/migration/apply", {sourceHash: preview.sourceHash}]] satisfies Array<[string, unknown]>) {
      const denied = await request(path, body);
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({code: "read_only"});
    }
    expect(await fetch(base, {headers}).then(response => response.json())).toEqual(before);
    expect(await request("/migration/preview", {}).then(response => response.json())).toEqual(preview);
    expect(storedRows()).toEqual(beforeRows);
    } finally {db.close();}
  } finally {await server.stop(); await rm(root, {recursive: true});}
});
