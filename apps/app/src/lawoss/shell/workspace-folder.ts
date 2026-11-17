/**
 * #494: priečinok klienta zmizol (presunutý, premenovaný, odpojený disk). Server odpovie 404
 * `project_folder_unavailable` s anglickou vetou. Stav trasy (`use-workspace-route-state.ts`) si chybu priestoru
 * drží ako text; kód v hranatých zátvorkách na konci (ako `[ocr_disabled]`) appke povie, že ide o chýbajúci
 * priečinok, a pri zobrazení ho nahradí preklad s menom klienta (`session-page.tsx`, stavový riadok).
 */
import { LegalworkServerError } from "@/app/lib/legalwork-server";
import { t } from "@/i18n";
import { PROJECT_FOLDER_RECONNECTED_EVENT } from "@/react-app/domains/workspace/project-folder-recovery";

export const FOLDER_UNAVAILABLE_CODE = "project_folder_unavailable";
const TAG = `[${FOLDER_UNAVAILABLE_CODE}]`;

export const isFolderUnavailableError = (error: unknown): boolean =>
  error instanceof LegalworkServerError && error.code === FOLDER_UNAVAILABLE_CODE;

/** Text chyby priestoru na uloženie; chýbajúci priečinok dostane kód, aby ho appka vedela preložiť. */
export function workspaceErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : t("app.unknown_error");
  return isFolderUnavailableError(error) ? `${message} ${TAG}` : message;
}

export const isFolderUnavailableMessage = (message: string | null | undefined): boolean => Boolean(message?.endsWith(TAG));

/** Text pre advokáta: chýbajúci priečinok preložene s menom klienta, iné chyby bez zmeny. */
export const workspaceErrorText = (message: string, name: string): string =>
  isFolderUnavailableMessage(message) ? t("lawoss.lite.folder_missing", { name }) : message;

/**
 * „Skúsiť znova“ na Domove projektu: keď sa všetky dopyty podarili (priečinok je späť), obnoví ostatné dopyty
 * a ohlási obnovený priečinok. Stav trasy potom znova načíta chaty priestoru (zruší jeho chybu, `session-route.tsx`)
 * a pozastavená synchronizácia skupín chatov sa obnoví (`session-group-sync-admission.ts`). Bez toho ostal klient
 * nedostupný až do obnovenia okna.
 */
export async function retryProjectQueries(refetches: readonly (() => Promise<{ error: unknown }>)[], invalidate: () => Promise<void>, events: EventTarget = window): Promise<void> {
  const results = await Promise.all(refetches.map((refetch) => refetch()));
  if (results.some((result) => result.error)) return;
  await invalidate();
  events.dispatchEvent(new Event(PROJECT_FOLDER_RECONNECTED_EVENT));
}

/** Ako často karta chýbajúceho priečinka overí, či je priečinok späť (jeden lacný výpis koreňa klienta). */
export const FOLDER_RETURN_PROBE_MS = 5_000;

/**
 * #494: priečinok klienta je zase dostupný? `probe` je výpis jeho koreňa (404, kým chýba). Keď prejde, obnoví všetky
 * dopyty (aj prehľad praxe, ktorý by klienta inak znova prečítal až o 5–15 min) a ohlási obnovený priečinok, takže
 * stav trasy zruší chybu priestoru a obnoví synchronizáciu chatov – bez obnovenia okna.
 */
export async function recoverFolder(probe: () => Promise<unknown>, queries: { invalidateQueries: () => Promise<unknown> }, events: EventTarget = window): Promise<boolean> {
  try { await probe(); } catch { return false; }
  await queries.invalidateQueries();
  events.dispatchEvent(new Event(PROJECT_FOLDER_RECONNECTED_EVENT));
  return true;
}
