import { describe, expect, test } from "bun:test";

import {
  resolveAutogramCardAction,
  shouldShowAutogramCard,
} from "../src/lawoss/domains/integrations/autogram-status";

describe("LAWOSS Autogram karta — viditeľnosť", () => {
  test("zobrazí sa iba na desktop Electron behu na macOS", () => {
    expect(shouldShowAutogramCard({ desktopRuntime: true, isMac: true })).toBe(true);
  });

  test("skryje sa mimo desktop runtime", () => {
    expect(shouldShowAutogramCard({ desktopRuntime: false, isMac: true })).toBe(false);
  });

  test("skryje sa mimo macOS (napr. Windows desktop)", () => {
    expect(shouldShowAutogramCard({ desktopRuntime: true, isMac: false })).toBe(false);
  });
});

describe("LAWOSS Autogram karta — akcia podľa detekcie", () => {
  test("nainštalovaný Autogram ponúkne otvorenie", () => {
    expect(resolveAutogramCardAction({ installed: true, path: "/Applications/Autogram.app" })).toBe("open");
  });

  test("chýbajúci Autogram ponúkne stiahnutie", () => {
    expect(resolveAutogramCardAction({ installed: false, path: null })).toBe("download");
  });

  test("bez odpovede (ešte nenačítané) predvolene ponúkne stiahnutie", () => {
    expect(resolveAutogramCardAction(undefined)).toBe("download");
    expect(resolveAutogramCardAction(null)).toBe("download");
  });
});
