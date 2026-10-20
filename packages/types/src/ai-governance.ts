import { z } from "zod";

export const TRANSFER_KINDS = ["chat", "attachment", "compaction", "title", "subagent", "fusion", "worker", "voice", "ocr", "systemone", "embedding", "external-tool"] as const;
export const GovernanceScopeSchema = z.strictObject({
  workspaceId: z.string().min(1).nullable(), matterId: z.string().min(1).nullable(),
  jurisdictions: z.array(z.enum(["CZ", "SK"])).min(1).max(2),
});
export type GovernanceScope = z.infer<typeof GovernanceScopeSchema>;
export const TransferIntentSchema = z.strictObject({
  operationId: z.string().min(1), kind: z.enum(TRANSFER_KINDS), scope: GovernanceScopeSchema,
  targetFingerprint: z.string(), dataClasses: z.array(z.string().min(1)).min(1), purpose: z.string().min(1),
});
export type TransferIntent = z.infer<typeof TransferIntentSchema>;
export type TransferKind = TransferIntent["kind"];
export type TransferDecision =
  | {allowed: true; policyRevision: number; profileRevision: number; targetFingerprint: string}
  | {allowed: false; reason: "no-model" | "unknown-context" | "org-denied" | "profile-missing" | "reassessment-required" | "suspended" | "unsupported-transport" | "stale-proof"};

export const GovernanceProfileSchema = z.strictObject({
  id: z.string().min(1).max(128), revision: z.number().int().positive(),
  state: z.enum(["draft", "approved", "rejected", "suspended", "reassessment-required"]),
  scope: GovernanceScopeSchema,
  targetFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  legalProfileId: z.string().min(1).max(128), legalProfileVersion: z.string().min(1).max(128),
  evidenceRefs: z.array(z.string().regex(/^sha256:[a-f0-9]{64}$/)).max(50),
  expiresAt: z.iso.datetime().nullable(), decidedBy: z.string().min(1), decidedAt: z.iso.datetime(),
});
export type GovernanceProfile = z.infer<typeof GovernanceProfileSchema>;
export type GuidanceAck = {textVersion: string; jurisdiction: "CZ" | "SK"; actorRef: string; readAt: number};

export const AI_GUIDANCE_VERSION = "2026-10-17-technical-alpha";
export const GuidanceAckSchema = z.strictObject({textVersion: z.string().min(1).max(80), jurisdiction: z.enum(["CZ", "SK"]), actorRef: z.literal("native-host"), readAt: z.number().int().nonnegative()});
/** LAWOSS alpha switch: when enforced, only protected document generation reaches a model.
 * `device` is a tightening-only lock from this computer's environment; `invalid` is a damaged
 * stored value, treated as enforced until saved again. Nothing in the renderer can unlock either. */
export type AiBoundaries = {enforced: boolean; locked: boolean; source: "default" | "user" | "device" | "invalid"};
/** `details.source` of the `ai_transfer_denied` error sent only by the AI hranice host guard. */
export const AI_BOUNDARIES_DENIAL_SOURCE = "ai-boundaries";
export type AiGovernanceView = {boundaries?: AiBoundaries; publicContext?: {available: boolean; targets: Array<{id: string; models: string[]}>}; guidanceVersion: string; guidanceAck: GuidanceAck | null;
  boundedDocuments?: {state: "conditional"; requiresApprovedMatterProfile: true; requiresNativeCaseReview: true; requiresFinalWireReview: true; approvalCreation: "unavailable"};
  protectedProcessing: "unsupported"; blockers: string[]; capabilities: Array<{kind: TransferKind; state: "unsupported" | "available"; reason: "unsupported-transport" | null}>};

export type PublicAiResult = {reply: string; operationId: string; scope: "public-text-scratch"; legalApproval: false};

/** Host-owned profile metadata only; discovery never grants processing authority. */
export type ProtectedDocumentProfiles = {
  profiles: Array<Pick<GovernanceProfile, "id" | "revision" | "scope" | "legalProfileId" | "legalProfileVersion" | "evidenceRefs" | "expiresAt">>;
  targetFingerprint: string;
  syntheticReviewAvailable: boolean;
  requiresNativeCaseReview: true;
  legalApproval: false;
};
