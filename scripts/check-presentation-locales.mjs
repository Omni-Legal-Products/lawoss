/** Bounded checks for app-owned presentation only; never inspect user/source content. */
const LANGUAGES = ["en", "cs", "sk", "de"];
const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort().join(",");
// Deliberately distinctive words, not shared Czech/Slovak vocabulary or character heuristics.
const SLOVAK_COPY = /(?<!\p{L})(?:priečin(?:ok|ka|ku|ky|kov)|súbor(?:y|ov|u)?|používateľ(?:a|ov)?|načítať|zobraziť|skúsiť|uložiť|zrušiť|otvoriť|odstrániť|ďalšie|všetky|nepodarilo sa)(?!\p{L})/iu;

export function presentationLocaleFailures(catalogs) {
  const errors = [];
  for (const [name, locales] of Object.entries(catalogs)) {
    const source = locales.en;
    for (const language of LANGUAGES) {
      const dictionary = locales[language] ?? {};
      for (const [key, english] of Object.entries(source)) {
        const prefix = `${name}.${language}.${key}`;
        const value = dictionary[key];
        if (typeof value !== "string") { errors.push(`${prefix}: missing`); continue; }
        if (!value.trim()) errors.push(`${prefix}: empty`);
        if (placeholders(value) !== placeholders(english)) errors.push(`${prefix}: placeholders differ from English`);
        if (language === "cs" && SLOVAK_COPY.test(value.replace(/\{\w+\}/g, ""))) errors.push(`${prefix}: Slovak copy in Czech presentation`);
      }
      for (const key of Object.keys(dictionary)) {
        // Czech and Slovak add CLDR plural forms beyond English.
        if (!(key in source) && !/_(few|many)$/.test(key)) errors.push(`${name}.${language}.${key}: unknown key`);
      }
    }
  }
  return errors;
}
