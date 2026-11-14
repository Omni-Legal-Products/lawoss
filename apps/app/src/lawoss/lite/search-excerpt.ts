/**
 * Úryvok výsledku hľadania (⌘K) bez značiek markdownu (test alfy 14. 11. 2026: „**27. novembra 2026**“). Úryvok je
 * vystrihnuté okno textu, preto sa zahodí aj osamotené `**` na jeho okraji. Podčiarkovníky ostávajú (`_STATUS.md`,
 * `00_Na_zatriedenie`), rovnako hviezdička, ktorá nie je zvýraznením („5 * 3“). Len zobrazenie, v bežnom režime.
 */
import { currentUiMode, type UiMode } from "./ui-mode";

export function plainSearchExcerpt(text: string, mode: UiMode = currentUiMode()): string {
  if (mode !== "lite") return text;
  return text
    .replace(/!?\[([^\]\n]*)\]\([^)\s]*\)/g, "$1")
    .replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/(^|[\s(„"'])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?=$|[\s.,;:!?)“"'])/g, "$1$2")
    .replace(/`+([^`\n]*?)`+/g, "$1")
    .replace(/(^|\s)#{1,6}\s+/g, "$1");
}
