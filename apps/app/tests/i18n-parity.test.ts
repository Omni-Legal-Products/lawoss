import { describe, expect, test } from "bun:test";

import en from "../src/i18n/locales/en";
import cs from "../src/i18n/locales/cs";
import sk from "../src/i18n/locales/sk";

const placeholders = (value: string) => (value.match(/\{[a-zA-Z_]+\}/g) ?? []).sort().join(",");
const dictionaries: Record<string, Record<string, string>> = { cs, sk };

describe("lokalizácia sk a cs pokrýva celé rozhranie", () => {
  for (const [lang, dict] of Object.entries(dictionaries)) {
    test(`${lang}: má každý kľúč z en a žiadny navyše`, () => {
      const enKeys = Object.keys(en).sort();
      const keys = Object.keys(dict).sort();
      const missing = enKeys.filter((k) => !(k in dict));
      const extra = keys.filter((k) => !(k in en));
      expect(missing).toEqual([]);
      expect(extra).toEqual([]);
    });
    test(`${lang}: žiadna hodnota nie je prázdna a placeholdery sedia na en`, () => {
      const broken = Object.entries(dict)
        .filter(([k, v]) => !v.trim() || placeholders(v) !== placeholders(en[k as keyof typeof en] ?? ""))
        .map(([k]) => k);
      expect(broken).toEqual([]);
    });
  }
});
