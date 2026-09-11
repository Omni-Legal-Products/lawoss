import { describe, expect, test } from "bun:test";

import {
  resolveAutogramCardAction,
  resolveAutogramStatusLine,
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

  test("bez odpovede (ešte nenačítané, alebo zlyhaný dopyt) predvolene ponúkne stiahnutie", () => {
    expect(resolveAutogramCardAction(undefined)).toBe("download");
    expect(resolveAutogramCardAction(null)).toBe("download");
  });
});

describe("LAWOSS Autogram karta — text stavového riadku", () => {
  test("počas načítavania hlási loading", () => {
    expect(resolveAutogramStatusLine({ isPending: true, isError: false, installed: undefined })).toBe(
      "loading",
    );
  });

  test("keď dopyt zlyhá (napr. most nedostupný), hlási chybu zisťovania — nie chýbajúcu appku", () => {
    expect(resolveAutogramStatusLine({ isPending: false, isError: true, installed: undefined })).toBe(
      "error",
    );
  });

  test("úspešný dopyt s nájdenou appkou hlási installed", () => {
    expect(resolveAutogramStatusLine({ isPending: false, isError: false, installed: true })).toBe(
      "installed",
    );
  });

  test("úspešný dopyt bez nájdenej appky hlási not_installed", () => {
    expect(resolveAutogramStatusLine({ isPending: false, isError: false, installed: false })).toBe(
      "not_installed",
    );
  });
});
