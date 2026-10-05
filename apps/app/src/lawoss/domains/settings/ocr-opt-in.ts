/**
 * LAWOSS: voľba „Rozpoznávanie textu zo skenov (OCR)“ (server `apps/server/src/lawoss/ocr-opt-in.ts`).
 *
 * Rozhodnutie MČ 5. 10. 2026: model OCR sa sťahuje len po výslovnom zapnutí. Kým je
 * voľba vypnutá, príprava dokumentov číta len textovú vrstvu a server vracia chybu
 * s kódom `[ocr_disabled]`, ktorú appka nahradí prekladom.
 */
import type { OcrSettingsView } from "@legalwork/types/ocr";
import { t } from "@/i18n";

export type LawossOcrView = {
  enabled: boolean;
  model: { textBytes: number; layoutBytes: number; source: string };
  settings: OcrSettingsView;
};

export type LawossOcrClient = {
  lawossOcr: () => Promise<LawossOcrView>;
  setLawossOcr: (enabled: boolean) => Promise<LawossOcrView>;
  downloadLawossOcrModel: () => Promise<LawossOcrView>;
  removeLawossOcrModel: () => Promise<LawossOcrView>;
};

export const OCR_DISABLED_CODE = "ocr_disabled";
/** Nastavenia, kde sa OCR zapína (záložka „Poskytovatelia AI“, sekcia s kotvou). */
export const OCR_SETTINGS_TAB = "ai";
export const OCR_SETTINGS_ANCHOR = "lawoss-ocr";

export const isOcrDisabledError = (text: string | null | undefined) => Boolean(text?.includes(`[${OCR_DISABLED_CODE}]`));

/** Chyba dokumentu zo servera; vypnuté OCR ukáže preložene, ostatné ponechá. */
export const localizedDocumentError = (text: string) => isOcrDisabledError(text) ? t("lawoss.ocr.disabled_document") : text;

export const megabytes = (bytes: number) => Math.round(bytes / 1_000_000);
