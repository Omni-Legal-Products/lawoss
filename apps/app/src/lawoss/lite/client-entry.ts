/**
 * #424: „Pridať klienta“ v bežnom režime vždy vedie na formulár klienta LAWOSS (`NEW_CLIENT_PATH`), ktorý klienta
 * založí v priečinku klientov pripojenej kancelárie so súbormi OKF. Upstream okno projektu by bez vybraného
 * priečinka založilo projekt v `Documents/LegalWork/Projects`. Režim Pokročilé ostáva pri upstream okne.
 */
import { NEW_CLIENT_PATH } from "./links";
import { currentUiMode, type UiMode } from "./ui-mode";

/** Cesta formulára klienta v bežnom režime, inak `null` (volajúci otvorí upstream okno projektu). */
export function liteClientFormPath(mode: UiMode = currentUiMode()): string | null {
  return mode === "lite" ? NEW_CLIENT_PATH : null;
}
