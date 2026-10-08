import { describe, expect, test } from "bun:test";
import {
  MAIN_ONBOARDING_PATH, OKF_NOTICE_VERSION, okfChoice, readOnboardingProgress,
  stepAfterAi, visibleOnboardingStep, visibleOnboardingSteps,
} from "../src/lawoss/domains/onboarding/onboarding-state";

const storage = (value: unknown) => ({ getItem: () => JSON.stringify(value) });

describe("kroky onboardingu cez priečinok", () => {
  test("hlavná cesta má tri kroky", () => {
    expect(MAIN_ONBOARDING_PATH).toEqual(["identity", "ai", "folder"]);
    expect(visibleOnboardingSteps()).toEqual(["identity", "ai", "folder"]);
    expect(stepAfterAi()).toBe("folder");
  });
  test("staré kroky vedú na Priečinok, ostatné ostávajú", () => {
    for (const legacy of ["okf", "office", "packs"] as const) expect(visibleOnboardingStep(legacy)).toBe("folder");
    for (const kept of ["identity", "ai", "folder", "found", "client", "matter", "done"] as const) expect(visibleOnboardingStep(kept)).toBe(kept);
  });
  test("uložené folder v localStorage je nový krok Priečinok", () => {
    expect(readOnboardingProgress(storage({ lane: "detailed", step: "folder" }))).toEqual({ lane: "detailed", step: "folder" });
    expect(readOnboardingProgress(storage({ lane: "detailed", step: "found" }))).toEqual({ lane: "detailed", step: "found" });
  });
  test("potvrdenie OKF nesie novú verziu oznámenia", () => {
    expect(OKF_NOTICE_VERSION).toBe("2026-10-08-priecinok");
    expect(okfChoice(true, new Date("2026-10-08T10:00:00Z"))).toEqual({ enabled: true, acknowledgedAt: "2026-10-08T10:00:00.000Z", noticeVersion: "2026-10-08-priecinok" });
  });
});
