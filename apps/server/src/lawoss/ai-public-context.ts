import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import constants from "../../../../constants.json" with {type: "json"};
import type { ApprovalService } from "../approvals.js";
import { ApiError } from "../errors.js";
import { createManagedOpencodeServer, type ManagedOpencodeServer } from "../managed-opencode.js";
import { appliedOrgPolicy } from "../org-policy.js";
import { readGlobalProviderMap } from "../runtime-opencode-config-store.js";
import { serve, type ServeResult } from "../serve-node.js";
import type { ServerConfig } from "../types.js";
import { createHostDecisionPort } from "./host-decision.js";

export const PublicAiInputSchema = z.strictObject({providerId: z.string().min(1).max(128), modelId: z.string().min(1).max(200), text: z.string().trim().min(1).max(16000)});
export type PublicAiInput = z.infer<typeof PublicAiInputSchema>;
const providerSchema = z.object({npm: z.literal("@ai-sdk/openai-compatible"), options: z.object({baseURL: z.url(), apiKey: z.string().optional()}), models: z.record(z.string(), z.unknown())});
const modelResponse = z.object({info: z.object({error: z.unknown().optional()}), parts: z.array(z.object({type: z.string(), text: z.string().optional()}))});
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
  const url = new URL(selected.data.options.baseURL);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash)
    throw new ApiError(400, "public_ai_target_invalid", "Use an HTTPS target or an explicit loopback test receiver without URL credentials.");
  const apiKey = selected.data.options.apiKey ?? "";
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
export async function runPublicAiPrompt(config: ServerConfig, approvals: ApprovalService, raw: PublicAiInput, binary: string, signal?: AbortSignal): Promise<{reply: string; operationId: string; scope: "public-text-scratch"; legalApproval: false}> {
  const parsed = PublicAiInputSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "invalid_public_prompt", "Provide the selected provider, model and public text only.");
  if (config.readOnly) throw new ApiError(403, "read_only", "This server is read-only.");
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
    await writeFile(engineConfig, JSON.stringify({enabled_providers: ["public-synthetic"], model: `public-synthetic/${input.modelId}`, small_model: `public-synthetic/${input.modelId}`,
      share: "disabled", autoupdate: false, plugin: [], mcp: {}, permission: {"*": "deny"}, lsp: false, formatter: false,
      provider: {"public-synthetic": {npm: "@ai-sdk/openai-compatible", name: "Public scratch", options: {baseURL: `http://127.0.0.1:${relay.port}/${capability}`, apiKey: "public-relay-only"},
        models: {[input.modelId]: {name: "Public scratch", limit: {context: 100000, output: 4000}}}}}}), {mode: 0o600});
    engine = await createManagedOpencodeServer({bin: binary, cwd: directory, inheritEnvironment: false, timeoutMs: 15000,
      env: {PATH: process.env.PATH ?? "/usr/bin:/bin", OPENCODE_CONFIG: engineConfig, OPENCODE_TEST_HOME: root, OPENCODE_DB: join(root, "engine.sqlite"),
        XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
        OPENCODE_CONFIG_DIR: join(root, "empty-config"), OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true",
        OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS: "false", OPENCODE_DISABLE_AUTOCOMPACT: "true", OPENCODE_DISABLE_LSP_DOWNLOAD: "true"}});
    const headers = {Authorization: "Basic " + Buffer.from(`${engine.username}:${engine.password}`).toString("base64"), "content-type": "application/json"};
    const health = await fetch(engine.url + "/global/health", {headers, signal: active}).then(response => response.json());
    if (health.version !== constants.opencodeVersion.replace(/^v/, "")) throw new ApiError(409, "public_ai_engine_version", "The public scratch engine does not match the pinned version.");
    const session = z.object({id: z.string()}).parse(await fetch(engine.url + "/session", {method: "POST", headers, signal: active, body: JSON.stringify({title: "Public scratch", permission: [{permission: "*", pattern: "*", action: "deny"}]})}).then(response => response.json()));
    const response = await fetch(`${engine.url}/session/${session.id}/message`, {method: "POST", headers, signal: active,
      body: JSON.stringify({model: {providerID: "public-synthetic", modelID: input.modelId}, parts: [{type: "text", text: input.text}]})});
    const result = modelResponse.safeParse(await response.json());
    if (denied) throw new ApiError(403, "public_ai_denied", "The public transmission was denied; protected AI remains unavailable.");
    if (!response.ok || !result.success || result.data.info.error) throw new ApiError(502, "public_ai_model_failed", "The public scratch model did not produce a successful answer.");
    const reply = result.data.parts.filter(part => part.type === "text").map(part => part.text ?? "").join("\n").trim();
    if (!reply) throw new ApiError(502, "public_ai_empty_reply", "The public scratch model returned no text.");
    return {reply, operationId, scope: "public-text-scratch", legalApproval: false};
  } finally {
    controller.abort();
    try {await engine?.close();} finally {try {await relay?.stop();} finally {await rm(root, {recursive: true});}}
  }
}
