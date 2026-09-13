import { describe, expect, test } from "bun:test";

import en from "../src/i18n/locales/en";
import cs from "../src/i18n/locales/cs";
import sk from "../src/i18n/locales/sk";
import { applyBrandName, BRAND_EXEMPT_KEYS } from "../src/i18n";

const placeholders = (value: string) => (value.match(/\{[a-zA-Z_]+\}/g) ?? []).sort().join(",");
const dictionaries: Record<string, Record<string, string>> = { cs, sk };

describe("lokalizácia sk a cs pokrýva celé rozhranie", () => {
  for (const [lang, dict] of Object.entries(dictionaries)) {
    test(`${lang}: má každý kľúč z en a žiadny navyše`, () => {
      const enKeys = Object.keys(en).sort();
      const keys = Object.keys(dict).sort();
      const missing = enKeys.filter((k) => !(k in dict));
      // Čeština a slovenčina majú kategórie few a many, ktoré angličtina nemá — tie sú povolené navyše.
      const extra = keys.filter((k) => !(k in en) && !(/_(few|many)$/.test(k) && `${k.replace(/_(few|many)$/, "")}_other` in en));
      expect(missing).toEqual([]);
      expect(extra).toEqual([]);
    });
    test(`${lang}: žiadna hodnota nie je prázdna a placeholdery sedia na en`, () => {
      const broken = Object.entries(dict)
        .filter(([k, v]) => { const base = k.replace(/_(few|many)$/, "_other"); const ref = en[(k in en ? k : base) as keyof typeof en] ?? ""; return !v.trim() || placeholders(v) !== placeholders(ref); })
        .map(([k]) => k);
      expect(broken).toEqual([]);
    });
  }
});

describe("značka sa dosadzuje aj do našich prekladov", () => {
  test("LegalWork v sk a cs hodnotách vyjde ako LAWOSS", () => {
    const withBrand = (dict: Record<string, string>) =>
      Object.entries(dict).filter(([, value]) => value.includes("LegalWork"));
    for (const [lang, dict] of Object.entries(dictionaries)) {
      const rows = withBrand(dict);
      expect(rows.length).toBeGreaterThan(0);
      for (const [key, value] of rows) {
        const rendered = applyBrandName(value);
        if (BRAND_EXEMPT_KEYS.has(key)) continue;
        expect(rendered.includes("LegalWork")).toBe(false);
        expect(rendered.includes("LAWOSS")).toBe(true);
      }
      expect(lang === "sk" || lang === "cs").toBe(true);
    }
  });
});
