/** @jsxImportSource react */
import { useId } from "react";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { setUiMode, useUiMode, type UiMode } from "./ui-mode";

/** Segmentový přepínač Jednoduchý/Pokročilý v hlavičce nastavení. */
export function UiModeSwitch() {
  return <UiModeSwitchView mode={useUiMode()} onChange={setUiMode} />;
}

export function UiModeSwitchView({ mode, onChange }: { mode: UiMode; onChange: (mode: UiMode) => void }) {
  const locale = useLocale();
  const noteId = useId();
  const note = t("lawoss.lite.mode_note", locale);
  return (
    <div role="group" aria-label={t("lawoss.lite.mode_title", locale)} aria-describedby={noteId} title={note}
      className="lw-mode-switch flex shrink-0 overflow-hidden rounded-md border border-border text-xs mac:titlebar-no-drag" data-lawoss-ui-mode-switch>
      {(["lite", "pro"] as const).map((value) => (
        <button key={value} type="button" aria-pressed={mode === value} onClick={() => onChange(value)}
          className={`h-8 px-2.5 ${mode === value ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/50"}`}
        >{t(`lawoss.lite.mode_${value}`, locale)}</button>
      ))}
      <span id={noteId} className="sr-only">{note}</span>
    </div>
  );
}
