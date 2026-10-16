import { WikiContentPreview } from "./wiki-content-preview";
import { WikiDiff, WikiContentStats } from "./wiki-diff";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WikiRevision } from "@legalwork/types/wiki";
import { LegalworkServerError, type LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, RotateCcw } from "lucide-react";
import { t } from "@/i18n";

export function WikiRevisionDialog({ client, wikiId, revision, writable, onClose, onRestore }: {
  client: LegalworkServerClient; wikiId: string; revision: WikiRevision; writable: boolean;
  onClose: () => void; onRestore: (path: string, revisionId: string, baseRevision: string) => Promise<void>;
}) {
  const [compare, setCompare] = useState(false);
  const [currentViews, setCurrentViews] = useState(false);
  const [target, setTarget] = useState("current");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const version = useQuery({ queryKey: ["wiki-version", client.baseUrl, wikiId, revision.path, revision.id], queryFn: () => client.wikiRevision(wikiId, revision.path, revision.id) });
  const versions = useQuery({ queryKey: ["wiki-history", client.baseUrl, wikiId, revision.path], queryFn: () => client.wikiHistory(wikiId, revision.path) });
  const current = useQuery({ queryKey: ["wiki-version-current", client.baseUrl, wikiId, revision.path, revision.id], staleTime: Infinity, gcTime: 0,
    queryFn: async () => {
      try { return await client.readWikiPage(wikiId, revision.path); }
      catch (error) { if (error instanceof LegalworkServerError && error.status === 404) return { content: "", revision: "", deleted: true }; throw error; }
    },
  });
  const historical = useQuery({ queryKey: ["wiki-version", client.baseUrl, wikiId, revision.path, target], enabled: compare && target !== "current",
    queryFn: () => client.wikiRevision(wikiId, revision.path, target),
  });
  const comparison = target === "current" ? current : historical;
  const failure = error || version.error?.message || current.error?.message || (compare ? comparison.error?.message || versions.error?.message : "");
  const comparisonRevision = versions.data?.items.find(item => item.id === target);
  const comparisonDate = comparisonRevision?.createdAt;
  const comparisonReady = comparison.data && (target === "current" || comparisonRevision);
  // Delete revisions keep the old body for recovery, but represent an empty page in a diff.
  const before = revision.action === "delete" ? "" : version.data?.content ?? "";
  const after = comparisonRevision?.action === "delete" ? "" : comparison.data?.content ?? "";
  const comparisonLabel = target === "current" ? t("wiki.current_version") : comparisonDate != null ? t("wiki.version_from", { date: new Date(comparisonDate).toLocaleString() }) : t("wiki.comparison_version");
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent showCloseButton={!busy} className="flex max-h-[90vh] flex-col sm:max-w-5xl">
    <DialogHeader><DialogTitle>{revision.path}</DialogTitle><DialogDescription>{t("wiki.version_from", { date: new Date(revision.createdAt).toLocaleString() })}</DialogDescription></DialogHeader>
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" aria-pressed={!compare} variant={!compare ? "secondary" : "ghost"} onClick={() => setCompare(false)}>{t("wiki.version_content")}</Button>
      <Button size="sm" aria-pressed={compare} variant={compare ? "secondary" : "ghost"} onClick={() => setCompare(true)}>{t("wiki.compare_versions")}</Button>
      {compare && version.data && comparisonReady && <WikiContentStats before={before} after={after} />}
      {compare && <label className="flex min-w-0 items-center gap-2 text-sm">{t("wiki.compare_with")}<select className="h-9 min-w-0 max-w-full rounded-md border bg-background px-2" value={target} onChange={event => setTarget(event.target.value)}>
        <option value="current">{t("wiki.current_version")}</option>
        {versions.data?.items.filter(item => item.id !== revision.id).map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.action === "delete" ? t("wiki.revision_delete") : item.action === "restore" ? t("wiki.revision_restore") : t("wiki.revision_write")}</option>)}
      </select></label>}
    </div>
    {!compare && version.data?.content.includes("legalwork-view") && <label className="flex flex-wrap items-center gap-2 text-sm">{t("wiki.embedded_dashboards")}<select className="h-9 min-w-0 max-w-full rounded-md border bg-background px-2" value={currentViews ? "current" : "historical"} onChange={event => setCurrentViews(event.target.value === "current")}><option value="historical">{t("wiki.views_at_revision")}</option><option value="current">{t("wiki.views_current")}</option></select></label>}
    {compare && comparison.data && "deleted" in comparison.data && <p className="text-xs text-muted-foreground">{t("wiki.current_deleted")}</p>}
    {(revision.action === "delete" || compare && comparisonRevision?.action === "delete") && <p className="text-xs text-muted-foreground">{t(compare ? "wiki.deleted_version_diff" : "wiki.deleted_version_preview")}</p>}
    {failure && <p role="alert" className="text-sm text-destructive">{failure}<Button size="sm" variant="ghost" onClick={() => { setError(""); void version.refetch(); void current.refetch(); if (compare) void versions.refetch(); if (compare && target !== "current") void historical.refetch(); }}>{t("wiki.retry")}</Button></p>}
    <div className="min-h-0 overflow-auto rounded-lg border [&_.wiki-reader]:p-5">
      {!version.data || (compare && !comparisonReady) ? failure ? null : <div className="p-8"><Loader2 className="mx-auto size-5 animate-spin" aria-label={t("wiki.loading")} /></div> : compare ? <WikiDiff before={before} after={after} beforeLabel={t("wiki.version_from", { date: new Date(revision.createdAt).toLocaleString() })} afterLabel={comparisonLabel} /> : <WikiContentPreview client={client} wikiId={wikiId} path={revision.path} content={version.data.content} historicalViews={currentViews ? undefined : { id: revision.id, snapshots: version.data.viewSnapshots ?? {} }} />}
    </div>
    <DialogFooter>
      <Button variant="ghost" disabled={busy} onClick={onClose}>{t("common.close")}</Button>
      {writable && revision.action !== "delete" && <Button disabled={busy || !version.data || !current.data || current.isFetching} onClick={() => {
        if (!current.data) return;
        setBusy(true); setError("");
        void onRestore(revision.path, revision.id, current.data.revision).then(onClose).catch(error => setError(error instanceof Error ? error.message : String(error))).finally(() => setBusy(false));
      }}>{busy ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}{t("wiki.restore_this_version")}</Button>}
    </DialogFooter>
  </DialogContent></Dialog>;
}
