/** @jsxImportSource react */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { FreshDocument } from "./document-processing";

export function DocumentVisualReview(props: { record: FreshDocument; host: boolean; disabled: boolean; onReview: (pages: number[]) => void; onOpen?: () => void }) {
  const [confirmed, setConfirmed] = React.useState(false);
  const coverage = props.record.pdfCoverage;
  if (!coverage) return null;
  const pending = coverage.filter(page => page.visualReasons.length && !props.record.visualReview?.pages.includes(page.page));
  const decorative = pending.length > 0 && pending.every(page => page.nativeTextCoverage === "complete" && page.visualReasons.every(reason => reason === "drawn-paths"));
  return <div className="mt-1 space-y-1">
    <p>{t("documents.native_text_coverage", { pages: coverage.filter(page => page.nativeTextCoverage === "complete").length, total: coverage.length })}</p>
    {pending.length ? <>
      <p>{t("documents.visual_pending", { pages: pending.map(page => page.page).join(", ") })}</p>
      {pending.map(page => <p key={page.page}>{page.page}: {page.visualReasons.map(reason => t(`documents.visual_${reason}`)).join(", ")}</p>)}
      {props.onOpen ? <Button size="sm" variant="outline" onClick={props.onOpen}>{t(props.record.provenance.parentId ? "documents.open_container" : "documents.open_original")}</Button> : null}
      {props.record.provenance.parentId ? <p>{t("documents.visual_attachment_required")}</p> : !props.host ? <p>{t("documents.visual_host_required")}</p> : !decorative ? <p>{t("documents.visual_other_content")}</p> : <>
        <p className="break-all">SHA-256: <code>{props.record.hash}</code></p>
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={props.disabled} onChange={event => setConfirmed(event.target.checked)} />{t("documents.visual_confirm")}</label>
        <Button size="sm" variant="outline" disabled={props.disabled || !confirmed} onClick={() => { if (confirmed) props.onReview(pending.map(page => page.page)); }}>{t("documents.visual_review")}</Button>
      </>}
    </> : props.record.visualReview ? <p>{t("documents.visual_reviewed", { date: new Date(props.record.visualReview.reviewedAt).toLocaleString() })}</p> : null}
  </div>;
}
