import { describe, expect, test } from "bun:test";
import {
  MAIN_ONBOARDING_PATH, OKF_NOTICE_VERSION, okfChoice, readOnboardingProgress,
  stepAfterAi, visibleOnboardingStep, visibleOnboardingSteps,
} from "../src/lawoss/domains/onboarding/onboarding-state";

const storage = (value: unknown) => ({ getItem: () => JSON.stringify(value) });

describe("kroky onboardingu cez priečinok", () => {
  test("hlavná cesta má šesť krokov sprievodcu (C1): priečinok pred AI, potom schvaľovanie a Pripravené", () => {
    expect(MAIN_ONBOARDING_PATH).toEqual(["identity", "folder", "found", "ai", "approvals", "ready"]);
    expect(visibleOnboardingSteps()).toEqual(["identity", "folder", "found", "ai", "approvals", "ready"]);
    expect(stepAfterAi()).toBe("approvals");
  });
  test("staré kroky vedú na Priečinok, ostatné ostávajú", () => {
    for (const legacy of ["okf", "office", "packs"] as const) expect(visibleOnboardingStep(legacy)).toBe("folder");
    for (const kept of ["identity", "ai", "folder", "found", "approvals", "ready", "client", "matter", "done"] as const) expect(visibleOnboardingStep(kept)).toBe(kept);
  });
  test("bez profilu na serveri začína tok identitou bez ohľadu na localStorage (#147)", () => {
    for (const saved of ["ai", "folder", "found", "okf", "matter", "done"] as const) expect(visibleOnboardingStep(saved, false)).toBe("identity");
  });
  test("uložené folder v localStorage je nový krok Priečinok", () => {
    expect(readOnboardingProgress(storage({ lane: "detailed", step: "folder" }))).toEqual({ lane: "detailed", step: "folder" });
    expect(readOnboardingProgress(storage({ lane: "detailed", step: "found" }))).toEqual({ lane: "detailed", step: "found" });
    expect(readOnboardingProgress(storage({ lane: "detailed", step: "approvals" }))).toEqual({ lane: "detailed", step: "approvals" });
    expect(readOnboardingProgress(storage({ lane: "detailed", step: "ready" }))).toEqual({ lane: "detailed", step: "ready" });
  });
  test("potvrdenie OKF nesie novú verziu oznámenia", () => {
    expect(OKF_NOTICE_VERSION).toBe("2026-10-08-priecinok");
    expect(okfChoice(true, new Date("2026-10-08T10:00:00Z"))).toEqual({ enabled: true, acknowledgedAt: "2026-10-08T10:00:00.000Z", noticeVersion: "2026-10-08-priecinok" });
  });
});
