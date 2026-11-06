import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isSkillHiddenByDefault } from "../src/lawoss/feature-flags";
import { isLegalWorkExtensionHidden, setLegalWorkExtensionHidden } from "../src/react-app/domains/settings/extension-state";

// Nález N-A3-4 (#255): v katalógu integrácií boli anglické balíky lehôt LegalWorku, ktoré server
// zapisuje do globálnej knižnice skillov (`apps/server/src/calendar/skills.ts`).

const deadlineSkillNames = () => {
  const source = readFileSync(join(import.meta.dir, "..", "..", "server", "src", "calendar", "deadline-rules.ts"), "utf8");
  const block = source.slice(source.indexOf("export const DEADLINE_SKILLS"), source.indexOf("export const DeadlineInputSchema"));
  return [...block.matchAll(/\{ name: "([a-z0-9-]+)"/g)].map((match) => match[1]);
};

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

describe("balíky lehôt LegalWorku v katalógu integrácií", () => {
  test("zoznam skrytých drží krok so serverovým DEADLINE_SKILLS", () => {
    const names = deadlineSkillNames();
    expect(names).toEqual(["de-civil-deadlines", "ew-civil-deadlines", "us-federal-civil-deadlines"]);
    for (const name of names) expect(isSkillHiddenByDefault(name)).toBe(true);
    expect(isSkillHiddenByDefault("novy-spis")).toBe(false);
    expect(isSkillHiddenByDefault("workflow-assistant-due-diligence")).toBe(false);
  });

  test("bez voľby advokáta sú skryté, iné skilly nie", () => {
    expect(isLegalWorkExtensionHidden("skill:de-civil-deadlines")).toBe(true);
    expect(isLegalWorkExtensionHidden("skill:us-federal-civil-deadlines")).toBe(true);
    expect(isLegalWorkExtensionHidden("skill:novy-spis")).toBe(false);
    // Rovnaký názov ako MCP alebo balík sa neskryje: platí len pre skilly.
    expect(isLegalWorkExtensionHidden("de-civil-deadlines")).toBe(false);
  });

  test("advokát ich môže odkryť a znova skryť (skrývame, nemažeme)", () => {
    setLegalWorkExtensionHidden("skill:ew-civil-deadlines", false);
    expect(isLegalWorkExtensionHidden("skill:ew-civil-deadlines")).toBe(false);
    setLegalWorkExtensionHidden("skill:ew-civil-deadlines", true);
    expect(isLegalWorkExtensionHidden("skill:ew-civil-deadlines")).toBe(true);
  });
});
