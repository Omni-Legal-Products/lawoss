import { expect, test } from "bun:test";
import { reviewLibraryLanguage } from "../src/lawoss/i18n/review-library-language";
import { currentLocale, setLocale } from "../src/i18n";

test("upstream prompt catalog fallback does not change the user's UI language", () => {
  const previous = currentLocale();
  try {
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      setLocale(locale);
      expect(reviewLibraryLanguage()).toBe(locale === "de" ? "de" : "en");
      expect(currentLocale()).toBe(locale);
    }
  } finally { setLocale(previous); }
});
