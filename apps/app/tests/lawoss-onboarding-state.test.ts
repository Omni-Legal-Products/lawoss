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

  test("obnova zachová voľby a pripojených klientov aj pri priečinku na UNC (\\\\nas\\share)", () => {
    const storage = memoryStorage();
    const prax = String.raw`\\nas\share\Klienti`, klient = String.raw`\\nas\share\Klienti\C001 Alfa`;
    const applied = { result: "applied" as const, clientRoot: klient, workspace: { id: "ws_c001", path: klient } };
    const progress: OnboardingProgress = {
      lane: "detailed", step: "ready",
      found: { root: prax, level: "practice", scope: "client", selected: ["C001 Alfa"] },
      connected: { kind: "clients", root: prax, clients: [{ root: klient, name: "C001 Alfa", result: applied }] },
    };
    writeOnboardingProgress(storage, progress);
    expect(readOnboardingProgress(storage)).toEqual(progress);
    // Neúplná UNC cesta (bez zdieľania) a `..` ostávajú odmietnuté.
    for (const root of [String.raw`\\nas`, String.raw`\\nas\share\..\iny`, String.raw`\\\share\x`]) {
      writeOnboardingProgress(storage, { ...progress, connected: { kind: "practice", root } });
      expect(readOnboardingProgress(storage).connected).toBeUndefined();
    }
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

describe("vzatie OKF na vedomie", () => {
  test("zapisuje sa len raz pre aktuálnu verziu oznámenia", async () => {
    const { needsOkfAcknowledgement, okfChoice, OKF_NOTICE_VERSION } = await import("../src/lawoss/domains/onboarding/onboarding-state");
    const profile = { version: 1 as const, lawyerName: "L", jurisdiction: "sk" as const, language: "sk" as const };
    expect(needsOkfAcknowledgement(null)).toBe(true);
    expect(needsOkfAcknowledgement(profile)).toBe(true);
    expect(needsOkfAcknowledgement({ ...profile, okf: { enabled: false } })).toBe(true);
    expect(needsOkfAcknowledgement({ ...profile, okf: { enabled: true, acknowledgedAt: "2026-09-25T10:00:00.000Z", noticeVersion: "2026-09-25" } })).toBe(true);
    expect(needsOkfAcknowledgement({ ...profile, okf: okfChoice(true, new Date("2026-10-08T10:00:00Z")) })).toBe(false);
    expect(OKF_NOTICE_VERSION).toBe("2026-10-08-priecinok");
  });
});
