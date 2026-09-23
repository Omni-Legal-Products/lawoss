/**
 * Pôvodné bajty dokumentu a ich kanonická podoba, ako ju vracia MDXEditor.
 * Editor po prvej skutočnej úprave serializuje celý dokument kanonicky
 * (escapovanie `[`, značka odrážky, koncové LF), takže Undo vráti obsah,
 * ale nie pôvodný zdroj (#90).
 */
export type PristineMarkdown = { source: string; normalized: string };

/**
 * V rich-text režime je výstup zhodný s kanonickou podobou nedotknutého
 * dokumentu návratom k originálu — vráti jeho pôvodné bajty. V source a diff
 * režime môže byť rovnaký text úmyselná zmena syntaxe, tam sa nič nemapuje.
 */
export function restorePristineMarkdown(markdown: string, pristine: PristineMarkdown | null, viewMode: string): string {
  if (viewMode !== "rich-text" || !pristine) return markdown;
  return markdown === pristine.normalized ? pristine.source : markdown;
}
