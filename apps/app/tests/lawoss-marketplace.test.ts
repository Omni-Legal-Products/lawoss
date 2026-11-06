import { describe, expect, test } from "bun:test";

import { getMarketplaceCatalog, MARKETPLACE_CATALOG } from "../src/lawoss/domains/marketplace/catalog";

describe("LAWOSS marketplace catalog", () => {
  test("catalog entries have unique IDs and valid ISO verification dates", () => {
    const ids = MARKETPLACE_CATALOG.map((entry) => entry.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of MARKETPLACE_CATALOG) {
      expect(entry.verification.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.source.repository.length).toBeGreaterThan(0);
      expect(entry.source.ref.length).toBeGreaterThan(0);
      expect(entry.humanGate.length).toBeGreaterThan(0);
    }
  });
});

// N6 (test alfa10, 6. 11. 2026): appka Node.js aj npm pribaľuje; plán inštalácie ich nesmie pýtať od advokáta.
test("plán inštalácie nepýta Node.js ani npm v žiadnom jazyku", () => {
  for (const locale of ["sk", "cs", "en", "de"] as const) {
    const plugins = getMarketplaceCatalog(locale).filter((entry) => entry.install.action === "plugin" && entry.kind === "plugin");
    expect(plugins.length).toBeGreaterThan(0);
    for (const entry of plugins) {
      expect(entry.dependencies.join(" ")).not.toMatch(/node|npm/i);
      expect(entry.dependencies).toHaveLength(1);
    }
  }
  for (const entry of MARKETPLACE_CATALOG) expect(entry.dependencies.join(" ")).not.toMatch(/node|npm/i);
  expect(MARKETPLACE_CATALOG.find((entry) => entry.install.action === "okf")?.dependencies).toEqual([]);
});
