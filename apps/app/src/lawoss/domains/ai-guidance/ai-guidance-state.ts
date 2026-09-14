/**
 * LAWOSS's user-selected handling regime for protected legal information.
 * This is a product setting, not a compliance certificate: the lawyer must
 * still verify the actual provider terms and deployment.
 */
export type AiDataRegime = "local" | "dpa" | "consent";

export const AI_DATA_REGIMES: readonly AiDataRegime[] = ["local", "dpa", "consent"];

export type SubscriptionType =
  | "eigenwelt-plus"
  | "eigenwelt-pro"
  | "eigenwelt-hub"
  | "byo"
  | "unknown";

export type SubscriptionDetectionConfidence = "high" | "medium" | "low";

export type SubscriptionDetectionInput = {
  eigenweltConnected: boolean;
  plan: "plus" | "pro" | "hub" | null;
  subscriptionStatus: string | null;
  premiumModels: boolean;
  connectedProviderIds: readonly string[];
};

export type SubscriptionDetection = {
  type: SubscriptionType;
  confidence: SubscriptionDetectionConfidence;
  /** Stable reason code for UI copy; it deliberately makes no legal claim. */
  reason: "entitlement" | "provider" | "unavailable";
};

const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due"]);

export function normalizeAiDataRegime(value: unknown): AiDataRegime | null {
  return value === "local" || value === "dpa" || value === "consent" ? value : null;
}

export function aiRegimeNeedsDpa(regime: AiDataRegime | null): boolean {
  return regime === "dpa";
}

export function aiRegimeNeedsClientConsent(regime: AiDataRegime | null): boolean {
  return regime === "consent";
}

export function detectSubscriptionType(input: SubscriptionDetectionInput): SubscriptionDetection {
  const plan = input.plan;
  const status = input.subscriptionStatus?.trim().toLowerCase() ?? "";

  if (input.eigenweltConnected && plan && ENTITLED_STATUSES.has(status)) {
    if (plan === "plus") {
      return { type: "eigenwelt-plus", confidence: "high", reason: "entitlement" };
    }
    if (plan === "pro") {
      return { type: "eigenwelt-pro", confidence: "high", reason: "entitlement" };
    }
    return { type: "eigenwelt-hub", confidence: "high", reason: "entitlement" };
  }

  if (input.connectedProviderIds.some((providerId) => providerId.trim().length > 0)) {
    return { type: "byo", confidence: "medium", reason: "provider" };
  }

  return { type: "unknown", confidence: "low", reason: "unavailable" };
}
