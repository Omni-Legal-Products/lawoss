import { TRANSFER_KINDS, TransferIntentSchema, type GovernanceProfile, type GovernanceScope, type TransferDecision, type TransferIntent } from "../ai-governance-schema.js";
import { readGovernanceProfiles } from "./ai-governance-store.js";
import type { ServerConfig } from "../types.js";
import { ApiError } from "../errors.js";

/** Eligibility is not dispatch authority: only the confined final-wire transport uses this result. */
export async function eligibleGovernanceProfiles(config: ServerConfig, intent: TransferIntent): Promise<{profiles: GovernanceProfile[]} | Extract<TransferDecision, {allowed: false}>> {
  const parsed = TransferIntentSchema.safeParse(intent);
  if (!parsed.success || !parsed.data.scope.workspaceId || !parsed.data.scope.matterId)
    return {allowed: false, reason: "unknown-context"};
  if (!intent.targetFingerprint) return {allowed: false, reason: "no-model"};
  const profiles = (await readGovernanceProfiles(config)).filter(profile =>
    profile.targetFingerprint === intent.targetFingerprint && profile.scope.workspaceId === intent.scope.workspaceId
      && profile.scope.matterId === intent.scope.matterId);
  if (!profiles.length) return {allowed: false, reason: "profile-missing"};
  for (const jurisdiction of intent.scope.jurisdictions) {
    const matching = profiles.filter(profile => profile.scope.jurisdictions.includes(jurisdiction));
    if (!matching.length) return {allowed: false, reason: "profile-missing"};
    if (matching.some(profile => profile.state === "suspended")) return {allowed: false, reason: "suspended"};
    if (matching.some(profile => profile.state !== "approved" || !profile.evidenceRefs.length
      || (profile.expiresAt !== null && Date.parse(profile.expiresAt) <= Date.now())))
      return {allowed: false, reason: "reassessment-required"};
  }
  return {profiles};
}

export async function evaluateTransfer(config: ServerConfig, intent: TransferIntent): Promise<TransferDecision> {
  const eligibility = await eligibleGovernanceProfiles(config, intent);
  if ("allowed" in eligibility) return eligibility;
  // No ai.governance wire key is published without its external mirror. An approved
  // host metadata fixture is not the firm's enforced policy or proof of engine egress.
  return {allowed: false, reason: "unsupported-transport"};
}
export async function requireTransferAllowed(config: ServerConfig, intent: TransferIntent): Promise<Extract<TransferDecision, {allowed: true}>> {
  const decision = await evaluateTransfer(config, intent);
  if (!decision.allowed) throw new ApiError(403, "ai_transfer_denied", "Protected AI processing is unavailable. Continue manually without a model.", {reason: decision.reason});
  return decision;
}
export async function readGovernedCapabilities(_config: ServerConfig, _scope: GovernanceScope) {
  return TRANSFER_KINDS.map(kind => ({kind, state: "unsupported" as const, reason: "unsupported-transport" as const}));
}
