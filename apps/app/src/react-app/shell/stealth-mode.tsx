/** @jsxImportSource react */

import { useEffect } from "react";
import { Loader2, NotebookPen, Square } from "lucide-react";

import { audioMeetingOpen, windowSetStealth } from "@/app/lib/desktop";
import { t } from "@/i18n";
import { useLocal } from "@/react-app/kernel/local-provider";
import { useRecorderStore } from "../domains/recorder/recorder-store";

/**
 * Recording indicator + screen-capture privacy.
 *
 * Privacy: the window can be excluded from screen shares / recordings via the
 * main-process `setContentProtection`, driven by the "Hide LegalWork" setting
 * (Settings → Recorder → Meetings): never / during recording (default) / always. This is
 * invisible to the user.
 *
 * Indicator: while a recording runs, a small "Recording locally" pill sits in
 * the top bar (with a stop button) plus a faint red hairline along the top
 * edge. No theme change — the app stays exactly as it is. Mounted once at the
 * shell root so it follows the global recorder + preference state.
 */
export function StealthMode() {
  const recording = useRecorderStore((state) => state.recording);
  const dictationRecordingId = useRecorderStore((state) => state.dictationRecordingId);
  const stopRecording = useRecorderStore((state) => state.stopRecording);
  const finalizing = useRecorderStore((state) => state.finalizing);
  const { prefs } = useLocal();
  const hideMode = prefs.hideAppMode;

  const isRecording = Boolean(recording);
  // Content protection follows the privacy setting, independent of the badge.
  const shouldHide = hideMode === "always" || (hideMode === "recording" && isRecording);
  // The topbar cue is only for a real recording (not the system-dictation HUD).
  const showBadge = Boolean(recording && !recording.ephemeral && recording.id !== dictationRecordingId);

  useEffect(() => {
    // Best-effort: on plain web the bridge is absent and this no-ops.
    void Promise.resolve(windowSetStealth(shouldHide)).catch(() => {});
  }, [shouldHide]);

  useEffect(() => {
    // Always restore capturability when the app tears down.
    return () => void Promise.resolve(windowSetStealth(false)).catch(() => {});
  }, []);

  if (!showBadge) return null;

  return (
    <>
      {/* A faint red hairline along the very top edge — the universal
          "you're recording" frame cue, kept soft so it never nags. */}
      {!finalizing ? <div className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-[2px] bg-gradient-to-r from-transparent via-red-9/80 to-transparent" /> : null}
      {/* Centered in the topbar band. The pill is interactive (stop button); the
          row stays pointer-events-none so it never eats a window drag. */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[200] flex h-10 items-center justify-center">
        <span className="titlebar-no-drag pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-red-6 bg-red-3/90 py-0.5 pl-2.5 pr-1 backdrop-blur-sm">
          {finalizing ? <Loader2 className="size-3 animate-spin text-red-11" /> : <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-9 opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-red-9" />
          </span>}
          <span className="text-[11px] font-medium leading-none text-red-11">
            {t(finalizing ? "recorder.finishing" : "stealth.recording_locally")}
          </span>
          <button
            type="button"
            disabled={finalizing}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              void stopRecording();
            }}
            aria-label={t("recorder.stop")}
            title={t("recorder.stop")}
            className="titlebar-no-drag pointer-events-auto ml-0.5 inline-flex size-5 items-center justify-center rounded-full text-red-11 transition-colors hover:bg-red-5 disabled:opacity-50"
          >
            <Square className="size-3" fill="currentColor" />
          </button>
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => { void audioMeetingOpen(); }}
            aria-label={t("recorder.open_transcript")}
            title={t("recorder.open_transcript")}
            className="titlebar-no-drag pointer-events-auto inline-flex size-5 items-center justify-center rounded-full text-red-11 transition-colors hover:bg-red-5"
          >
            <NotebookPen className="size-3" />
          </button>
        </span>
      </div>
    </>
  );
}
