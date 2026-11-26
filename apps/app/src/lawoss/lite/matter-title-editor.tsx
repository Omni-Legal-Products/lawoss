import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { DiagnosticMessage } from "../i18n/diagnostic-message";
import { validMatterTitle } from "./matter-title";

export function MatterTitleEditor({ title, onRename }: { title: string; onRename?: (title: string, original: string) => Promise<void> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [original, setOriginal] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const label = t("lawoss.matters.rename");
  if (draft === null || !onRename) return <div className="flex flex-wrap items-center gap-2">
    <h1 className="lw-h1">{title}</h1>
    {onRename && <Button size="icon-sm" variant="ghost" aria-label={label} title={label} onClick={() => { setDraft(title); setOriginal(title); setError(null); }}><Pencil /></Button>}
  </div>;
  return <form className="flex flex-wrap items-center gap-2" onSubmit={async event => {
    event.preventDefault();
    if (busy || !validMatterTitle(draft)) return;
    setBusy(true);
    setError(null);
    try { await onRename(draft.trim(), original); setDraft(null); }
    catch (failure) { setError(failure); }
    finally { setBusy(false); }
  }}>
    <Input aria-label={label} autoFocus maxLength={200} required disabled={busy} value={draft}
      className="max-w-lg" onChange={event => setDraft(event.currentTarget.value)}
      onKeyDown={event => { if (event.key === "Escape") setDraft(null); }} />
    <Button size="sm" type="submit" disabled={busy || !validMatterTitle(draft) || draft.trim() === original}>{t("common.save")}</Button>
    <Button size="sm" variant="ghost" type="button" disabled={busy} onClick={() => setDraft(null)}>{t("common.cancel")}</Button>
    {error != null && <div role="alert" className="w-full text-sm text-destructive"><DiagnosticMessage value={error} fallback={t("lawoss.matters.changed")} /></div>}
  </form>;
}
