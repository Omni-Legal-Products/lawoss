/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { Keyboard } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

import { dictationAcceleratorFromEvent, formatDictationShortcut } from "../../recorder/dictation-shortcut";
import { useRecorderStore } from "../../recorder/recorder-store";

export function DictationShortcutControl(props: { compact?: boolean; disabled?: boolean; demo?: boolean; onConfigured?: () => void }) {
  const store = useRecorderStore();
  const dictation = store.systemDictation;
  const [saving, setSaving] = useState(false);
  const [demoCapturing, setDemoCapturing] = useState(false);
  const [demoAccelerator, setDemoAccelerator] = useState("Control");
  const capturing = props.demo ? demoCapturing : dictation?.shortcutCaptureActive === true;
  const wasCapturing = useRef(false);
  useEffect(() => {
    if (wasCapturing.current && !capturing) props.onConfigured?.();
    wasCapturing.current = capturing;
  }, [capturing, props.onConfigured]);
  useEffect(() => () => {
    const recorder = useRecorderStore.getState();
    if (!props.demo && recorder.systemDictation?.shortcutCaptureActive) void recorder.setSystemDictationShortcutCapture(false);
  }, [props.demo]);
  const stopCapture = async () => {
    if (props.demo) setDemoCapturing(false);
    else await store.setSystemDictationShortcutCapture(false);
  };
  return (
    <button
      type="button"
      aria-label={t("recorder.dictation_hotkey_change")}
      aria-pressed={capturing}
      disabled={props.disabled || (!dictation && !props.demo) || saving}
      className={cn(
        "flex w-full items-center justify-center gap-3 rounded-xl border border-subtle bg-surface outline-none transition-colors",
        props.compact ? "min-h-12 justify-between px-3 py-2" : "mt-4 min-h-40 flex-col px-6",
        "hover:bg-sunken focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/20",
        capturing && "border-brand bg-brand/5",
      )}
      onClick={() => {
        if (capturing) return;
        if (props.demo) setDemoCapturing(true);
        else void store.setSystemDictationShortcutCapture(true);
      }}
      onKeyDown={(event) => {
        if (!capturing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          void stopCapture();
          return;
        }
        if (!props.demo && dictation?.supportsHold) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const accelerator = dictationAcceleratorFromEvent(event, dictation?.platform ?? "darwin");
        if (!accelerator) return;
        if (props.demo) {
          setDemoAccelerator(accelerator);
          setDemoCapturing(false);
          return;
        }
        setSaving(true);
        void store
          .setSystemDictationShortcut(accelerator)
          .finally(() => stopCapture())
          .finally(() => setSaving(false));
      }}
    >
      <span className={props.compact ? "font-mono text-sm font-medium text-ink" : "grid min-h-14 min-w-14 place-items-center rounded-md border border-subtle bg-sunken px-3 font-mono text-lg font-medium text-ink shadow-sm"}>
        {props.demo ? formatDictationShortcut(demoAccelerator, "darwin") : dictation ? formatDictationShortcut(dictation.accelerator, dictation.platform) : <Keyboard />}
      </span>
      <span className="text-sm text-subtext">
        {saving
          ? t("recorder.dictation_hotkey_saving")
          : capturing
            ? t("recorder.dictation_hotkey_listening")
            : t("recorder.dictation_hotkey_change")}
      </span>
    </button>
  );
}

export function DictationSetupDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const dictation = useRecorderStore(state => state.systemDictation);

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] max-w-[760px] gap-0 overflow-y-auto rounded-xl p-0 sm:max-w-[760px]">
        <DialogHeader className="items-center px-8 pb-6 pt-8 text-center">
          <DialogTitle className="text-2xl">{t("recorder.dictation_setup_title")}</DialogTitle>
          <DialogDescription className="text-base">
            {t("recorder.dictation_setup_description")}
          </DialogDescription>
        </DialogHeader>

        <section className="border-y border-subtle px-8 py-6">
          <div className="text-xs font-semibold uppercase text-subtext">
            {t("recorder.dictation_hotkey_label")}
          </div>
          <DictationShortcutControl />

          <div className="mt-6 space-y-2 border-t border-subtle pt-5 text-sm text-subtext">
            {dictation?.supportsHold === false ? (
              <p>{t("recorder.dictation_gestures_fallback")}</p>
            ) : (
              <>
                <p>{t("recorder.dictation_gestures_hold")}</p>
                <p>{t("recorder.dictation_gestures_hands_free")}</p>
              </>
            )}
          </div>
        </section>

        <section className="px-8 py-6">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-xs font-semibold uppercase text-subtext">
              {t("recorder.dictation_test_label")}
            </span>
            <span className="text-sm text-subtext">
              {dictation
                ? t("recorder.dictation_test_shortcut", {
                    shortcut: formatDictationShortcut(dictation.accelerator, dictation.platform),
                  })
                : ""}
            </span>
          </div>
          <Textarea
            className="mt-3 min-h-32 resize-none text-base"
            placeholder={t("recorder.dictation_test_placeholder")}
          />
        </section>
      </DialogContent>
    </Dialog>
  );
}
