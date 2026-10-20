/** @jsxImportSource react */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { FreshDocument } from "./document-processing";
import { documentVisualSourceVerified, subscribeDocumentVisualSources, type DocumentVisualSource } from "./document-visual-source";

export function DocumentVisualReview(props: { record: FreshDocument; source: DocumentVisualSource; host: boolean; disabled: boolean; onReview: (pages: number[]) => void; onOpen?: () => void }) {
  const [confirmed, setConfirmed] = React.useState(false);
  const verified = React.useSyncExternalStore(subscribeDocumentVisualSources, () => documentVisualSourceVerified(props.source, props.record.hash), () => false);
  React.useEffect(() => { if (!verified) setConfirmed(false); }, [verified]);
  const coverage = props.record.pdfCoverage;
  if (!coverage) return null;
  const pending = coverage.filter(page => page.visualReasons.length && !props.record.visualReview?.pages.includes(page.page));
  const decorative = pending.length > 0 && pending.every(page => page.nativeTextCoverage === "complete" && page.visualReasons.every(reason => reason === "drawn-paths"));
  return <div className="mt-1 space-y-1">
    <p>{t("documents.native_text_coverage", { pages: coverage.filter(page => page.nativeTextCoverage === "complete").length, total: coverage.length })}</p>
    {pending.length ? <>
      <p>{t("documents.visual_pending", { pages: pending.map(page => page.page).join(", ") })}</p>
      {pending.map(page => <p key={page.page}>{page.page}: {page.visualReasons.map(reason => {
        switch (reason) {
          case "images": return t("documents.visual_images");
          case "drawn-paths": return t("documents.visual_drawn-paths");
          case "shading": return t("documents.visual_shading");
          case "annotations": return t("documents.visual_annotations");
        }
      }).join(", ")}</p>)}
      {props.onOpen ? <Button size="sm" variant="outline" onClick={props.onOpen}>{t(props.record.provenance.parentId ? "documents.open_container" : "documents.open_original")}</Button> : null}
      {props.record.provenance.parentId ? <p>{t("documents.visual_attachment_required")}</p> : !props.host ? <p>{t("documents.visual_host_required")}</p> : !decorative ? <p>{t("documents.visual_other_content")}</p> : <>
        <p className="break-all">SHA-256: <code>{props.record.hash}</code></p>
        {!verified ? <p>{t("documents.visual_open_required")}</p> : null}
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={props.disabled || !verified} onChange={event => setConfirmed(event.target.checked)} />{t("documents.visual_confirm")}</label>
        <Button size="sm" variant="outline" disabled={props.disabled || !verified || !confirmed} onClick={() => { if (verified && confirmed) props.onReview(pending.map(page => page.page)); }}>{t("documents.visual_review")}</Button>
      </>}
    </> : props.record.visualReview ? <p>{t("documents.visual_reviewed", { date: new Date(props.record.visualReview.reviewedAt).toLocaleString() })}</p> : null}
  </div>;
}
