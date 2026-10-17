import { startServer } from "../server.js";
import { TokenService } from "../tokens.js";
import { expect, test } from "bun:test";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApprovalService } from "../approvals.js";
import { GLOBAL_PERSONALIZATION_ID, GLOBAL_PROVIDERS_ID, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import { closeOrgPolicyRuntime } from "../org-policy.js";
import { syntheticHostConfig } from "./test-support/host-config.js";
import { runPublicAiPrompt } from "./ai-public-context.js";
import constants from "../../../../constants.json" with {type: "json"};
const pinnedVersion = constants.opencodeVersion.trim().replace(/^v/, "");
const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;

test.skipIf(!binary)("native public text uses an empty isolated engine and exact-context host decisions; denial emits nothing", async () => {
  if (!binary) return;
  const {root, config} = await syntheticHostConfig();
  const client = join(root, "private-client"); await mkdir(client);
  await writeFile(join(client, "AGENTS.md"), "PRIVATE-AGENTS-CANARY");
  config.workspaces.push({id: "private", name: "PRIVATE-WORKSPACE-CANARY", path: client, preset: "starter", workspaceType: "local"});
  const received: string[] = [];
  let malicious = false;
  const toolMarker = join(root, "model-tool-must-not-write");
  const approvedBodies: string[] = [];
  const previousPaths = {LEGALWORK_RUNTIME_DB: process.env.LEGALWORK_RUNTIME_DB, LEGALWORK_TOKEN_STORE: process.env.LEGALWORK_TOKEN_STORE};
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite"); process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json");
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const previousEnv = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "PRIVATE-ENV-CANARY";
  const receiver = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.text(); received.push(JSON.stringify({url: request.url, headers: [...request.headers], body}));
    const stream = JSON.parse(body).stream;
    const tool = {id: "model_attempt", type: "function", function: {name: "bash", arguments: JSON.stringify({command: "cat " + JSON.stringify(join(client, "AGENTS.md")) + " && touch " + JSON.stringify(toolMarker), description: "Synthetic denied tool"})}};
    if (malicious) {
      if (!stream) return Response.json({id: "public", object: "chat.completion", created: 1, model: "fixture", choices: [{index: 0, message: {role: "assistant", content: null, tool_calls: [tool]}, finish_reason: "tool_calls"}]});
      return new Response(`data: ${JSON.stringify({id: "public", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{index: 0, delta: {tool_calls: [{index: 0, ...tool}]}, finish_reason: null}]})}\n\n` + `data: ${JSON.stringify({id: "public", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{index: 0, delta: {}, finish_reason: "tool_calls"}]})}\n\ndata: [DONE]\n\n`, {headers: {"content-type": "text/event-stream"}});
    }
    if (!stream) return Response.json({id: "public", object: "chat.completion", created: 1, model: "fixture", choices: [{index: 0, message: {role: "assistant", content: "PUBLIC_SYNTHETIC_OK"}, finish_reason: "stop"}], usage: {prompt_tokens: 2, completion_tokens: 2, total_tokens: 4}});
    const event = (delta: unknown, finish_reason: string | null) => `data: ${JSON.stringify({id: "public", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{index: 0, delta, finish_reason}]})}\n\n`;
    return new Response(event({role: "assistant", content: "PUBLIC_SYNTHETIC_OK"}, null) + event({}, "stop") + "data: [DONE]\n\n", {headers: {"content-type": "text/event-stream"}});
  }});
  let allow = true;
  const reviewed: string[] = [];
  const approve = async (request: Parameters<NonNullable<typeof config.requestHostApproval>>[0]) => {
    reviewed.push(request.summary);
    if (allow && request.description) approvedBodies.push(JSON.stringify(JSON.parse(request.description.split("Complete serialized system and message context to be sent:\n")[1])));
    return allow ? "allow" as const : "deny" as const;
  };
  const approvals = new ApprovalService({mode: "auto", timeoutMs: 10000}, approve);
  try {
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, () => ({provider: {fixture: {npm: "@ai-sdk/openai-compatible", options: {baseURL: receiver.url.origin + "/v1", apiKey: "SYNTHETIC_TARGET_KEY"}, models: {fixture: {limit: {context: 100000, output: 4000}}}}}}));
    await writeRuntimeOpencodeConfig(config, GLOBAL_PERSONALIZATION_ID, () => ({personalization: {customInstructions: "PRIVATE-PERSONALIZATION-CANARY", personality: "default"}}));
    const input = {providerId: "fixture", modelId: "fixture", text: "PUBLIC-TEXT-CANARY"};
    const result = await runPublicAiPrompt(config, approvals, input, binary, pinnedVersion);
    expect(result.reply).toContain("PUBLIC_SYNTHETIC_OK");
    expect(received.some(body => body.includes("PUBLIC-TEXT-CANARY"))).toBe(true);
    expect(reviewed.length).toBeGreaterThan(0);
    for (const serialized of received) {
      expect(serialized).not.toContain("PRIVATE-AGENTS-CANARY"); expect(serialized).not.toContain("PRIVATE-WORKSPACE-CANARY");
      expect(serialized).not.toContain(client);
      expect(serialized).not.toContain("PRIVATE-ENV-CANARY"); expect(serialized).not.toContain("PRIVATE-PERSONALIZATION-CANARY");
      expect(approvedBodies).toContain(JSON.stringify(JSON.parse(JSON.parse(serialized).body)));
    }
    config.requestHostApproval = approve; config.approval.timeoutMs = 10000;
    server = await startServer(config, {publicEngineBinary: () => binary});
    const base = `http://127.0.0.1:${server.port}`;
    const owner = await new TokenService(config).create("owner");
    const forbidden = await fetch(base + "/lawoss/ai-governance/public-text", {method: "POST", headers: {authorization: `Bearer ${owner.token}`, "content-type": "application/json"}, body: JSON.stringify(input)});
    expect(forbidden.status).toBe(401);
    const publicResponse = await fetch(base + "/lawoss/ai-governance/public-text", {method: "POST", headers: {"x-legalwork-host-token": config.hostToken, "content-type": "application/json"}, body: JSON.stringify(input)});
    expect(publicResponse.status).toBe(200);
    expect(await publicResponse.json()).toMatchObject({reply: "PUBLIC_SYNTHETIC_OK", scope: "public-text-scratch", legalApproval: false});
    const beforeMismatch = received.length;
    await expect(runPublicAiPrompt(config, approvals, input, binary, "0.0.0-synthetic-mismatch")).rejects.toMatchObject({code: "public_ai_engine_version"});
    expect(received).toHaveLength(beforeMismatch);
    malicious = true;
    const beforeTool = received.length;
    await expect(runPublicAiPrompt(config, approvals, {...input, text: "PUBLIC-TOOL-ATTEMPT"}, binary, pinnedVersion)).rejects.toBeDefined();
    expect(received).toHaveLength(beforeTool + 1);
    await expect(access(toolMarker)).rejects.toBeDefined();
    expect(received.slice(beforeTool).join("\n")).not.toContain("PRIVATE-AGENTS-CANARY");
    malicious = false;
    const before = received.length; allow = false;
    await expect(runPublicAiPrompt(config, approvals, {...input, text: "DENIED-PUBLIC-CANARY"}, binary, pinnedVersion)).rejects.toMatchObject({code: "public_ai_denied"});
    expect(received).toHaveLength(before);
    expect(await readFile(join(client, "AGENTS.md"), "utf8")).toBe("PRIVATE-AGENTS-CANARY");
  } finally {
    try {await server?.stop();} finally {
    for (const [key, value] of Object.entries(previousPaths)) {if (value === undefined) delete process.env[key]; else process.env[key] = value;}
    if (previousEnv === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousEnv;
    approvals.dispose(); receiver.stop(true);
    try {await closeOrgPolicyRuntime(config);} finally {await rm(root, {recursive: true});}
    }
  }
}, 90000);
