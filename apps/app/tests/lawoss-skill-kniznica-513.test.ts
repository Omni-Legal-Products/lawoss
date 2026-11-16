import { describe, expect, test } from "bun:test";
import sk from "../src/i18n/locales/sk";
import cs from "../src/i18n/locales/cs";

// #513: pracovný priestor je v LAWOSS jeden klient, skill je však v globálnej knižnici profilu.
// Vytvorenie aj odinštalovanie skillu preto platí pre všetkých klientov a text to musí povedať.
const KEYS = ["skills.new_skill_desc", "skills.uninstall_warning"] as const;
const dicts: Record<string, Record<string, string>> = { sk, cs };

describe("texty o rozsahu skillu (#513)", () => {
  for (const [lang, dict] of Object.entries(dicts)) {
    for (const key of KEYS) {
      test(`${lang} ${key} hovorí o knižnici pre všetkých klientov, nie o pracovnom priestore`, () => {
        const value = dict[key] ?? "";
        expect(value).not.toMatch(/pracovn(ého|ího) (priestoru|prostoru)/u);
        expect(value).toMatch(lang === "sk" ? /knižnic.*všetkých klientov/u : /knihovn.*všech klientů/u);
      });
    }
  }
});
