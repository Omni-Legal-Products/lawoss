import { describe, expect, test } from "bun:test";

import {
  DEFAULT_ONBOARDING_PROGRESS,
  readPendingOnboarding,
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
  test("uses the first native onboarding step when no progress exists", () => {
    expect(readOnboardingProgress(memoryStorage())).toEqual(
      DEFAULT_ONBOARDING_PROGRESS,
    );
  });

  test("persists and restores the selected detailed lane and unfinished step", () => {
    const storage = memoryStorage();
    const progress: OnboardingProgress = { lane: "detailed", step: "client" };

    writeOnboardingProgress(storage, progress);

    expect(readOnboardingProgress(storage)).toEqual(progress);
  });

  test("falls back safely for malformed or unsupported progress", () => {
    const storage = memoryStorage();
    storage.setItem(
      "legalwork.lawoss.onboarding.v1",
      JSON.stringify({ lane: "surprise", step: 4 }),
    );
    expect(readOnboardingProgress(storage)).toEqual(
      DEFAULT_ONBOARDING_PROGRESS,
    );

    storage.setItem("legalwork.lawoss.onboarding.v1", "not json");
    expect(readOnboardingProgress(storage)).toEqual(
      DEFAULT_ONBOARDING_PROGRESS,
    );
  });

  test("rejects malformed persisted preview labels, warnings, and office-memory roots", () => {
    const storage = memoryStorage();
    const pending = {
      request: { action: "office" },
      value: {
        id: "11111111-1111-1111-1111-111111111111",
        fingerprint: "a".repeat(64),
        preview: {
          operations: ["Create Office"],
          label: "Office",
          warnings: ["Existing files remain"],
          officeMemoryRoot: "/Users/lawyer/Office/memory",
        },
      },
    };
    storage.setItem(
      "legalwork.lawoss.onboarding.pending.v1",
      JSON.stringify(pending),
    );
    expect(readPendingOnboarding(storage)).toMatchObject(pending);

    for (const preview of [
      { ...pending.value.preview, label: "" },
      { ...pending.value.preview, warnings: ["ok", 4] },
      {
        ...pending.value.preview,
        officeMemoryRoot: "/Users/lawyer/Office/../outside",
      },
    ]) {
      storage.setItem(
        "legalwork.lawoss.onboarding.pending.v1",
        JSON.stringify({ ...pending, value: { ...pending.value, preview } }),
      );
      expect(readPendingOnboarding(storage)).toBeNull();
    }
  });
});
