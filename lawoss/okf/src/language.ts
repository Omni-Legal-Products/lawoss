/** Document language is independent of the jurisdiction's machine value (cz/sk). */
export type DocumentLanguage = "cs" | "sk" | "en";
export const DOCUMENT_LANGUAGES: readonly DocumentLanguage[] = ["cs", "sk", "en"];

/** Old callers without either value retain Slovak; a Czech jurisdiction defaults to Czech. */
export function resolveDocumentLanguage(language?: unknown, jurisdiction?: string): DocumentLanguage {
  if (language !== undefined) {
    const selected = DOCUMENT_LANGUAGES.find((value) => value === language);
    if (!selected) throw new Error("language must be cs, sk or en (cz is a jurisdiction, not a language)");
    return selected;
  }
  return jurisdiction === "cz" ? "cs" : "sk";
}
