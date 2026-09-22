import { typeLabel, valueLabel, type Jurisdiction, type RecordType } from "./schema.ts";

/** Document language is presentation metadata, never a legal jurisdiction. */
export type DocumentLanguage = "cs" | "sk" | "en";
export type RenderLanguage = Jurisdiction | "en";

export function isDocumentLanguage(value: unknown): value is DocumentLanguage {
  return value === "cs" || value === "sk" || value === "en";
}

export function renderLanguage(language: DocumentLanguage | undefined, jurisdiction: Jurisdiction): RenderLanguage {
  return language === "cs" ? "cz" : language ?? jurisdiction;
}

export function documentTypeLabel(type: RecordType, language: RenderLanguage): string {
  return language === "en" ? type : typeLabel(type, language);
}

export function documentValueLabel(field: string, value: string, language: RenderLanguage): string {
  if (language !== "en") return valueLabel(field, value, language);
  // Stored enum values are canonical English; source text and unknown values stay intact.
  const label = valueLabel(field, value, "cz");
  return label === value ? value : value.replaceAll("_", " ");
}
