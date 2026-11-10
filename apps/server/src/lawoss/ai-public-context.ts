import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import type { ApprovalService } from "../approvals.js";
import { ApiError } from "../errors.js";
import { createManagedOpencodeServer, type ManagedOpencodeServer } from "../managed-opencode.js";
import { appliedOrgPolicy } from "../org-policy.js";
import { readGlobalProviderMap } from "../runtime-opencode-config-store.js";
import { serve, type ServeResult } from "../serve-node.js";
import type { ServerConfig } from "../types.js";
import { createHostDecisionPort } from "./host-decision.js";
import pins from "./protected-ai/engine-pins.json" with {type: "json"};

export const PublicAiInputSchema = z.strictObject({providerId: z.string().min(1).max(128), modelId: z.string().min(1).max(200), text: z.string().trim().min(1).max(16000)});
export type PublicAiInput = z.infer<typeof PublicAiInputSchema>;
const providerSchema = /* Engine v2 provider block (v1: npm/options). */ z.object({package: z.literal("@opencode/ai/providers/openai-compatible"), settings: z.object({baseURL: z.url(), apiKey: z.string().optional()}), models: z.record(z.string(), z.unknown())});
// Engine v2 history records; the turn is terminal at its own idle outcome.
const historyResponse = z.object({data: z.array(z.object({id: z.string(), type: z.string(), outcome: z.string().optional(),
  content: z.array(z.object({type: z.string(), text: z.string().optional()}).passthrough()).optional()}).passthrough())}).passthrough();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function fileHash(path: string) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}
export async function listPublicAiTargets(config: ServerConfig): Promise<Array<{id: string; models: string[]}>> {
  if ((await appliedOrgPolicy(config, "ai.chat.allowCustom"))?.value === false) return [];
  return Object.entries(await readGlobalProviderMap(config)).flatMap(([id, value]) => {
    const parsed = providerSchema.safeParse(value);
    return parsed.success ? [{id, models: Object.keys(parsed.data.models)}] : [];
  });
}

async function targetFor(config: ServerConfig, input: PublicAiInput) {
  if ((await appliedOrgPolicy(config, "ai.chat.allowCustom"))?.value === false)
    throw new ApiError(403, "org_policy_denied", "The firm does not permit this custom public model connection.");
  const selected = providerSchema.safeParse((await readGlobalProviderMap(config))[input.providerId]);
  if (!selected.success || !Object.hasOwn(selected.data.models, input.modelId))
    throw new ApiError(409, "public_ai_provider_unsupported", "Select a configured OpenAI-compatible provider and one of its models for the public scratch test.");
  const url = new URL(selected.data.settings.baseURL);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash)
    throw new ApiError(400, "public_ai_target_invalid", "Use an HTTPS target or an explicit loopback test receiver without URL credentials.");
  const apiKey = selected.data.settings.apiKey ?? "";
  const endpoint = url.href.replace(/\/+$/, "") + "/chat/completions";
  return {endpoint, apiKey, fingerprint: hash(JSON.stringify({endpoint, provider: input.providerId, model: input.modelId, account: hash(apiKey)}))};
}

async function boundedPublicBody(request: Request): Promise<string> {
  const limit = 256 * 1024;
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {await request.body?.cancel(); throw new ApiError(413, "public_context_too_large", "The public model context exceeds its review limit.");}
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "public_context_empty", "The public model context is missing.");
  const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      if (next.value.byteLength > limit - bytes) throw new ApiError(413, "public_context_too_large", "The public model context exceeds its review limit.");
      bytes += next.value.byteLength; chunks.push(next.value);
    }
    return Buffer.concat(chunks, bytes).toString("utf8");
  } finally {try {await reader.cancel();} finally {reader.releaseLock();}}
}

/** A one-shot, native-only technical classification, never a legal/provider grant.
 * The engine owns an empty scratch directory, isolated config/DB/environment, and no
 * real provider credential. Each final serialized provider body gets a separate native
 * decision at the host relay; no remembered or browser-provided public flag is accepted. */
