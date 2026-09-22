import { describe, expect, test } from "bun:test";

import {
  aiRegimeNeedsClientConsent,
  aiRegimeNeedsDpa,
  detectSubscriptionType,
  normalizeAiDataRegime,
  type AiDataRegime,
} from "../src/lawoss/domains/ai-guidance/ai-guidance-state";

describe("LAWOSS AI guidance state", () => {
  test("accepts only the three governed data regimes", () => {
    const regimes: Array<AiDataRegime | null> = ["local", "dpa", "consent", null];

    expect(regimes.map((value) => normalizeAiDataRegime(value))).toEqual(regimes);
    expect(normalizeAiDataRegime("provider")).toBeNull();
    expect(normalizeAiDataRegime({ regime: "dpa" })).toBeNull();
  });

  test("marks only the DPA regime as requiring a DPA review", () => {
    expect(aiRegimeNeedsDpa("local")).toBe(false);
    expect(aiRegimeNeedsDpa("dpa")).toBe(true);
    expect(aiRegimeNeedsDpa("consent")).toBe(false);
  });

  test("marks only the consent regime as requiring explicit client consent", () => {
    expect(aiRegimeNeedsClientConsent("local")).toBe(false);
    expect(aiRegimeNeedsClientConsent("dpa")).toBe(false);
    expect(aiRegimeNeedsClientConsent("consent")).toBe(true);
  });

  test("detects active Eigenwelt plans before considering BYO providers", () => {
    expect(
      detectSubscriptionType({
        eigenweltConnected: true,
        plan: "pro",
        subscriptionStatus: "active",
        premiumModels: true,
        connectedProviderIds: ["openai"],
      }),
    ).toMatchObject({ type: "eigenwelt-pro", confidence: "high" });

    expect(
      detectSubscriptionType({
        eigenweltConnected: true,
        plan: "hub",
        subscriptionStatus: "active",
        premiumModels: false,
        connectedProviderIds: [],
      }),
    ).toMatchObject({ type: "eigenwelt-hub", confidence: "high" });
  });

  test("does not call an unknown Eigenwelt payload a paid plan", () => {
    expect(
      detectSubscriptionType({
        eigenweltConnected: true,
        plan: "plus",
        subscriptionStatus: "canceled",
        premiumModels: false,
        connectedProviderIds: [],
      }),
    ).toMatchObject({ type: "unknown", confidence: "low" });
  });

  test("falls back to BYO or unknown without making a compliance claim", () => {
    expect(
      detectSubscriptionType({
        eigenweltConnected: false,
        plan: null,
        subscriptionStatus: null,
        premiumModels: false,
        connectedProviderIds: ["openai"],
      }),
    ).toMatchObject({ type: "byo", confidence: "medium" });

    expect(
      detectSubscriptionType({
        eigenweltConnected: true,
        plan: null,
        subscriptionStatus: null,
        premiumModels: false,
        connectedProviderIds: [],
      }),
    ).toMatchObject({ type: "unknown", confidence: "low" });
  });
});
