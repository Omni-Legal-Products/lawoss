import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { ApprovalService } from "../../approvals.js";
import { brokerRequest, MAX_REQUEST_BYTES, prepareOutboundRequest, type OutboundRequest, type OutboundResponse } from "../../agent-sandbox/network.js";
import { GovernanceScopeSchema, type GovernanceScope } from "../../ai-governance-schema.js";
import { ApiError } from "../../errors.js";
import { appliedOrgPolicy, orgPolicySecret, readOrgPolicyView } from "../../org-policy.js";
import { orgChatEngineId } from "../../org-policy-schema.js";
import { readGlobalProviderMap } from "../../runtime-opencode-config-store.js";
import type { ServerConfig } from "../../types.js";
import { eligibleGovernanceProfiles } from "../ai-governance.js";
import { createHostDecisionPort } from "../host-decision.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const PROTECTED_MODEL_URL = "http://protected-lawoss.invalid/model/chat/completions";
export const PROTECTED_DOCUMENT_TOOLS = ["lawoss_documents_list", "lawoss_documents_read", "lawoss_documents_export", "lawoss_documents_validate"] as const;
const toolName = z.enum(PROTECTED_DOCUMENT_TOOLS);
const toolFunction = z.strictObject({name: toolName, description: z.string().optional(), parameters: z.record(z.string(), z.unknown()), strict: z.boolean().optional()});
const toolCall = z.strictObject({id: z.string(), type: z.literal("function"), function: z.strictObject({name: toolName, arguments: z.string()})});
const textPart = z.strictObject({type: z.literal("text"), text: z.string()});
const envelope = z.strictObject({
  model: z.string(), messages: z.array(z.strictObject({role: z.enum(["system", "user", "assistant", "tool"]), content: z.union([z.string(), z.array(textPart), z.null()]).optional(), tool_calls: z.array(toolCall).optional(), tool_call_id: z.string().optional(), name: toolName.optional()})).min(1),
  tools: z.array(z.strictObject({type: z.literal("function"), function: toolFunction})).max(4).optional(),
  tool_choice: z.union([z.enum(["auto", "none", "required"]), z.strictObject({type: z.literal("function"), function: z.strictObject({name: toolName})})]).optional(),
  stream: z.boolean().optional(), stream_options: z.strictObject({include_usage: z.boolean()}).optional(),
  temperature: z.number().optional(), top_p: z.number().optional(), max_tokens: z.number().int().positive().optional(), max_completion_tokens: z.number().int().positive().optional(),
  presence_penalty: z.number().optional(), frequency_penalty: z.number().optional(), seed: z.number().int().optional(), stop: z.union([z.string(), z.array(z.string())]).optional(), parallel_tool_calls: z.boolean().optional(),
});
const customProvider = z.object({npm: z.literal("@ai-sdk/openai-compatible"), options: z.object({baseURL: z.url(), apiKey: z.string().optional()}), models: z.record(z.string(), z.unknown())});
const measurementSchema = z.record(z.string(), z.string());

/** Host-only identity for profile binding; credentials are intentionally omitted. */
export async function protectedAiTarget(config: ServerConfig, providerId: string, modelId: string) {
  const {endpoint, fingerprint, policyHash} = await targetCredential(config, providerId, modelId);
  return {endpoint, fingerprint, policyHash};
}

