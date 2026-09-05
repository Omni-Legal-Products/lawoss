import { describe, expect, test } from "bun:test";

import {
  MARKETPLACE_CATALOG,
  filterMarketplaceEntries,
  installationPreview,
} from "../src/lawoss/domains/marketplace/catalog";

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

  test("filters combine channel and kind without changing catalog order", () => {
    const result = filterMarketplaceEntries(MARKETPLACE_CATALOG, {
      channel: "stable",
      kind: "mcp",
    });
    const expectedIds = MARKETPLACE_CATALOG
      .filter((entry) => entry.channel === "stable" && entry.kind === "mcp")
      .map((entry) => entry.id);

    expect(result.every((entry) => entry.channel === "stable" && entry.kind === "mcp")).toBe(true);
    expect(result.map((entry) => entry.id)).toEqual(expectedIds);
    expect(result).not.toBe(MARKETPLACE_CATALOG);
  });

  test("an empty filter returns a new copy of the full catalog", () => {
    const result = filterMarketplaceEntries(MARKETPLACE_CATALOG, {});

    expect(result).toEqual(MARKETPLACE_CATALOG);
    expect(result).not.toBe(MARKETPLACE_CATALOG);
  });

  test("installation preview is explicit and never reports installation", () => {
    const entry = MARKETPLACE_CATALOG[0];
    const preview = installationPreview(entry);

    expect(preview.status).toBe("preview-only");
    expect(preview.scope).toContain(entry.install.scope);
    expect(preview.source).toContain(entry.source.repository);
    expect(preview.source).toContain(entry.source.ref);
    expect(preview.capabilities).toEqual(entry.capabilities);
    expect(preview.humanGate).toBe(entry.humanGate);
  });
});

describe("Marketplace page contract", () => {
  test("renders the catalog data and preview language", async () => {
    const source = await Bun.file(
      new URL("../src/lawoss/domains/marketplace/marketplace-page.tsx", import.meta.url),
    ).text();

    expect(source).toContain("MARKETPLACE_CATALOG");
    expect(source).toContain("installationPreview");
    expect(source).toContain("preview-only");
    expect(source).not.toContain("const REGISTRY: RegistryRow[]");
  });
});
