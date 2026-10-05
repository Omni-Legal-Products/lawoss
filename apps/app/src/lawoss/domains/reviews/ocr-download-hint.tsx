/**
 * LAWOSS: oznam pre advokáta, keď kontrola čaká na prvé stiahnutie modelu
 * rozpoznávania textu, alebo keď sa stiahnuť nepodarilo.
 *
 * Server sťahuje model až pri prvom použití (`apps/server/src/lawoss/ocr-on-demand.ts`),
 * nikdy pri štarte. Stav sťahovania číta z `/ocr/settings` len vtedy, keď kontrola
 * beží alebo má chybu dokumentu.
 */
import { useQuery } from "@tanstack/react-query";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { t } from "@/i18n";

/** Rýchly model PP-OCRv6 small (`smallModelAssets` v `apps/server/src/ocr/models.ts`). */
const SMALL_MODEL_BYTES = 31_190_469;
/** Rýchly model sa inštaluje spolu s modelom rozloženia dokumentu. */
const FIRST_USE_SETUP = new Set(["local-fast", "local-layout"]);
const IN_PROGRESS = new Set(["runtime", "dependencies", "models", "checking"]);

export function OcrDownloadHint({ client, waiting, failed }: {
  client: Pick<LegalworkServerClient, "getOcrSettings">;
  /** Kontrola beží alebo pripravuje dokumenty. */
  waiting: boolean;
  /** Niektorý dokument kontroly skončil chybou. */
  failed: boolean;
}) {
  const enabled = waiting || failed;
  const settings = useQuery({
    queryKey: ["lawoss", "ocr-first-use"],
    queryFn: () => client.getOcrSettings(),
    enabled,
    refetchInterval: waiting ? 2000 : false,
    retry: false,
  });
  const installation = enabled ? settings.data?.installation : null;
  if (!installation || !FIRST_USE_SETUP.has(installation.engineId)) return null;
  if (waiting && IN_PROGRESS.has(installation.stage)) {
    const size = Math.round((SMALL_MODEL_BYTES + (settings.data?.layout?.bytes ?? 0)) / 1_000_000);
    return <p role="status" className="mb-3 rounded-xl border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">{t("lawoss.ocr.downloading", { size })}</p>;
  }
  if (failed && installation.stage === "failed") {
    return <p role="alert" className="mb-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">{t("lawoss.ocr.download_failed")}</p>;
  }
  return null;
}
