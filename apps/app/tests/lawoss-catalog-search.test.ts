import { describe, expect, test } from "bun:test";
import { filterCatalogEntries } from "../src/lawoss/domains/marketplace/catalog-search";
import { installFailureMessage } from "../src/lawoss/domains/marketplace/use-lawoss-marketplace";

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
    const unreachable = Object.assign(new Error("serverova sprava"), { code: "plugin_source_unreachable" });
    expect(installFailureMessage(unreachable)).not.toContain("serverova sprava");
    expect(installFailureMessage(new Error("Iná chyba"))).toBe("Iná chyba");
  });
});
