import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { setLegalWorkExtensionHidden, visibleSettingsSkills } from "../src/react-app/domains/settings/extension-state";

// #514: skryté balíky lehôt LegalWorku (N-A3-4, #255) sa ukazovali v Nastavenia → Workflows → Skills,
// hoci katalóg integrácií a ponuka „/“ ich skrývajú. Stránka používa rovnakú voľbu advokáta.

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
};
const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

beforeEach(() => {
  memory.clear();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage, dispatchEvent: () => true } });
});

afterEach(() => {
  if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

const skills = [
  { name: "de-civil-deadlines" },
  { name: "ew-civil-deadlines" },
  { name: "us-federal-civil-deadlines" },
  { name: "slovlex-zbierka-zakonov" },
  { name: "r8-overenie-plnej-moci" },
];

describe("skilly v Nastavenia → Skills (#514)", () => {
  test("bez voľby advokáta sú balíky lehôt skryté, ostatné skilly ostanú v poradí", () => {
    expect(visibleSettingsSkills(skills).map((skill) => skill.name)).toEqual(["slovlex-zbierka-zakonov", "r8-overenie-plnej-moci"]);
  });

  test("skill, ktorý advokát v katalógu odkryl, sa zobrazí aj tu", () => {
    setLegalWorkExtensionHidden("skill:ew-civil-deadlines", false);
    expect(visibleSettingsSkills(skills).map((skill) => skill.name)).toContain("ew-civil-deadlines");
  });

  test("skill, ktorý advokát v katalógu skryl, sa nezobrazí ani tu", () => {
    setLegalWorkExtensionHidden("skill:slovlex-zbierka-zakonov", true);
    expect(visibleSettingsSkills(skills).map((skill) => skill.name)).not.toContain("slovlex-zbierka-zakonov");
  });
});
