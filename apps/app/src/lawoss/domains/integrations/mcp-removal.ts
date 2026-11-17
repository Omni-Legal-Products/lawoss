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
 * #442: a removal started from a dialog that closes at once (directory detail of a connection). The store throws
 * `remove_pending` past the deadline and returns `false` on other failures; neither may become an unhandled rejection
 * the lawyer never sees. The message goes to `report` (a toast), which outlives the dialog.
 */
export async function settleMcpRemoval(removal: void | Promise<void | false>, report: (message: string) => void): Promise<void> {
  try {
    if (await removal === false) report(t("mcp.remove_failed"));
  } catch (error) {
    report(error instanceof Error && error.message ? error.message : t("mcp.remove_failed"));
  }
}
