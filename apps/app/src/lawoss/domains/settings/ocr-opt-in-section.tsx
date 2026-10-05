/** @jsxImportSource react */
/**
 * LAWOSS: prepínač „Rozpoznávanie textu zo skenov (OCR)“ v Nastaveniach → Poskytovatelia AI.
 *
 * Nahrádza v slote `ocrView` upstream sekciu OCR: najprv výslovná voľba s vysvetlením
 * (lokálny model, veľkosť, zdroj, sťahuje sa až po zapnutí), stav a tlačidlá stiahnuť,
 * zrušiť a odstrániť model. Upstream výber modelu a vlastné OCR servery
 * (`OcrSettingsSection`) sa ukážu až pri zapnutej voľbe.
 */
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import type { OcrSettingsView } from "@legalwork/types/ocr";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import type { Language } from "@/i18n";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { SettingsNotice, SettingsStatusBadge } from "@/react-app/domains/settings/settings-section";
import {
  LayoutSection, LayoutSectionDescription, LayoutSectionHeader, LayoutSectionItem, LayoutSectionTitle,
} from "@/react-app/domains/settings/settings-layout";
import { OcrSettingsSection } from "@/react-app/domains/settings/pages/ocr-settings-section";
import { megabytes, OCR_SETTINGS_ANCHOR, type LawossOcrClient, type LawossOcrView } from "./ocr-opt-in";

type Client = LawossOcrClient & Pick<LegalworkServerClient, "getOcrSettings" | "testOcrEngine" | "saveOcrServer" | "setDefaultOcrEngine" | "installOcrEngine" | "cancelOcrInstall" | "removeOcrServer">;
type Stage = NonNullable<OcrSettingsView["installation"]>["stage"];
const ACTIVE: ReadonlySet<Stage> = new Set(["runtime", "dependencies", "models", "checking"]);
const LOCAL_SETUP = new Set(["local-fast", "local-layout"]);
type ModelState = "downloading" | "failed" | "ready" | "partial" | "missing";
const MODEL_LABELS: Record<ModelState, string> = {
  downloading: "lawoss.ocr.model_downloading", failed: "lawoss.ocr.model_failed", ready: "lawoss.ocr.model_ready",
  partial: "lawoss.ocr.model_partial", missing: "lawoss.ocr.model_missing",
};
const STAGE_LABELS: Record<Stage, string> = {
  runtime: "ocr.install_runtime", dependencies: "ocr.install_dependencies", models: "ocr.install_models", checking: "ocr.install_checking",
  complete: "ocr.install_complete", failed: "ocr.install_failed", cancelled: "ocr.install_cancelled",
};
const message = (error: unknown) => error instanceof Error ? error.message : t("ocr.save_error");

/** Stav lokálneho modelu, ako ho vidí advokát. */
export function ocrModelState(view: LawossOcrView): ModelState {
  const { settings } = view;
  const installation = settings.installation;
  if (installation && ACTIVE.has(installation.stage)) return "downloading";
  const fast = settings.engines.find((engine) => engine.id === "local-fast")?.status === "ready";
  const layout = settings.layout?.status === "ready";
  const any = fast || layout || settings.engines.some((engine) => engine.kind === "local" && engine.status === "ready");
  if (installation?.stage === "failed" && LOCAL_SETUP.has(installation.engineId) && !(fast && layout)) return "failed";
  return fast && layout ? "ready" : any ? "partial" : "missing";
}

export function LawossOcrSettings({ client }: { client: Client | null }) {
  const locale = useLocale();
  const [view, setView] = useState<LawossOcrView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const state = view ? ocrModelState(view) : null;

  useEffect(() => {
    let disposed = false;
    setView(null); setError(null);
    if (!client) return;
    client.lawossOcr().then((next) => { if (!disposed) setView(next); }, (failure: unknown) => { if (!disposed) setError(message(failure)); });
    return () => { disposed = true; };
  }, [client]);

  // Odkaz z kontroly (`#lawoss-ocr`) posunie na túto sekciu, keď sa načíta.
  // HashRouter v desktope: fragment je v `useLocation().hash`, nie v `window.location.hash`.
  const { hash } = useLocation();
  const loaded = view !== null;
  useEffect(() => {
    if (loaded && hash === `#${OCR_SETTINGS_ANCHOR}`) document.getElementById(OCR_SETTINGS_ANCHOR)?.scrollIntoView({ block: "start" });
  }, [loaded, hash]);

  useEffect(() => {
    if (!client || state !== "downloading") return;
    const timer = setInterval(() => { client.lawossOcr().then(setView, () => undefined); }, 2500);
    return () => clearInterval(timer);
  }, [client, state]);

  async function update(operation: () => Promise<LawossOcrView>) {
    setBusy(true); setError(null);
    try { setView(await operation()); } catch (failure) { setError(message(failure)); } finally { setBusy(false); }
  }

  return <>
    <OcrOptInPanel view={view} error={error} connected={client !== null} busy={busy} locale={locale} actions={{
      toggle: (enabled) => client && void update(() => client.setLawossOcr(enabled)),
      download: () => client && void update(() => client.downloadLawossOcrModel()),
      cancel: () => client && void update(async () => { await client.cancelOcrInstall(); return client.lawossOcr(); }),
      remove: () => setConfirmRemove(true),
    }} />
    {view?.enabled && client ? <OcrSettingsSection client={client} /> : null}
    <ConfirmModal open={confirmRemove} title={t("lawoss.ocr.remove_title", locale)} message={t("lawoss.ocr.remove_description", locale)} confirmLabel={t("lawoss.ocr.remove", locale)} cancelLabel={t("ocr.cancel", locale)} variant="danger" onCancel={() => setConfirmRemove(false)} onConfirm={() => {
      setConfirmRemove(false);
      if (client) void update(() => client.removeLawossOcrModel());
    }} />
  </>;
}

