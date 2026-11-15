/**
 * LAWOSS #436: odstránenie pripojenia (registra) v Nastaveniach. Server pri odstránení odpojí pripojenie zo všetkých
 * otvorených klientov a až potom odpovie; všeobecných 10 s klienta nestačilo, dialóg sa vrátil a server dobehol neskôr.
 * Vlastný limit pre túto operáciu a po jeho uplynutí veta, že odstránenie ešte môže prebiehať (nie „zlyhalo“).
 */
import { t } from "@/i18n";

/** Deadline of `DELETE /workspace/:id/mcp/:name` (the server finishes in seconds since #436; the slack covers slow engines). */
export const MCP_REMOVE_TIMEOUT_MS = 180_000;

/** The request passed its deadline, so the server may still finish the removal. */
export function removalMayBeRunning(error: unknown): boolean {
  return error instanceof Error && error.message === t("app.request_timed_out");
}

/**
 * #442: odstránenie spustené z dialógu, ktorý sa hneď zavrie (detail integrácie). Zlyhanie aj odstránenie bežiace po
 * limite sa ukáže ako v ostatných dialógoch odstránenia, namiesto neošetreného odmietnutia promise.
 */
export function reportMcpRemoval(removal: void | false | Promise<void | false>, showError: (message: string) => void): Promise<void> {
  return Promise.resolve(removal).then(
    (result) => { if (result === false) showError(t("mcp.remove_failed")); },
    (error: unknown) => showError(error instanceof Error ? error.message : t("common.something_went_wrong")),
  );
}
