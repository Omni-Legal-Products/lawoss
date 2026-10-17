import { currentLocale } from "@/i18n";

/**
 * Jazyk upstream šablón metadát projektu (#268) a ich polí. Upstream pozná len
 * angličtinu a nemčinu; slovenské a české rozhranie dostane anglickú šablónu,
 * kým nebudú SK a CS šablóny (popisky sa dajú upraviť ako vlastné).
 */
export function currentTemplateLocale(): "en" | "de" {
  return currentLocale() === "de" ? "de" : "en";
}