type PanelActions = { toggle: (enabled: boolean) => void; download: () => void; cancel: () => void; remove: () => void };

/** Sekcia bez stavu: voľba, vysvetlenie, stav modelu a tlačidlá (renderuje sa aj v testoch). */
export function OcrOptInPanel({ view, error, connected, busy, locale, actions }: {
  view: LawossOcrView | null; error: string | null; connected: boolean; busy: boolean; locale: Language; actions: PanelActions;
}) {
  const state = view ? ocrModelState(view) : null;
  const readOnly = view?.settings.readOnly ?? false;
  const disabled = busy || !connected || !view || readOnly;
  const size = view ? megabytes(view.model.textBytes + view.model.layoutBytes) : 0;
  const statusLabel = state ? t(MODEL_LABELS[state], locale) : "";
  const tone = state === "ready" ? "ready" : state === "failed" ? "error" : state === "downloading" ? "warning" : "neutral";
  return <div id={OCR_SETTINGS_ANCHOR} className="scroll-mt-6">
      <LayoutSection>
        <LayoutSectionHeader>
          <LayoutSectionTitle>{t("lawoss.ocr.title", locale)}</LayoutSectionTitle>
          <LayoutSectionDescription>{t("lawoss.ocr.description", locale)}</LayoutSectionDescription>
        </LayoutSectionHeader>
        {!connected ? <SettingsNotice>{t("ocr.no_server", locale)}</SettingsNotice> : null}
        {connected && !view && !error ? <SettingsNotice>{t("ocr.loading", locale)}</SettingsNotice> : null}
        {readOnly ? <SettingsNotice>{t("ocr.read_only", locale)}</SettingsNotice> : null}
        {view ? <LayoutSectionItem>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 space-y-1">
              <p id="lawoss-ocr-switch-label" className="text-sm font-medium">{t("lawoss.ocr.switch", locale)}</p>
              <p className="text-xs text-muted-foreground">{t(view.enabled ? "lawoss.ocr.switch_on" : "lawoss.ocr.switch_off", locale)}</p>
            </div>
            <Switch aria-labelledby="lawoss-ocr-switch-label" checked={view.enabled} disabled={disabled} onCheckedChange={(enabled) => actions.toggle(enabled)} />
          </div>
          <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
            <li>{t("lawoss.ocr.fact_local", locale)}</li>
            <li>{t("lawoss.ocr.fact_size", { size, text: megabytes(view.model.textBytes), layout: megabytes(view.model.layoutBytes), lng: locale })}</li>
            <li>{t("lawoss.ocr.fact_source", { source: view.model.source, lng: locale })}</li>
            <li>{t("lawoss.ocr.fact_off", locale)}</li>
          </ul>
        </LayoutSectionItem> : null}
        {view ? <LayoutSectionItem>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm">{t("lawoss.ocr.model", locale)}</p>
              <SettingsStatusBadge tone={tone} label={statusLabel} className="min-h-6 px-0" />
            </div>
            <div className="flex flex-wrap gap-2">
              {state === "downloading" && view.settings.installation && LOCAL_SETUP.has(view.settings.installation.engineId)
                ? <Button variant="outline" size="sm" disabled={disabled} onClick={actions.cancel}>{t("ocr.cancel", locale)}</Button>
                : null}
              {view.enabled && state !== "ready" && state !== "downloading"
                ? <Button size="sm" disabled={disabled || !view.settings.installerAvailable} onClick={actions.download}>{t(state === "failed" ? "ocr.retry_download" : "lawoss.ocr.download", { size, lng: locale })}</Button>
                : null}
              {state === "ready" || state === "partial" || state === "failed"
                ? <Button variant="outline" size="sm" disabled={disabled} onClick={actions.remove}>{t("lawoss.ocr.remove", locale)}</Button>
                : null}
            </div>
          </div>
          {!view.enabled && state === "missing" ? <p className="text-xs text-muted-foreground">{t("lawoss.ocr.download_after_enable", locale)}</p> : null}
          {!view.enabled && state !== "missing" && state !== "downloading" ? <p className="text-xs text-muted-foreground">{t("lawoss.ocr.model_kept", locale)}</p> : null}
          {state === "downloading" && view.settings.installation ? <p role="status" className="text-xs text-muted-foreground">{t(STAGE_LABELS[view.settings.installation.stage], locale)}</p> : null}
          {state === "failed" ? <p role="alert" className="text-xs text-destructive">{t("ocr.install_failed", locale)}</p> : null}
          {view.enabled && !view.settings.installerAvailable ? <p className="text-xs text-muted-foreground">{t("ocr.installer_missing", locale)}</p> : null}
        </LayoutSectionItem> : null}
        {error ? <SettingsNotice tone="error"><span role="alert">{error}</span></SettingsNotice> : null}
      </LayoutSection>
    </div>
}
