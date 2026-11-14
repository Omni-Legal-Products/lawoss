/**
 * Kam sa vráti zatvorenie Nastavení v bežnom režime (test alfy 14. 11. 2026): na obrazovku, z ktorej advokát Nastavenia
 * otvoril (Dnes, klient, prípad), nie na Domov. Pätka bočného panela si pri každej zmene trasy mimo Nastavení zapamätá
 * cestu s parametrami; zatvorenie (`settings-route.tsx`, 🟡 LAWOSS) ju použije. Len v pamäti, nič sa nečíta ani neukladá.
 * Pokročilý režim sa vracia natívne.
 */
import { currentUiMode, type UiMode } from "./ui-mode";

let last: string | null = null;

/** Trasa Nastavení (aj Nastavenia priečinka `/workspace/<id>/settings`). */
export const isSettingsPath = (pathname: string): boolean => /^(?:\/workspace\/[^/]+)?\/settings(?:\/|$)/.test(pathname);

/** Zapamätá poslednú obrazovku mimo Nastavení; samotné Nastavenia ju neprepíšu. */
export function rememberSettingsReturn(pathname: string, search = ""): void {
  if (!pathname.startsWith("/") || isSettingsPath(pathname)) return;
  last = `${pathname}${search}`;
}

/** Cieľ zatvorenia Nastavení: v bežnom režime posledná obrazovka, inak `null` (natívny návrat). */
export function settingsReturnRoute(mode: UiMode = currentUiMode()): string | null {
  return mode === "lite" ? last : null;
}

/** Len pre testy: nový štart appky. */
export function resetSettingsReturnForTest(): void { last = null; }
