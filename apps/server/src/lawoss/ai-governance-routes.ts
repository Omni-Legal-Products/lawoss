import { listPublicAiTargets, PublicAiInputSchema, runPublicAiPrompt } from "./ai-public-context.js";
import { previewGovernanceMigration, applyGovernanceMigration } from "./ai-governance-migration.js";
import { z } from "zod";
import { AI_GUIDANCE_VERSION, type AiGovernanceView } from "../ai-governance-schema.js";
import { ApiError } from "../errors.js";
import { addRoute, type Route } from "../routes/registry.js";
import { readRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { readGovernedCapabilities } from "./ai-governance.js";

export const GLOBAL_AI_GUIDANCE_ID = "__global_ai_guidance__";
export async function readAiGovernanceView(config: ServerConfig, publicEngineAvailable = false): Promise<AiGovernanceView> {
  return {publicContext: {available: publicEngineAvailable, targets: await listPublicAiTargets(config)}, guidanceVersion: AI_GUIDANCE_VERSION,
    guidanceAck: (await readRuntimeOpencodeConfig(config, GLOBAL_AI_GUIDANCE_ID)).guidanceAck ?? null,
    protectedProcessing: "unsupported", blockers: ["enforced-policy-wire-unavailable", "engine-egress-unproven"],
    capabilities: await readGovernedCapabilities(config, {workspaceId: null, matterId: null, jurisdictions: []})};
}

export function registerAiGovernanceRoutes(options: {routes: Route[]; config: ServerConfig;
  jsonResponse: (value: unknown, status?: number) => Response;
  readJsonBodyLimited: (request: Request, maxBytes: number) => Promise<Record<string, unknown>>;
  getPublicEngineBinary?: () => string | undefined; pinnedEngineVersion: string}) {
  const {routes, config, jsonResponse} = options;
  const ensureWritable = () => { if (config.readOnly) throw new ApiError(403, "read_only", "This server is read-only."); };
  addRoute(routes, "GET", "/lawoss/ai-governance", "client", async () => jsonResponse(await readAiGovernanceView(config, Boolean(options.getPublicEngineBinary?.()))));
  addRoute(routes, "POST", "/lawoss/ai-governance/acknowledge", "host-token", async ctx => {
    ensureWritable();
    const parsed = z.strictObject({textVersion: z.literal(AI_GUIDANCE_VERSION), jurisdiction: z.enum(["CZ", "SK"])}).safeParse(await options.readJsonBodyLimited(ctx.request, 1024));
    if (!parsed.success) throw new ApiError(400, "invalid_guidance_ack", "Read acknowledgment must name the current notice and jurisdiction only.");
    const body = parsed.data;
    await writeRuntimeOpencodeConfig(config, GLOBAL_AI_GUIDANCE_ID, current => ({...current,
      guidanceAck: {...body, actorRef: "native-host", readAt: Date.now()}}));
    return jsonResponse(await readAiGovernanceView(config, Boolean(options.getPublicEngineBinary?.())));
  });
  addRoute(routes, "POST", "/lawoss/ai-governance/public-text", "host-token", async ctx => {
    ensureWritable();
    const binary = options.getPublicEngineBinary?.();
    if (!binary) throw new ApiError(409, "public_ai_engine_unavailable", "Start the managed engine to use a dedicated public scratch context.");
    const parsed = PublicAiInputSchema.safeParse(await options.readJsonBodyLimited(ctx.request, 64 * 1024));
    if (!parsed.success) throw new ApiError(400, "invalid_public_prompt", "Provide the selected provider, model and public text only.");
    return jsonResponse(await runPublicAiPrompt(config, ctx.approvals, parsed.data, binary, options.pinnedEngineVersion, ctx.request.signal));
  });
  addRoute(routes, "POST", "/lawoss/ai-governance/migration/preview", "host-token", async () => jsonResponse(await previewGovernanceMigration(config)));
  addRoute(routes, "POST", "/lawoss/ai-governance/migration/apply", "host-token", async ctx => {
    ensureWritable();
    const parsed = z.strictObject({sourceHash: z.string().regex(/^[a-f0-9]{64}$/)}).safeParse(await options.readJsonBodyLimited(ctx.request, 1024));
    if (!parsed.success) throw new ApiError(400, "invalid_migration_preview", "Provide the current migration preview hash.");
    return jsonResponse(await applyGovernanceMigration(config, parsed.data.sourceHash));
  });
  for (const action of ["preview", "commit"]) addRoute(routes, "POST", `/lawoss/ai-governance/${action}`, "host-token", async () => {
    throw new ApiError(409, "ai_governance_unavailable", "Provider approval is unavailable until enforced policy and the protected transport are verified.",
      {reason: "unsupported-transport"});
  });
}
