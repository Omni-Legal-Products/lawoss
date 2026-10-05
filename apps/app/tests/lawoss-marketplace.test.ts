import { describe, expect, test } from "bun:test";

import { MARKETPLACE_CATALOG } from "../src/lawoss/domains/marketplace/catalog";

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
