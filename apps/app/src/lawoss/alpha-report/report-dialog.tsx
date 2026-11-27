/** @jsxImportSource react */
/**
 * LAWOSS: okno „Nahlásiť chybu alebo nápad“. Otvára sa z bočného panela, z menu Pomocník a z chybovej obrazovky
 * pri štarte; hostiteľ je v `shell/providers.tsx` a kreslí sa nad štartovacím prekryvom (z-[1000]).
 */
import { ShieldAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { DesktopCommandResult } from "@legalwork/types/desktop-ipc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { desktopBridge, openDesktopUrl } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { feedbackPageUrl } from "@/lawoss/lite/sidebar-model";
import {
  REPORT_KINDS, REPORT_REPEATS, REPORT_SEVERITIES, canSubmitReport, formatReportBytes, initialReportForm, reportErrorKey, toReport,
  type ReportForm,
} from "./model";
import { ALPHA_REPORT_OPEN_EVENT, alphaReportStore, closeAlphaReport, openAlphaReport, type AlphaReportSession } from "./store";

type Preview = DesktopCommandResult<"lawossAlphaReportPreview">;
type PreviewState = { status: "idle" } | { status: "loading" } | { status: "failed" } | { status: "ready"; preview: Preview };
type SendState = { status: "editing" } | { status: "sending" } | { status: "failed"; code: string } | { status: "saved"; path: string };

/** Otvorí okno hlásenia; v prehliadači (mimo desktopu) webový formulár. Volá bočný panel aj chybová obrazovka. */
export async function requestAlphaReport(locale: Language): Promise<void> {
  const result = await openAlphaReport({
    desktop: isDesktopRuntime(),
    prepare: () => desktopBridge.lawossAlphaReportPrepare(),
    openWeb: () => isDesktopRuntime() ? desktopBridge.lawossAlphaReportOpenWeb() : openDesktopUrl(feedbackPageUrl(locale)),
  });
  if (result === "web") toast.success(t("lawoss.lite.report_opened", locale, { url: feedbackPageUrl(locale).replace(/^https?:\/\//, "") }));
  if (result === "failed") toast.error(t("lawoss.lite.report_failed", locale, { url: feedbackPageUrl(locale).replace(/^https?:\/\//, "") }));
}

export function AlphaReportHost() {
  const locale = useLocale();
  useEffect(() => alphaReportStore.attachHost(), []);
  useEffect(() => {
    const open = () => { void requestAlphaReport(locale); };
    window.addEventListener(ALPHA_REPORT_OPEN_EVENT, open);
    return () => window.removeEventListener(ALPHA_REPORT_OPEN_EVENT, open);
  }, [locale]);
  const session = useSyncExternalStore(alphaReportStore.subscribe, alphaReportStore.snapshot, alphaReportStore.snapshot);
  if (!session) return null;
  return <AlphaReportDialog key={session.id} session={session} locale={locale} />;
}

function Choice<T extends string>(props: { label: string; value: T | ""; options: readonly T[]; text: (value: T) => string; onChange: (value: T) => void; name: string }) {
  const labelId = useId();
  return (
    <div className="grid gap-2">
      <div id={labelId} className="text-[13px] font-medium">{props.label}</div>
      <RadioGroup aria-labelledby={labelId} className="flex flex-wrap gap-x-4 gap-y-2" value={props.value}
        onValueChange={(value) => { const next = props.options.find((option) => option === value); if (next) props.onChange(next); }}>
        {props.options.map((option) => (
          <label key={option} className="flex cursor-pointer items-center gap-2 text-[13px]" data-lawoss-report-option={`${props.name}:${option}`}>
            <RadioGroupItem value={option} />
            {props.text(option)}
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

function AlphaReportDialog({ session, locale }: { session: AlphaReportSession; locale: Language }) {
  const [form, setForm] = useState<ReportForm>(initialReportForm);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [showPreview, setShowPreview] = useState(false);
  const [send, setSend] = useState<SendState>({ status: "editing" });
  const outcomeRef = useRef<HTMLDivElement>(null);
  // Výsledok (chyba, uložené hlásenie) je na konci formulára; posunie sa do zorného poľa.
  useEffect(() => { if (send.status === "failed" || send.status === "saved") outcomeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [send]);
  const ids = { what: useId(), outcome: useId(), contact: useId(), shot: useId(), diag: useId() };
  const set = <K extends keyof ReportForm>(key: K, value: ReportForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (send.status === "failed" || send.status === "saved") setSend({ status: "editing" });
  };
  const bug = form.kind === "chyba";
  const busy = send.status === "sending";
  const close = () => { if (!busy) closeAlphaReport((id) => desktopBridge.lawossAlphaReportDiscard({ id })); };

  const loadPreview = async () => {
    setShowPreview(true);
    if (preview.status === "ready" || preview.status === "loading") return;
    setPreview({ status: "loading" });
    try { setPreview({ status: "ready", preview: await desktopBridge.lawossAlphaReportPreview({ id: session.id }) }); }
    catch { setPreview({ status: "failed" }); }
  };

  const submit = async () => {
    if (!canSubmitReport(form) || busy) return;
    setSend({ status: "sending" });
    try {
      const result = await desktopBridge.lawossAlphaReportSubmit({ id: session.id, report: toReport(form) });
      if (result.ok) {
        toast.success(t("lawoss.report.sent", locale, { id: result.id }));
        closeAlphaReport(async () => undefined);
        return;
      }
      setSend({ status: "failed", code: result.code });
    } catch {
      setSend({ status: "failed", code: "unknown" });
    }
  };

  const save = async () => {
    try {
      const { path } = await desktopBridge.lawossAlphaReportSave({ id: session.id, report: toReport(form) });
      if (path) setSend({ status: "saved", path });
    } catch {
      toast.error(t("lawoss.report.save_failed", locale));
    }
  };
  const openWeb = () => { void desktopBridge.lawossAlphaReportOpenWeb().catch(() => toast.error(t("lawoss.lite.report_failed", locale, { url: feedbackPageUrl(locale).replace(/^https?:\/\//, "") }))); };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] min-h-0 flex-col gap-0 p-0 sm:max-w-xl" portalClassName="relative z-[1002]" data-lawoss-alpha-report="">
        <DialogHeader className="px-6 pb-3 pt-6">
          <DialogTitle>{t("lawoss.report.title", locale)}</DialogTitle>
          <DialogDescription>{t("lawoss.report.intro", locale)}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 pb-6">
          <div className="flex items-start gap-2 rounded-[var(--lw-radius-lg)] border border-amber-7/40 bg-amber-3/40 px-3 py-2 text-[12px] leading-5" role="note">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} aria-hidden />
            <span>{t("lawoss.report.privacy", locale)}</span>
          </div>
          <Choice name="kind" label={t("lawoss.report.kind_label", locale)} value={form.kind} options={REPORT_KINDS} text={(value) => t(`lawoss.report.kind_${value}`, locale)} onChange={(value) => set("kind", value)} />
          {bug ? <Choice name="severity" label={t("lawoss.report.severity_label", locale)} value={form.severity} options={REPORT_SEVERITIES} text={(value) => t(`lawoss.report.severity_${value}`, locale)} onChange={(value) => set("severity", value)} /> : null}
          <div className="grid gap-2">
            <Label htmlFor={ids.what}>{t(bug ? "lawoss.report.what_label_bug" : "lawoss.report.what_label_other", locale)}</Label>
            <Textarea id={ids.what} value={form.what} maxLength={6000} rows={3} placeholder={t("lawoss.report.what_placeholder", locale)} onChange={(event) => set("what", event.target.value)} data-lawoss-report-field="what" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor={ids.outcome}>{t(bug ? "lawoss.report.outcome_label_bug" : "lawoss.report.outcome_label_other", locale)}</Label>
            <Textarea id={ids.outcome} value={form.outcome} maxLength={6000} rows={3} onChange={(event) => set("outcome", event.target.value)} data-lawoss-report-field="outcome" />
          </div>
          {bug ? <Choice name="repeat" label={t("lawoss.report.repeat_label", locale)} value={form.repeat} options={REPORT_REPEATS} text={(value) => t(`lawoss.report.repeat_${value}`, locale)} onChange={(value) => set("repeat", value)} /> : null}

          <div className="grid gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium" htmlFor={ids.shot}>
              <Checkbox id={ids.shot} checked={form.includeScreenshot} disabled={!session.screenshot} onCheckedChange={(checked) => set("includeScreenshot", checked === true)} data-lawoss-report-field="screenshot" />
              {t("lawoss.report.screenshot_label", locale)}
            </label>
            {session.screenshot ? (
              <div className="flex items-start gap-3 ps-6">
                <img src={session.screenshot} alt="" className={`h-20 w-auto rounded border border-border object-cover ${form.includeScreenshot ? "" : "opacity-50"}`} />
                <p className="text-[12px] leading-5 text-muted-foreground">{t("lawoss.report.screenshot_hint", locale)}</p>
              </div>
            ) : <p className="ps-6 text-[12px] text-muted-foreground">{t("lawoss.report.screenshot_none", locale)}</p>}
          </div>

          <div className="grid gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium" htmlFor={ids.diag}>
                <Checkbox id={ids.diag} checked={form.includeDiagnostics} onCheckedChange={(checked) => set("includeDiagnostics", checked === true)} data-lawoss-report-field="diagnostics" />
                {t("lawoss.report.diagnostics_label", locale)}
              </label>
              <Button variant="ghost" size="sm" disabled={!form.includeDiagnostics} onClick={() => { if (showPreview) setShowPreview(false); else void loadPreview(); }} data-lawoss-report-action="preview">
                {showPreview ? t("lawoss.report.diagnostics_hide", locale) : t("lawoss.report.diagnostics_show", locale)}
              </Button>
            </div>
            <p className="ps-6 text-[12px] leading-5 text-muted-foreground">{t("lawoss.report.diagnostics_hint", locale)}</p>
            {showPreview && form.includeDiagnostics ? (
              <div className="ms-6 grid gap-1" data-lawoss-report-preview="">
                {preview.status === "loading" ? <p className="text-[12px] text-muted-foreground">{t("lawoss.report.diagnostics_loading", locale)}</p> : null}
                {preview.status === "failed" ? <p className="text-[12px] text-muted-foreground">{t("lawoss.report.diagnostics_failed", locale)}</p> : null}
                {preview.status === "ready" ? <>
                  <p className="text-[12px] text-muted-foreground">{preview.preview.name}, {formatReportBytes(preview.preview.bytes, locale)}</p>
                  <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-[var(--lw-radius-lg)] border border-border bg-muted/30 p-2 font-mono text-[11px] leading-4">{preview.preview.text}</pre>
                  {preview.preview.truncated ? <p className="text-[12px] text-muted-foreground">{t("lawoss.report.diagnostics_truncated", locale)}</p> : null}
                </> : null}
              </div>
            ) : null}
          </div>

          <div className="grid gap-2">
            <Label htmlFor={ids.contact}>{t("lawoss.report.contact_label", locale)}</Label>
            <Input id={ids.contact} type="email" autoComplete="email" maxLength={254} value={form.contact} onChange={(event) => set("contact", event.target.value)} data-lawoss-report-field="contact" />
            <p className="text-[12px] text-muted-foreground">{t("lawoss.report.contact_hint", locale)} {t("lawoss.report.server", locale, { server: session.server })}</p>
          </div>

          <div ref={outcomeRef}>
          {send.status === "failed" ? (
            <div className="grid gap-2 rounded-[var(--lw-radius-lg)] border border-red-7/40 bg-red-3/30 px-3 py-2 text-[12px] leading-5" role="alert" data-lawoss-report-error={send.code}>
              <strong className="font-medium">{t("lawoss.report.failed_title", locale)}</strong>
              <span>{t(reportErrorKey(send.code), locale)}</span>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void save()} data-lawoss-report-action="save">{t("lawoss.report.save", locale)}</Button>
                <Button variant="outline" size="sm" onClick={openWeb} data-lawoss-report-action="web">{t("lawoss.report.open_web", locale)}</Button>
              </div>
            </div>
          ) : null}
          {send.status === "saved" ? (
            <div className="grid gap-2 rounded-[var(--lw-radius-lg)] border border-border bg-muted/30 px-3 py-2 text-[12px] leading-5" role="status" data-lawoss-report-saved="">
              <span className="break-all">{t("lawoss.report.saved", locale, { path: send.path })}</span>
              <div><Button variant="outline" size="sm" onClick={openWeb}>{t("lawoss.report.open_web", locale)}</Button></div>
            </div>
          ) : null}
          </div>
        </div>
        <DialogFooter className="mx-0 mb-0">
          <Button variant="outline" onClick={close} disabled={busy}>{t("lawoss.report.cancel", locale)}</Button>
          <Button onClick={() => void submit()} disabled={!canSubmitReport(form) || busy} data-lawoss-report-action="send">
            {busy ? t("lawoss.report.sending", locale) : t("lawoss.report.send", locale)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
