import { useEffect, useRef } from "react";
import { ArrowUp, Mic, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { t } from "@/i18n";
import { isHiddenSettingsTab } from "@/lawoss/feature-flags";
import { useRecorderStore } from "@/react-app/domains/recorder/recorder-store";
import type { ComposerDictation } from "./use-composer-dictation";
import "./composer-dictation.css";

export function ComposerDictationButton({ dictation, disabled }: { dictation: ComposerDictation; disabled?: boolean }) {
  // LAWOSS: the recorder (speech models, microphone) is hidden, so dictation has no setup path.
  if (isHiddenSettingsTab("recorder")) return null;
  return <Button type="button" variant="ghost" size="icon" className="shrink-0 rounded-full" disabled={disabled || dictation.blocked || !dictation.supported}
    onClick={() => void dictation.start()} title={dictation.label} aria-label={dictation.label} data-testid="composer-dictation-start"><Mic className="size-[18px]" /></Button>;
}

function DictationWaveform() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    const history = Array.from({ length: 160 }, () => 0);
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, lastSample = 0, level = 0;
    const draw = (now: number) => {
      const target = useRecorderStore.getState().composerDictationLevel;
      level += (target - level) * (target > level ? .65 : .22);
      if (now - lastSample >= 45) {
        history.shift(); history.push(level); lastSample = now;
      }
      const width = element.clientWidth, height = element.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) {
        element.width = Math.round(width * ratio); element.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      context.strokeStyle = getComputedStyle(element).color;
      context.lineWidth = 2.5; context.lineCap = "round";
      const count = Math.min(history.length, Math.floor(width / 6));
      for (let index = 0; index < count; index++) {
        const sample = motion.matches ? level : history[history.length - count + index];
        const bar = Math.max(1, sample * (height - 8));
        context.globalAlpha = .2 + .65 * (index / Math.max(1, count - 1));
        const x = width - (count - index) * 6 + 3;
        context.beginPath(); context.moveTo(x, (height - bar) / 2); context.lineTo(x, (height + bar) / 2); context.stroke();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas ref={canvas} className="lw-composer-dictation-wave" aria-hidden="true" />;
}

export function ComposerDictationBar({ dictation, sendDisabled }: { dictation: ComposerDictation; sendDisabled?: boolean }) {
  const transcribing = dictation.phase === "transcribing" || dictation.phase === "inserting";
  return <div className="lw-composer-dictation" data-testid="composer-dictation-active">
    <Button type="button" variant="ghost" size="icon" className="shrink-0 rounded-full bg-muted/60" onClick={dictation.cancel} title={t("composer.dictation_cancel")} aria-label={t("composer.dictation_cancel")}><X className="size-[18px]" /></Button>
    {transcribing ? <div className="lw-composer-dictation-working" role="status"><span className="lw-composer-dictation-dots" aria-hidden="true"><i /><i /><i /></span>{t("composer.dictation_transcribing")}</div>
      : <><DictationWaveform /><span className="sr-only" role="status">{t("composer.dictation_listening")}</span></>}
    <Button type="button" variant="secondary" size="icon" className="shrink-0 rounded-full" disabled={dictation.phase !== "listening"} onClick={() => void dictation.finish()} title={t("composer.dictation_finish")} aria-label={t("composer.dictation_finish")}><Square className="size-3" fill="currentColor" /></Button>
    <Button type="button" size="icon" className="shrink-0 rounded-full" disabled={sendDisabled || dictation.phase !== "listening"} onClick={() => void dictation.finish(true)} title={t("composer.dictation_send")} aria-label={t("composer.dictation_send")} data-testid="composer-dictation-send"><ArrowUp className="size-[18px]" /></Button>
  </div>;
}

export function ComposerDictationError({ dictation }: { dictation: ComposerDictation }) {
  const navigate = useNavigate();
  if (!dictation.error) return null;
  return <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-destructive" role="alert"><span className="min-w-0 flex-1">{dictation.error}</span><Button type="button" variant="ghost" size="sm" onClick={() => navigate("/settings/recorder")}>{t("recorder.settings_tab_label")}</Button><Button type="button" variant="ghost" size="icon-sm" aria-label={t("recorder.dismiss")} onClick={dictation.dismissError}><X /></Button></div>;
}
