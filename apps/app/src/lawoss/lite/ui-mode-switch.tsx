/** @jsxImportSource react */
import { useId } from "react";
import { Switch } from "@/components/ui/switch";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { setUiMode, useUiMode, type UiMode } from "./ui-mode";

/**
 * Prepínač „Pokročilé“ v hlavičke nastavení. Bežná appka nemá vlastné meno ani nálepku
 * „Jednoduchý/Lite“; pokročilé funkcie sa len zapnú (MČ 16. 10. 2026). Interne ostáva `lite`/`pro`.
 */
export function UiModeSwitch() {
  return <UiModeSwitchView mode={useUiMode()} onChange={setUiMode} />;
}

export function UiModeSwitchView({ mode, onChange }: { mode: UiMode; onChange: (mode: UiMode) => void }) {
  const locale = useLocale();
  const noteId = useId();
  const label = t("lawoss.lite.mode_pro", locale);
  const note = t("lawoss.lite.mode_note", locale);
  return (
    <label title={note}
      className="lw-mode-switch flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted/50 mac:titlebar-no-drag" data-lawoss-ui-mode-switch>
      <span aria-hidden>{label}</span>
      <Switch size="sm" checked={mode === "pro"} onCheckedChange={(checked) => onChange(checked ? "pro" : "lite")} aria-label={label} aria-describedby={noteId} />
      <span id={noteId} className="sr-only">{note}</span>
    </label>
  );
}
