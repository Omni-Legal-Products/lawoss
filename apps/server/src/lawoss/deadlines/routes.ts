import { mirrorDeadlineAudit } from "./audit.js";
import { createDeadlineReceiptLedger } from "./ledger.js";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import type { ApprovalService } from "../../approvals.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "../../types.js";
import { addRoute, type RequestContext, type Route } from "../../routes/registry.js";
import { createHostDecisionPort, type HostDecisionPort } from "../host-decision.js";
import type { LawossDocuments } from "../documents/service.js";
import { evidenceSelectionSchema, readDeadlineEvidence } from "./evidence.js";
import { daySchema, hashSchema, idSchema } from "./schema.js";
import { resolveMatterBinding } from "./repository.js";
import { proposedRulePacks, holidaySets } from "./rules.js";
import { DeadlineWorkflow } from "./service.js";
import type { RulePack, HolidaySet } from "./types.js";
const scoped = { matterPath: z.string().max(4096) };
const reviewInput = z.strictObject({ ...scoped, expectedRevisionHash: hashSchema });
const deliveryInput = z.strictObject({ documentId: z.string().min(1), locatorId: idSchema, occurredAt: z.iso.datetime({ offset: true }), localDate: daySchema, timeZone: z.enum(["Europe/Prague", "Europe/Bratislava"]), recipientRef: z.string().min(1).max(200), documentIdentity: z.string().min(1).max(200), method: z.string().min(1).max(200) });
export const candidateInputSchema = z.strictObject({ ...scoped, selection: evidenceSelectionSchema, decisionDocumentId: z.string().min(1), ruleId: idSchema, ruleVersion: z.string().min(1).max(100), delivery: deliveryInput.nullable(), statedDuration: z.number().int().positive().max(366).optional(), scenario: z.enum(["ordinary_actual_service", "deemed_service", "correction", "wrong_advice", "other"]), expectedRecordHash: hashSchema.nullable(), replacement: z.strictObject({ candidateId: idSchema, supersedesRevisionHash: hashSchema }).optional() });
export function registerDeadlineRoutes(options: {
  routes: Route[]; config: ServerConfig; approvals: ApprovalService; documents: LawossDocuments;
  jsonResponse: (data: unknown, status?: number) => Response;
  readJsonBodyLimited: (request: Request, maxBytes: number) => Promise<Record<string, unknown>>;
  ensureWritable: (config: ServerConfig) => void;
  requireClientScope: (ctx: RequestContext, scope: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  enabled?: boolean;
  /** Test injection only; never sourced from HTTP, model parameters or an approval env switch. */
  host?: HostDecisionPort; rules?: readonly RulePack[]; holidays?: readonly HolidaySet[];
}) {
  const base = "/workspace/:id/lawoss/deadlines", enabled = options.enabled ?? process.env.LAWOSS_DEADLINE_WORKFLOW === "1";
  const host = options.host ?? createHostDecisionPort(options.approvals, options.config);
  const ledger = createDeadlineReceiptLedger(options.config);
  const service = (workspace: WorkspaceInfo) => new DeadlineWorkflow({ host, ledger, mirrorAudit: mirrorDeadlineAudit, documents: options.documents, workspace, rules: options.rules, holidays: options.holidays });
  addRoute(options.routes, "GET", `${base}/availability`, "client", async () => options.jsonResponse({ enabled, approvedProfiles: (options.rules ?? proposedRulePacks).filter(rule => rule.status === "approved").map(rule => ({ id: rule.id, jurisdiction: rule.jurisdiction, version: rule.version })), proposedProfiles: (options.rules ?? proposedRulePacks).map(rule => ({ id: rule.id, jurisdiction: rule.jurisdiction, version: rule.version, status: rule.status, sources: rule.sources, exclusions: rule.exclusions })), legalReviewRequired: !(options.rules ?? proposedRulePacks).some(rule => rule.status === "approved") }));
  const route = (method: string, suffix: string, native: boolean, action: (ctx: RequestContext, workspace: WorkspaceInfo, workflow: DeadlineWorkflow) => Promise<unknown>, trustOnly = false) => {
    addRoute(options.routes, method, `${base}${suffix}`, native ? "host-token" : "client", async ctx => {
      if (!enabled && !trustOnly) throw new ApiError(404, "deadline_disabled", "The deadline workflow is not enabled. Existing OKF records remain readable.");
      if (method !== "GET") options.requireClientScope(ctx, "collaborator");
      if (method !== "GET") options.ensureWritable(options.config);
      const workspace = await options.resolveWorkspace(options.config, ctx.params.id);
      try { return options.jsonResponse(await action(ctx, workspace, service(workspace))); }
      catch (error) { if (error instanceof z.ZodError) throw new ApiError(400, "deadline_input", "Provide bounded scoped selections, exact source locators and current revision hashes."); throw error; }
    });
  };
  route("GET", "", false, async (ctx, workspace, workflow) => {
    const path = z.string().max(4096).parse(ctx.url.searchParams.get("matterPath") ?? "");
    return { items: await workflow.list(await resolveMatterBinding(workspace, path)), syntheticOnly: !(options.rules ?? proposedRulePacks).some(rule => rule.status === "approved") };
  }, true);
  route("POST", "/candidates", false, async (ctx, workspace, workflow) => {
    const body = candidateInputSchema.parse(await options.readJsonBodyLimited(ctx.request, 512 * 1024)), binding = await resolveMatterBinding(workspace, body.matterPath);
    const refs = await readDeadlineEvidence(options.documents, workspace, body.selection), decision = refs.filter(ref => ref.documentId === body.decisionDocumentId);
    if (!decision.length) throw new ApiError(400, "deadline_selection", "Select the exact decision excerpt.");
    const proof = body.delivery && refs.find(ref => ref.documentId === body.delivery!.documentId && ref.locator.locatorId === body.delivery!.locatorId);
    if (body.delivery && (!proof || body.delivery.documentIdentity !== body.decisionDocumentId)) throw new ApiError(400, "deadline_delivery", "The service proof must identify the selected decision and exact proof excerpt.");
    return workflow.saveCandidate(binding, { jurisdiction: binding.jurisdiction, ruleId: body.ruleId, ruleVersion: body.ruleVersion, ruleEffectiveOn: body.delivery?.localDate ?? new Date().toISOString().slice(0, 10), evidence: decision, delivery: body.delivery && proof ? { kind: "actual_service", evidence: proof, occurredAt: body.delivery.occurredAt, localDate: body.delivery.localDate, timeZone: body.delivery.timeZone, recipientRef: body.delivery.recipientRef, documentIdentity: body.delivery.documentIdentity, method: body.delivery.method } : null, uncertainties: [], scenario: body.scenario, statedDuration: body.statedDuration }, body.expectedRecordHash, body.replacement);
  });
  route("POST", "/:candidate/review", false, async (ctx, workspace, workflow) => { const body = reviewInput.parse(await options.readJsonBodyLimited(ctx.request, 16 * 1024)); return workflow.prepareReview(await resolveMatterBinding(workspace, body.matterPath), idSchema.parse(ctx.params.candidate), body.expectedRevisionHash); });
  route("POST", "/:candidate/decision", true, async (ctx, workspace, workflow) => {
    const body = z.strictObject({ ...scoped, expectedRevisionHash: hashSchema, expectedReviewHash: hashSchema, operationId: idSchema, decision: z.enum(["confirm", "defer", "reject", "revoke"]), reason: z.string().min(1).max(2000) }).parse(await options.readJsonBodyLimited(ctx.request, 16 * 1024));
    return workflow.decide(await resolveMatterBinding(workspace, body.matterPath), idSchema.parse(ctx.params.candidate), body.expectedRevisionHash, body.decision, body.operationId, ctx.request.signal, body.expectedReviewHash, body.reason);
  });
  route("POST", "/:candidate/export/retry", false, async (ctx, workspace, workflow) => { const body = z.strictObject({ ...scoped, expectedRevisionHash: hashSchema, operationId: idSchema }).parse(await options.readJsonBodyLimited(ctx.request, 16 * 1024)); return workflow.exportDeadlineIcs(await resolveMatterBinding(workspace, body.matterPath), idSchema.parse(ctx.params.candidate), body.expectedRevisionHash); });
  route("POST", "/recover", false, async (ctx, workspace, workflow) => { const body = z.strictObject(scoped).parse(await options.readJsonBodyLimited(ctx.request, 16 * 1024)); return { results: await workflow.recoverDeadlineExports(await resolveMatterBinding(workspace, body.matterPath)) }; });
}