export async function runPublicAiPrompt(config: ServerConfig, approvals: ApprovalService, raw: PublicAiInput, binary: string, expectedEngineVersion: string, signal?: AbortSignal): Promise<{reply: string; operationId: string; scope: "public-text-scratch"; legalApproval: false}> {
  const parsed = PublicAiInputSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "invalid_public_prompt", "Provide the selected provider, model and public text only.");
  if (config.readOnly) throw new ApiError(403, "read_only", "This server is read-only.");
  if (!expectedEngineVersion.trim()) throw new ApiError(409, "public_ai_engine_version", "A pinned managed engine version is required for the public scratch test.");
  if (!isAbsolute(binary)) throw new ApiError(409, "public_ai_engine_unavailable", "A pinned managed engine is required for the public scratch test.");
  const input = parsed.data, target = await targetFor(config, input), engineHash = await fileHash(binary);
  const operationId = randomUUID(), capability = randomUUID();
  const root = await mkdtemp(join(tmpdir(), "lawoss-public-ai-"));
  const directory = join(root, "public-scratch");
  await mkdir(directory, {mode: 0o700});
  const controller = new AbortController();
  const active = AbortSignal.any([controller.signal, AbortSignal.timeout(60000), ...(signal ? [signal] : [])]);
  const port = createHostDecisionPort(approvals, config);
  let engine: ManagedOpencodeServer | undefined, relay: ServeResult | undefined;
  let denied = false;
  let requestNumber = 0;
  const binding = (body: string, targetFingerprint: string, binaryHash: string, requestOperationId: string) => hash(JSON.stringify({version: 1, action: "ai.public.synthetic", operationId: requestOperationId, directory, targetFingerprint, binaryHash, bodyHash: hash(body), tools: "none"}));
  try {
    relay = await serve({hostname: "127.0.0.1", port: 0, fetch: async request => {
      try {
        const url = new URL(request.url);
        if (request.method !== "POST" || url.pathname !== `/${capability}/chat/completions`) return new Response("Not found", {status: 404});
        const body = await boundedPublicBody(request);
        const envelope = z.object({model: z.literal(input.modelId), tools: z.array(z.unknown()).max(0).optional(), messages: z.array(z.object({role: z.enum(["system", "user", "assistant"]), tool_calls: z.never().optional()}))}).safeParse(JSON.parse(body));
        if (!envelope.success) throw new ApiError(403, "public_context_tools_denied", "The public scratch request cannot expose tools, shell, MCP or tool results.");
        const current = await targetFor(config, input);
        if (current.fingerprint !== target.fingerprint) throw new ApiError(409, "host_decision_stale", "The public target changed.");
        const requestOperationId = `${operationId}:${++requestNumber}`;
        const expected = binding(body, target.fingerprint, engineHash, requestOperationId);
        const receipt = await port.requestDecision({workspaceId: "__host_public_ai__", action: "ai.public.synthetic", operationId: requestOperationId,
          bindingHash: expected, summary: `Public text only → ${new URL(target.endpoint).origin} — ${input.providerId}/${input.modelId}. No client files, tools, shell or legal approval.`,
          description: `Target: ${target.endpoint}\nComplete serialized system and message context to be sent:\n` + JSON.stringify(JSON.parse(body), null, 2),
          readCurrentBindingHash: async () => binding(body, (await targetFor(config, input)).fingerprint, await fileHash(binary), requestOperationId)}, active);
        if (receipt.decision !== "allow") throw new ApiError(403, "public_ai_denied", "The native host declined this public transmission.");
        active.throwIfAborted();
        const finalTarget = await targetFor(config, input);
        if (binding(body, finalTarget.fingerprint, engineHash, requestOperationId) !== expected) throw new ApiError(409, "host_decision_stale", "The public target changed before dispatch.");
        return await fetch(finalTarget.endpoint, {method: "POST", redirect: "error", signal: active,
          headers: {"content-type": "application/json", ...(finalTarget.apiKey ? {Authorization: `Bearer ${finalTarget.apiKey}`} : {})}, body});
      } catch (error) {
        denied = true;
        return Response.json({error: {message: error instanceof ApiError ? error.code : "public_ai_denied", type: "public_ai_denied"}}, {status: error instanceof ApiError ? error.status : 403});
      }
    }});
    const engineConfig = join(root, "engine.json");
    // Engine v2 configuration: one relay-only provider, no plugins, MCP, skills or instructions,
    // and every tool permission denied (no tool definition reaches the provider).
    const deny = [{action: "*", resource: "*", effect: "deny"}];
    await writeFile(engineConfig, JSON.stringify({model: `public-synthetic/${input.modelId}`, default_agent: "public-scratch", share: "disabled", update: "disable", snapshots: false,
      plugins: [], mcp: {servers: {}}, skills: [], instructions: [], permissions: deny, lsp: false, formatter: false, compaction: {auto: false},
      agents: {"public-scratch": {mode: "primary", description: "Public scratch", permissions: deny}},
      providers: {"public-synthetic": {name: "Public scratch", package: "@opencode/ai/providers/openai-compatible", settings: {baseURL: `http://127.0.0.1:${relay.port}/${capability}`, apiKey: "public-relay-only"},
        models: {[input.modelId]: {name: "Public scratch", limit: {context: 100000, output: 4000}}}}}}), {mode: 0o600});
    engine = await createManagedOpencodeServer({bin: binary, cwd: directory, inheritEnvironment: false,
      env: {PATH: process.env.PATH ?? "/usr/bin:/bin", OPENCODE_CONFIG: engineConfig, OPENCODE_TEST_HOME: root, OPENCODE_DB: join(root, "engine.sqlite"),
        XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
        OPENCODE_CONFIG_DIR: join(root, "empty-config"), OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true",
        OPENCODE_DISABLE_MODELS_FETCH: "true", OPENCODE_DISABLE_FREE_MODELS: "true", OPENCODE_DISABLE_FFF: "true", OPENCODE_DISABLE_FILEWATCHER: "true"}});
    const headers = {Authorization: "Basic " + Buffer.from(`${engine.username}:${engine.password}`).toString("base64"), "content-type": "application/json"};
    const health = await fetch(engine.url + "/api/info", {headers, signal: active}).then(response => response.json());
    // The reviewed LegalWork derivative of the configured upstream version (ADR 0016) reports
    // its own exact version; it is the same host-owned pin as the confined guest engine.
    const derivative = pins.engineVersion.startsWith(`${expectedEngineVersion}-`) ? pins.engineVersion : undefined;
    if (health.version !== expectedEngineVersion && health.version !== derivative) throw new ApiError(409, "public_ai_engine_version", "The public scratch engine does not match the pinned version.");
    const location = `location%5Bdirectory%5D=${encodeURIComponent(directory)}`;
    // `GET /api/model` waits for the location's plugin activation before the session exists.
    await fetch(`${engine.url}/api/model?${location}`, {headers, signal: active}).then(response => response.body?.cancel());
    const session = z.object({data: z.object({id: z.string()})}).parse(await fetch(engine.url + "/api/session", {method: "POST", headers, signal: active,
      body: JSON.stringify({title: "Public scratch", agent: "public-scratch", model: {providerID: "public-synthetic", id: input.modelId}, location: {directory}, permissions: deny})}).then(response => response.json())).data;
    const messageID = `msg_${capability.replaceAll("-", "")}`;
    const admitted = await fetch(`${engine.url}/api/session/${session.id}/prompt`, {method: "POST", headers, signal: active, body: JSON.stringify({id: messageID, text: input.text})});
    await admitted.body?.cancel();
    const waited = admitted.ok ? await fetch(`${engine.url}/api/experimental/session/${session.id}/wait`, {method: "POST", headers, signal: active}) : undefined;
    await waited?.body?.cancel();
    const history = historyResponse.safeParse(await fetch(`${engine.url}/api/session/${session.id}/message?order=asc&limit=200`, {headers, signal: active}).then(response => response.json()));
    if (denied) throw new ApiError(403, "public_ai_denied", "The public transmission was denied; protected AI remains unavailable.");
    const start = history.success ? history.data.data.findIndex(record => record.id === messageID && record.type === "user") : -1;
    const turn = history.success && start >= 0 ? history.data.data.slice(start + 1) : [];
    const idle = turn.find(record => record.type === "idle");
    if (!admitted.ok || !waited?.ok || !idle || idle.outcome !== "succeeded") throw new ApiError(502, "public_ai_model_failed", "The public scratch model did not produce a successful answer.");
    const reply = turn.filter(record => record.type === "assistant").flatMap(record => record.content ?? []).filter(part => part.type === "text").map(part => part.text ?? "").join("\n").trim();
    if (!reply) throw new ApiError(502, "public_ai_empty_reply", "The public scratch model returned no text.");
    return {reply, operationId, scope: "public-text-scratch", legalApproval: false};
  } finally {
    controller.abort();
    try {await engine?.close();} finally {try {await relay?.stop();} finally {await rm(root, {recursive: true});}}
  }
}
