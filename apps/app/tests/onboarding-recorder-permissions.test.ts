import { expect, test } from "bun:test";
import type { AudioDictationReadiness } from "@legalwork/types/audio";
import { dictationPermissionsReady, dictationSetupPermissions, onboardingDictationPermissions } from "../src/react-app/domains/onboarding/recorder-permissions";

const ready: AudioDictationReadiness = {
  platform: "darwin", packaged: true, microphone: "granted", inputMonitoring: "granted", accessibility: "granted", automation: "granted",
};

test("unprobed permissions cannot enable Dictate Anywhere", () => {
  expect(dictationPermissionsReady(null)).toBe(false);
  expect(onboardingDictationPermissions(null)).toEqual([]);
});

test("a denied, unrequested or stale native permission still blocks dictation", () => {
  for (const kind of dictationSetupPermissions) {
    expect(dictationPermissionsReady({ ...ready, [kind]: "denied" })).toBe(false);
    expect(dictationPermissionsReady({ ...ready, [kind]: "not-determined" })).toBe(false);
    expect(dictationPermissionsReady({ ...ready, [kind]: "broken" })).toBe(false);
  }
});

test("macOS presents keyboard, paste and automation permissions in order", () => {
  expect(onboardingDictationPermissions(ready)).toEqual(["inputMonitoring", "accessibility", "automation"]);
  expect(dictationPermissionsReady(ready)).toBe(true);
});

test("unavailable probes and platform-specific permissions do not invent extra grants", () => {
  expect(onboardingDictationPermissions({ ...ready, inputMonitoring: "unavailable", automation: "not-required" })).toEqual(["accessibility"]);
  const windows: AudioDictationReadiness = { ...ready, platform: "windows", inputMonitoring: "not-required", accessibility: "not-required", automation: "not-required" };
  expect(onboardingDictationPermissions(windows)).toEqual([]);
  expect(dictationPermissionsReady(windows)).toBe(true);
});
