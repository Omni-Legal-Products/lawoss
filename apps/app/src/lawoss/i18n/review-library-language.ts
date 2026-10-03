import { currentLocale, type Language } from "@/i18n";

/** Upstream prompt catalogs currently ship only English and German content. */
export function reviewLibraryLanguage(locale: Language = currentLocale()): "en" | "de" {
  return locale === "de" ? "de" : "en";
}
