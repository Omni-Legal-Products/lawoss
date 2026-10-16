import { lazy, Suspense, useEffect, useState } from "react";
import { lineChanges, type LineChanges } from "@legalwork/types/line-diff";
import { t } from "@/i18n";

const Editor = lazy(() => import("../session/artifacts/artifact-markdown-editor").then(module => ({ default: module.ArtifactMarkdownEditor })));
const mode: { mode: "diff" } = { mode: "diff" };
const noChange = () => {};
const noUpload = async (): Promise<string> => { throw new Error("Read-only comparison"); };
const imagePreview = async (source: string) => source;

export function WikiDiffStats({ changes }: { changes: LineChanges | null | undefined }) {
  return changes ? <span className="inline-flex shrink-0 gap-2 font-mono text-xs tabular-nums" aria-label={t("wiki.line_changes", changes)}><span className="text-success">+{changes.added}</span><span className="text-danger">-{changes.removed}</span></span> : <span className="text-xs text-muted-foreground">{t("wiki.counts_unavailable")}</span>;
}

export function WikiDiff({ before, after, beforeLabel, afterLabel }: { before: string; after: string; beforeLabel?: string; afterLabel?: string }) {
  return <div>
    {(beforeLabel || afterLabel) && <div className="grid grid-cols-2 divide-x border-b bg-muted/30 text-xs text-muted-foreground"><span className="min-w-0 px-3 py-2">{beforeLabel}</span><span className="min-w-0 px-3 py-2">{afterLabel}</span></div>}
    <Suspense fallback={<p className="p-4">{t("wiki.loading")}</p>}><Editor value={after} baseline={before} readOnly onChange={noChange} imageUpload={noUpload} imagePreview={imagePreview} viewModeRequest={mode} toolbarTarget={null} suppressHtmlProcessing /></Suspense>
  </div>;
}

export function WikiContentStats({ before, after }: { before: string; after: string }) {
  const [changes, setChanges] = useState(() => lineChanges(before, after));
  useEffect(() => {
    const timer = window.setTimeout(() => setChanges(lineChanges(before, after)), 250);
    return () => window.clearTimeout(timer);
  }, [before, after]);
  return <WikiDiffStats changes={changes} />;
}