/** Credentials never enter the guest, receipt, caller-visible target or native description. */
async function targetCredential(config: ServerConfig, providerId: string, modelId: string) {
  const orgProviders = (await appliedOrgPolicy(config, "ai.chat.providers"))?.value ?? [];
  const organization = orgProviders.find(provider => orgChatEngineId(provider) === providerId);
  const custom = customProvider.safeParse((await readGlobalProviderMap(config))[providerId]);
  let baseURL: string, apiKey: string;
  if (organization) {
    if (organization.source.type !== "custom" || organization.source.apiType !== "chat" || (organization.models !== "all" && !organization.models.includes(modelId)))
      throw new ApiError(403, "protected_ai_provider_unsupported", "The selected organization model is unsupported by the confined transport.");
    baseURL = organization.source.baseURL;
    if (organization.key.by === "firm") apiKey = await orgPolicySecret(config, organization.key.secretRef) ?? "";
    else if (organization.key.by === "member" && custom.success) apiKey = custom.data.options.apiKey ?? "";
    else apiKey = "";
    if (!apiKey) throw new ApiError(403, "protected_ai_account_missing", "The current organization model account is unavailable.");
  } else {
    if ((await appliedOrgPolicy(config, "ai.chat.allowCustom"))?.value === false)
      throw new ApiError(403, "org_policy_denied", "The organization does not permit custom model connections.");
    if (!custom.success || !Object.hasOwn(custom.data.models, modelId)) throw new ApiError(409, "protected_ai_provider_unsupported", "Select a configured OpenAI-compatible provider and model.");
    baseURL = custom.data.options.baseURL; apiKey = custom.data.options.apiKey ?? "";
  }
  const url = new URL(baseURL);
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash)
    throw new ApiError(400, "protected_ai_destination_invalid", "Use an HTTPS model endpoint without URL credentials.");
  const endpoint = url.href.replace(/\/+$/, "") + "/chat/completions";
  const policy = await readOrgPolicyView(config);
  const fingerprint = hash(JSON.stringify({endpoint, providerId, modelId, account: hash(apiKey)}));
  return {endpoint, apiKey, fingerprint, policyHash: hash(JSON.stringify(policy))};
}

export type ProtectedAiTransportOptions = {
  config: ServerConfig; approvals: ApprovalService; scope: GovernanceScope; providerId: string; modelId: string;
  /** Host measurement of engine, immutable runtime/plugin/config, selected sources and root owner. */
  readCurrentBinding: () => Promise<Readonly<Record<string, string>>>;
  /** Constructor-owned synthetic experiment only; no HTTP or persisted flag can grant this. */
  syntheticPilot?: {endpoint: string};
};

/** Final serialized provider bytes are the authorization unit, independently of engine prompts.
 * This port is constructed only by the physically confined VM owner; ordinary engine routes
 * remain unsupported. A native synthetic decision is never a client legal approval. */
export class ProtectedAiTransport {
  constructor(private readonly options: ProtectedAiTransportOptions) {}

