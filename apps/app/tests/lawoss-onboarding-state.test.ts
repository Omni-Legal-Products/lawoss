import { describe, expect, test } from "bun:test";

import {
  DEFAULT_ONBOARDING_PROGRESS,
  readOnboardingProgress,
  writeOnboardingProgress,
  type OnboardingProgress,
} from "../src/lawoss/domains/onboarding/onboarding-state";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

describe("LAWOSS onboarding progress", () => {
  test("uses the recommended welcome step when no progress exists", () => {
    expect(readOnboardingProgress(memoryStorage())).toEqual(DEFAULT_ONBOARDING_PROGRESS);
  });

  test("persists and restores the selected detailed lane and unfinished step", () => {
    const storage = memoryStorage();
    const progress: OnboardingProgress = { lane: "detailed", step: "folder" };

    writeOnboardingProgress(storage, progress);

    expect(readOnboardingProgress(storage)).toEqual(progress);
  });

  test("falls back safely for malformed or unsupported progress", () => {
    const storage = memoryStorage();
    storage.setItem("legalwork.lawoss.onboarding.v1", JSON.stringify({ lane: "surprise", step: 4 }));
    expect(readOnboardingProgress(storage)).toEqual(DEFAULT_ONBOARDING_PROGRESS);

    storage.setItem("legalwork.lawoss.onboarding.v1", "not json");
    expect(readOnboardingProgress(storage)).toEqual(DEFAULT_ONBOARDING_PROGRESS);
  });
});
