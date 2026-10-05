/**
 * LAWOSS: informácia v kontrole, že rozpoznávanie textu zo skenov je vypnuté, s odkazom
 * do Nastavení → Poskytovatelia AI, kde ho advokát môže zapnúť.
 *
 * Rozhodnutie MČ 5. 10. 2026: model OCR sa nesťahuje automaticky, ani pri prvom použití.
 * Kým je voľba vypnutá, server pripraví dokumenty len z textovej vrstvy a naskenované
 * dokumenty nesú chybu s kódom `[ocr_disabled]` (`apps/server/src/lawoss/ocr-opt-in.ts`).
 * Po výslovnom zapnutí ukáže priebeh prvého stiahnutia modelu, alebo prečo zlyhalo.
 * Stav číta z `/lawoss/ocr` len vtedy, keď kontrola beží alebo má chybu dokumentu.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { t } from "@/i18n";
import { workspaceSettingsRoute } from "@/react-app/shell/workspace-routes";
import { megabytes, OCR_SETTINGS_ANCHOR, OCR_SETTINGS_TAB, type LawossOcrClient } from "../settings/ocr-opt-in";

/** Rýchly model sa inštaluje spolu s modelom rozloženia dokumentu. */
const FIRST_USE_SETUP = new Set(["local-fast", "local-layout"]);
const IN_PROGRESS = new Set(["runtime", "dependencies", "models", "checking"]);

export function OcrDownloadHint({ client, workspaceId, waiting, failed, ocrOff }: {
  client: Pick<LawossOcrClient, "lawossOcr">;
  workspaceId: string;
  /** Kontrola beží alebo pripravuje dokumenty. */
  waiting: boolean;
  /** Niektorý dokument kontroly skončil chybou. */
  failed: boolean;
  /** Niektorý dokument sa pripravil bez OCR, lebo bolo vypnuté. */
  ocrOff: boolean;
}) {
  const enabled = waiting || failed || ocrOff;
  const state = useQuery({
    queryKey: ["lawoss", "ocr-opt-in"],
    queryFn: () => client.lawossOcr(),
    enabled,
    refetchInterval: waiting ? 2000 : false,
    retry: false,
  });
  const view = enabled ? state.data : undefined;
  if (!view) return null;
  if (!view.enabled) {
    if (!ocrOff) return null;
    return <div role="status" className="mb-3 rounded-xl border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
      <p>{t("lawoss.ocr.disabled_hint")}</p>
      <Link className="mt-1 inline-block font-medium text-foreground underline underline-offset-2" to={`${workspaceSettingsRoute(workspaceId, OCR_SETTINGS_TAB)}#${OCR_SETTINGS_ANCHOR}`}>{t("lawoss.ocr.disabled_link")}</Link>
    </div>;
  }
  const installation = view.settings.installation;
  if (!installation || !FIRST_USE_SETUP.has(installation.engineId)) return null;
  if (waiting && IN_PROGRESS.has(installation.stage)) {
    return <p role="status" className="mb-3 rounded-xl border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">{t("lawoss.ocr.downloading", { size: megabytes(view.model.textBytes + view.model.layoutBytes) })}</p>;
  }
  if (failed && installation.stage === "failed") {
    return <p role="alert" className="mb-3 rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">{t("lawoss.ocr.download_failed")}</p>;
  }
  return null;
}