  async dispatch(input: OutboundRequest, signal: AbortSignal): Promise<OutboundResponse> {
    const o = this.options;
    signal.throwIfAborted();
    if (!GovernanceScopeSchema.safeParse(o.scope).success || !o.scope.workspaceId || !o.scope.matterId)
      throw new ApiError(403, "ai_transfer_denied", "A current matter and explicit CZ/SK jurisdiction are required.", {reason: "unknown-context"});
    if (o.config.readOnly) throw new ApiError(403, "read_only", "This server is read-only.");
    if (input.url !== PROTECTED_MODEL_URL || input.method !== "POST") throw new ApiError(403, "protected_ai_destination_invalid", "Only the fixed protected model capability is available.");
    // Do not trust caller-supplied hashes/byte counts: decode and reserialize an immutable request.
    if (input.bodyBase64.length > Math.ceil(MAX_REQUEST_BYTES / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.bodyBase64))
      throw new ApiError(413, "protected_ai_context_too_large", "The model request exceeds the final-context review limit.");
    const bytes = Buffer.from(input.bodyBase64, "base64");
    if (bytes.byteLength > MAX_REQUEST_BYTES) throw new ApiError(413, "protected_ai_context_too_large", "The model request exceeds the final-context review limit.");
    let body: string;
    try {body = new TextDecoder("utf-8", {fatal: true}).decode(bytes);} catch {throw new ApiError(403, "protected_ai_envelope_invalid", "The model request must contain valid UTF-8 JSON.");}
    let parsed: z.infer<typeof envelope>;
    try {parsed = envelope.parse(JSON.parse(body));} catch {throw new ApiError(403, "protected_ai_envelope_invalid", "The model request contains an unsupported context or tool.");}
    if (parsed.model !== o.modelId) throw new ApiError(403, "protected_ai_envelope_invalid", "The selected model changed.");
    const operationId = randomUUID();
    const snapshot = async () => {
      if (o.config.readOnly) throw new ApiError(403, "read_only", "This server is read-only.");
      const target = await targetCredential(o.config, o.providerId, o.modelId);
      const binding = measurementSchema.parse(await o.readCurrentBinding());
      const requiredHashes = ["engineSha256", "runtimeManifestSha256", "pluginSha256", "configSha256", "launcherSha256", "sourceSetSha256"];
      if (requiredHashes.some(key => !/^[a-f0-9]{64}$/.test(binding[key] ?? "")) || !binding.rootIdentity || !binding.operationId)
        throw new ApiError(409, "protected_ai_measurement_missing", "The protected runtime measurements are incomplete.");
      let profiles: unknown = [];
      if (!o.syntheticPilot) {
        const eligibility = await eligibleGovernanceProfiles(o.config, {operationId, kind: "chat", scope: o.scope, targetFingerprint: target.fingerprint, dataClasses: ["protected"], purpose: "confined-document-processing"});
        if ("allowed" in eligibility) throw new ApiError(403, "ai_transfer_denied", "The current legal profile does not admit this protected transmission.", {reason: eligibility.reason});
        profiles = eligibility.profiles;
      } else if (o.syntheticPilot.endpoint !== target.endpoint || !["127.0.0.1", "[::1]"].includes(new URL(target.endpoint).hostname)) {
        throw new ApiError(403, "protected_ai_destination_invalid", "The synthetic pilot is bound to its exact host-owned loopback receiver.");
      }
      const reviewBinding = {version: 1, operationId, scope: o.scope, bodyHash: hash(body), target: target.fingerprint, policy: target.policyHash, binding, profiles, synthetic: !!o.syntheticPilot};
      return {target, reviewBinding, bindingHash: hash(JSON.stringify(reviewBinding))};
    };
    const initial = await snapshot();
    const controller = new AbortController();
    const active = AbortSignal.any([signal, controller.signal]);
    const requireCurrent = async () => {
      active.throwIfAborted();
      const current = await snapshot();
      if (current.bindingHash !== initial.bindingHash) throw new ApiError(409, "host_decision_stale", "The model account, policy, legal profile, selected sources or protected runtime changed.");
      active.throwIfAborted();
      return current.bindingHash;
    };
    let checking: Promise<void> | undefined;
    const timer = setInterval(() => {
      if (checking || active.aborted) return;
      checking = requireCurrent().then(() => {}, error => {controller.abort(error);}).finally(() => {checking = undefined;});
    }, 50);
    timer.unref?.();
    try {
      const receipt = await createHostDecisionPort(o.approvals, o.config).requestDecision({workspaceId: o.scope.workspaceId ?? "__synthetic_protected__", action: o.syntheticPilot ? "ai.protected.synthetic" : "ai.protected.document", operationId,
        bindingHash: initial.bindingHash, summary: `${o.syntheticPilot ? "Synthetic experiment; legal approval: false" : "Protected document processing"} → ${initial.target.endpoint} — ${o.providerId}/${o.modelId}`,
        description: `Current scope, model account identity, policy, protected runtime and legal-profile evidence (synthetic experiments provide no legal approval):\n${JSON.stringify(initial.reviewBinding, null, 2)}\n\nComplete serialized provider context (including system instructions and tool results):\n${body}`,
        readCurrentBindingHash: requireCurrent}, active);
      if (receipt.decision !== "allow") throw new ApiError(403, "protected_ai_denied", "The native host declined the complete model transmission.");
      await requireCurrent();
      const request = prepareOutboundRequest({url: initial.target.endpoint, method: "POST", headers: {"content-type": "application/json", ...(initial.target.apiKey ? {authorization: `Bearer ${initial.target.apiKey}`} : {})}, bodyBase64: bytes.toString("base64")}, {allowPrivate: !!o.syntheticPilot});
      const response = await brokerRequest(request, async () => {await requireCurrent(); return true;}, active, undefined, {allowPrivate: !!o.syntheticPilot, beforeConnect: async () => {await requireCurrent();}});
      await requireCurrent();
      if (response.status >= 300 && response.status < 400) throw new ApiError(502, "protected_ai_redirect_denied", "The provider attempted an unapproved redirect.");
      return response;
    } finally {clearInterval(timer); controller.abort(); await checking;}
  }
}
