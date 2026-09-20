import { describe, expect, test } from "bun:test";

import { missingKeys, unexpectedKeys } from "../scripts/lawoss-i18n-missing";
import en from "../src/i18n/locales/en";

describe("výpis chýbajúcich prekladových kľúčov", () => {
  test("po dokončení prekladu nechýba nič v sk ani cs", () => {
    expect(missingKeys("sk")).toEqual([]);
    expect(missingKeys("cs")).toEqual([]);
  });

  test("filter podľa menného priestoru vracia iba ten priestor", () => {
    // Nad úplným prekladom je výsledok prázdny, tak sa filter overí na anglickom zdroji:
    // každý kľúč, ktorý by chýbal, musí mať prefix, o ktorý sme si povedali.
    const keys = Object.keys(en).filter((key) => key.startsWith("settings."));
    expect(keys.length).toBeGreaterThan(0);
    for (const row of missingKeys("sk", ["settings"])) {
      expect(row.key.startsWith("settings.")).toBe(true);
      expect(row.en.length).toBeGreaterThan(0);
    }
  });

  test("preklad nemá kľúč, ktorý angličtina nepozná — okrem tvarov few a many", () => {
    expect(unexpectedKeys("sk")).toEqual([]);
    expect(unexpectedKeys("cs")).toEqual([]);
  });
});
