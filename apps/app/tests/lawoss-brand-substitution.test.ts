import { describe, expect, test } from "bun:test";

import { BRAND_EXEMPT_KEYS, applyBrandName, t } from "../src/i18n";

describe("LAWOSS brand substitution", () => {
  test("nahradí meno upstream produktu v preloženom texte", () => {
    expect(t("office_addins.tab_description", "en")).toBe("LAWOSS in Word, Excel, and PowerPoint");
  });

  test("nechá strojové identifikátory na pokoji", () => {
    expect(applyBrandName("legalwork-server is read-only")).toBe("legalwork-server is read-only");
  });

  test("nahradí každý výskyt, nielen prvý", () => {
    expect(applyBrandName("LegalWork and LegalWork")).toBe("LAWOSS and LAWOSS");
  });

  test("kľúče popisujúce upstream dodávateľa si meno ponechajú", () => {
    expect(BRAND_EXEMPT_KEYS.has("mcp.quick_connect_legalmemory_desc")).toBe(true);
    expect(t("mcp.quick_connect_legalmemory_desc", "en")).toContain("LegalWork");
  });
});
