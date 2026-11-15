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
