// LAWOSS #563: panel Spracovanie dokumentov opakoval každých 5 s dotaz, ktorý trvalo končil 409.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LegalworkServerError } from "../src/app/lib/legalwork-server";
import { profilesRefetchInterval, profilesRetry } from "../src/lawoss/domains/documents/profile-polling";

const unsupported = new LegalworkServerError(409, "protected_ai_provider_unsupported", "Select a configured OpenAI-compatible provider and model.");
const transient = new LegalworkServerError(503, "engine_unavailable", "Engine is starting.");

test("trvalá odpoveď „poskytovateľ nepodporovaný“ sa neopakuje", () => {
  expect(profilesRefetchInterval(true, unsupported)).toBe(false);
  expect(profilesRetry(0, unsupported)).toBe(false);
});

test("bez chyby a pri prechodnej chybe sa panel obnovuje ako doteraz", () => {
  expect(profilesRefetchInterval(true, null)).toBe(5000);
  expect(profilesRefetchInterval(true, transient)).toBe(5000);
  expect(profilesRefetchInterval(false, null)).toBe(false);
  expect(profilesRetry(0, transient)).toBe(true);
  expect(profilesRetry(3, transient)).toBe(false);
});

test("panel používa toto pravidlo", () => {
  const source = readFileSync(new URL("../src/react-app/domains/session/panel/document-processing-panel.tsx", import.meta.url), "utf8");
  expect(source).toContain("profilesRefetchInterval(props.active");
  expect(source).toContain("retry: profilesRetry");
});
