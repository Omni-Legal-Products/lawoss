/**
 * LAWOSS: preklad editora Word podľa jazyka appky (test alfy 10. 11. 2026: menu File/Format/Insert po anglicky).
 * @eigenpal/docx-editor-i18n 1.8.3 nemá slovenčinu ani češtinu; preklady sú v `docx-editor-locales.ts`.
 * Iný jazyk vráti `undefined` a editor ostane pri vlastnej angličtine.
 */
import { docxEditorCs, docxEditorSk } from "./docx-editor-locales";

export function docxEditorLocale(language: string) {
  if (language === "sk") return docxEditorSk;
  if (language === "cs") return docxEditorCs;
  return undefined;
}
