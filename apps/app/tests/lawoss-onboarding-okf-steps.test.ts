import { describe, expect, test } from "bun:test";

import {
  OKF_NOTICE_VERSION,
  okfChoice,
  readOnboardingProgress,
  stepAfterAi,
  visibleOnboardingStep,
  visibleOnboardingSteps,
} from "../src/lawoss/domains/onboarding/onboarding-state";

describe("OKF choice in the LAWOSS welcome flow", () => {
  test("the visible path follows the choice", () => {
    expect(visibleOnboardingSteps(undefined)).toEqual(["identity", "okf"]);
    expect(visibleOnboardingSteps(true)).toEqual(["identity", "okf", "office", "ai", "client", "matter"]);
    expect(visibleOnboardingSteps(false)).toEqual(["identity", "okf", "ai"]);
  });

  test("the AI step finishes without OKF and continues to the client with OKF", () => {
    expect(stepAfterAi(true)).toBe("client");
    expect(stepAfterAi(false)).toBe("done");
    expect(stepAfterAi(undefined)).toBe("okf");
  });

  test("a step outside the chosen path falls back to the OKF choice", () => {
    expect(visibleOnboardingStep("client", false)).toBe("okf");
    expect(visibleOnboardingStep("matter", undefined)).toBe("okf");
    expect(visibleOnboardingStep("office", false)).toBe("okf");
    expect(visibleOnboardingStep("matter", true)).toBe("matter");
    expect(visibleOnboardingStep("ai", false)).toBe("ai");
    expect(visibleOnboardingStep("identity", undefined)).toBe("identity");
    expect(visibleOnboardingStep("done", false)).toBe("done");
  });

  test("enabling records a versioned acknowledgement, declining records none", () => {
    expect(okfChoice(true, new Date("2026-10-04T10:00:00.000Z"))).toEqual({
      enabled: true,
      acknowledgedAt: "2026-10-04T10:00:00.000Z",
      noticeVersion: "2026-10-04-alfa-1",
    });
    expect(okfChoice(false, new Date())).toEqual({ enabled: false });
    expect(OKF_NOTICE_VERSION).toBe("2026-10-04-alfa-1");
  });

  test("saved progress accepts the okf step", () => {
    const storage = { getItem: () => JSON.stringify({ lane: "detailed", step: "okf" }) };
    expect(readOnboardingProgress(storage)).toEqual({ lane: "detailed", step: "okf" });
  });
});
