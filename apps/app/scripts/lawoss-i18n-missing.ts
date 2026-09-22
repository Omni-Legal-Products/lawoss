/**
 * LAWOSS: výpis chýbajúcich prekladových kľúčov.
 *
 * Predpísané implementačným plánom prekladu (`docs/superpowers/plans/2026-09-11-preklad-sk-cz.md`,
 * úloha 1). Po dokončení prekladu vracia prázdny zoznam — zmysel má ďalej: každý
 * nový upstream reťazec sa tu objaví skôr, než ho používateľ uvidí po anglicky.
 *
 * Spustenie:
 *   bun apps/app/scripts/lawoss-i18n-missing.ts sk
 *   bun apps/app/scripts/lawoss-i18n-missing.ts cs settings mcp
 */

import cs from "../src/i18n/locales/cs";
import en from "../src/i18n/locales/en";
import sk from "../src/i18n/locales/sk";

export type TranslatedLocale = "sk" | "cs";

export type MissingKey = {
  /** Kľúč, ktorý v preklade chýba alebo je prázdny. */
  key: string;
  /** Anglický zdroj — vstup pre prekladateľa. */
  en: string;
};

const LOCALES: Record<TranslatedLocale, Record<string, string>> = { sk, cs };

/** Kategórie množného čísla, ktoré čeština a slovenčina majú navyše oproti angličtine. */
const EXTRA_PLURAL_SUFFIX = /_(few|many)$/;

/**
 * Kľúče, ktoré v danom jazyku chýbajú alebo sú prázdne, s anglickým zdrojom.
 * `prefixes` filtruje podľa menného priestoru (`settings`, `mcp`, …).
 */
export function missingKeys(locale: TranslatedLocale, prefixes?: readonly string[]): MissingKey[] {
  const dictionary = LOCALES[locale];
  const wanted = (key: string) =>
    !prefixes || prefixes.length === 0 || prefixes.some((prefix) => key.startsWith(`${prefix}.`));

  return Object.entries(en)
    .filter(([key]) => wanted(key))
    .filter(([key]) => {
      const value = dictionary[key];
      return typeof value !== "string" || value.trim().length === 0;
    })
    .map(([key, value]) => ({ key, en: String(value) }));
}

/** Kľúče, ktoré preklad má navyše a angličtina ich nepozná (okrem tvarov few/many). */
export function unexpectedKeys(locale: TranslatedLocale): string[] {
  return Object.keys(LOCALES[locale]).filter((key) => {
    if (key in en) return false;
    return !(EXTRA_PLURAL_SUFFIX.test(key) && key.replace(EXTRA_PLURAL_SUFFIX, "_other") in en);
  });
}

if (import.meta.main) {
  const [localeArg, ...prefixes] = process.argv.slice(2);
  const locale: TranslatedLocale = localeArg === "cs" ? "cs" : "sk";
  const rows = missingKeys(locale, prefixes);
  const extra = unexpectedKeys(locale);
  for (const row of rows) console.log(`${row.key}\t${row.en}`);
  console.log(`\n${locale}: chýba ${rows.length} kľúčov${prefixes.length ? ` (filter: ${prefixes.join(", ")})` : ""}, navyše ${extra.length}`);
  if (extra.length > 0) console.log(`navyše: ${extra.slice(0, 10).join(", ")}`);
}
