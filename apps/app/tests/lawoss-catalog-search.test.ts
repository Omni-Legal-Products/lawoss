import { describe, expect, test } from "bun:test";
import { filterCatalogEntries } from "../src/lawoss/domains/marketplace/catalog-search";
import { installFailureMessage, installGlobalEntries } from "../src/lawoss/domains/marketplace/use-lawoss-marketplace";
import { LegalworkServerError } from "../src/app/lib/legalwork-server";
import { MARKETPLACE_CATALOG } from "../src/lawoss/domains/marketplace/catalog";

const entries = [
  { name: "Register úpadcov", description: "Konkurzy a reštrukturalizácie" },
  { name: "Slov-Lex", description: "Zbierka zákonov" },
];

describe("hľadanie v katalógu (N12)", () => {
  test("nájde podľa časti slova, s diakritikou aj bez nej", () => {
    expect(filterCatalogEntries(entries, "úpadc").map((e) => e.name)).toEqual(["Register úpadcov"]);
    expect(filterCatalogEntries(entries, "UPADC").map((e) => e.name)).toEqual(["Register úpadcov"]);
  });
  test("prehľadáva popis a všetky slová dopytu", () => {
    expect(filterCatalogEntries(entries, "zbierka lex").map((e) => e.name)).toEqual(["Slov-Lex"]);
    expect(filterCatalogEntries(entries, "zbierka úpadcov")).toEqual([]);
  });
  test("prázdny dopyt nechá všetko", () => {
    expect(filterCatalogEntries(entries, "  ")).toEqual(entries);
  });
});

describe("chyba inštalácie (N7)", () => {
  test("výpadok zdroja má vlastný text, ostatné chyby ostávajú", () => {
    const unreachable = new LegalworkServerError(503, "plugin_source_unreachable", "serverova sprava");
    expect(installFailureMessage(unreachable)).not.toContain("serverova sprava");
    expect(installFailureMessage(new Error("Iná chyba"))).toBe("Iná chyba");
  });
});

describe("balík pri výpadku zdroja (N7)", () => {
  test("po prvom výpadku sa zvyšné doplnky neskúšajú a dostanú tú istú radu", async () => {
    const calls: string[] = [];
    const api = { install: async (url: string) => { calls.push(url); throw new LegalworkServerError(503, "plugin_source_unreachable", "x"); } };
    const entries = MARKETPLACE_CATALOG.filter((entry) => entry.install.action === "plugin").slice(0, 3);
    expect(entries).toHaveLength(3);
    const result = await installGlobalEntries(api as never, entries);
    expect(calls).toHaveLength(1);
    expect(result.failed.map((f) => f.id)).toEqual(entries.map((e) => e.id));
    expect(new Set(result.failed.map((f) => f.message)).size).toBe(1);
  });
});
