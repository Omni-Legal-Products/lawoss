import { useEffect, useId, useRef, useState } from "react";
import { t } from "@/i18n";
import { useRecorderStore } from "@/react-app/domains/recorder/recorder-store";

export function appendDictatedText(draft: string, text: string): string {
  const spoken = text.trim();
  if (!spoken) return draft;
  return `${draft}${draft && !/\s$/.test(draft) ? " " : ""}${spoken}`;
}

/** Own capture by composer and draft scope, including while native startup is pending. */
export function useComposerDictation(scope: string | undefined, onInsert: (text: string, send: boolean) => void | Promise<void>, visible = true) {
  const instance = useId();
  const ownerId = `${instance}:${scope ?? ""}`;
  const current = useRef({ ownerId, onInsert });
  const pendingStart = useRef<AbortController | null>(null);
  const sendAfterTranscription = useRef(false);
  const finishing = useRef(false);
  current.current = { ownerId, onInsert };
  const [error, setError] = useState<string | null>(null);
  const active = useRecorderStore(state => state.composerDictation?.ownerId === ownerId);
  const phase = useRecorderStore(state => state.dictationState);
  const blocked = useRecorderStore(state => Boolean(state.recording || state.starting || state.finalizing || state.importing || state.composerDictation));
  const supported = typeof window !== "undefined" && Boolean(window.__LEGALWORK_ELECTRON__?.audio);

  const cancel = () => {
    const recorder = useRecorderStore.getState();
    if (recorder.composerDictation?.ownerId === ownerId) void recorder.cancelRecording();
  };
  useEffect(() => {
    current.current.ownerId = ownerId;
    setError(null);
    return () => {
      // Invalidate completion before awaiting capture teardown or transcription.
      pendingStart.current?.abort();
      if (current.current.ownerId === ownerId) current.current = { ownerId: "", onInsert: () => {} };
      const recorder = useRecorderStore.getState();
      if (recorder.composerDictation?.ownerId === ownerId) void recorder.cancelRecording();
    };
  }, [ownerId]);
  useEffect(() => {
    if (visible) return;
    pendingStart.current?.abort();
    const recorder = useRecorderStore.getState();
    if (recorder.composerDictation?.ownerId === ownerId) void recorder.cancelRecording();
  }, [visible, ownerId]);
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const recorder = useRecorderStore.getState();
      if (recorder.composerDictation?.ownerId === ownerId) void recorder.cancelRecording();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active, ownerId]);

  return {
    active, phase, blocked, supported, error,
    dismissError: () => setError(null),
    cancel,
    start: async () => {
      if (!supported || blocked || !visible) return;
      setError(null);
      sendAfterTranscription.current = false;
      finishing.current = false;
      const controller = new AbortController();
      pendingStart.current = controller;
      try {
        await useRecorderStore.getState().startComposerDictation(ownerId, text => {
          if (!controller.signal.aborted && current.current.ownerId === ownerId) return current.current.onInsert(text, sendAfterTranscription.current);
        }, controller.signal);
      } catch (error) {
        if (current.current.ownerId === ownerId) setError(error instanceof Error ? error.message : String(error));
      }
    },
    finish: async (send = false) => {
      const recorder = useRecorderStore.getState();
      if (finishing.current || recorder.finalizing || recorder.composerDictation?.ownerId !== ownerId || recorder.dictationState !== "listening") return;
      finishing.current = true;
      sendAfterTranscription.current = send;
      try {
        await recorder.stopRecording();
        const message = useRecorderStore.getState().error;
        if (message && current.current.ownerId === ownerId) setError(message);
      } finally {
        finishing.current = false;
        sendAfterTranscription.current = false;
      }
    },
    label: supported ? blocked && !active ? t("recorder.stop_session_first") : t("composer.dictation_start") : t("composer.dictation_desktop"),
  };
}

export type ComposerDictation = ReturnType<typeof useComposerDictation>;
