/** @jsxImportSource react */
import { FileText, FolderSearch, FolderTree, MessageSquare, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { LegalworkWorkspaceDirectoryEntry, LegalworkWorkspaceDirectoryList } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { homeRoute } from "@/react-app/shell/workspace-routes";
import { requestHomePrefill } from "./home-prefill";
import { organizeFolderLink } from "./links";

const preferred = ["index.md", "_status.md", "status.md", "readme.md", "agents.md", "claude.md"];

export function summarizeFolder(listing: LegalworkWorkspaceDirectoryList) {
  const visible = listing.entries.filter(entry => !entry.name.startsWith(".") && !entry.name.startsWith("~$"));
  const files = visible.filter(entry => entry.kind === "file");
  const markdown = files.filter(entry => /\.md$/i.test(entry.name));
  const rank = (entry: LegalworkWorkspaceDirectoryEntry) => {
    const index = preferred.indexOf(entry.name.toLowerCase());
    return index < 0 ? preferred.length : index;
  };
  const documents = markdown.sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.name.localeCompare(b.name)).slice(0, 4);
  return { files: files.length, folders: visible.length - files.length, markdown: markdown.length, documents };
}

export function ClientFolderPanel({ root, projectId, listing, onOpen, onRefresh }: {
  root: string; projectId: string; listing?: LegalworkWorkspaceDirectoryList;
  onOpen: (entry: LegalworkWorkspaceDirectoryEntry) => void;
  onRefresh: () => Promise<void>;
}) {
  const locale = useLocale();
  const navigate = useNavigate();
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const summary = listing && summarizeFolder(listing);
  const refresh = async () => {
    setState("loading");
    try { await onRefresh(); setState("done"); }
    catch { setState("error"); }
  };
  return <section aria-label={t("lawoss.lite.folder_sources", locale)} className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><FolderSearch aria-hidden size={17} />{t("lawoss.lite.folder_sources", locale)}</h2>
      <Button variant="ghost" size="sm" disabled={state === "loading"} onClick={() => void refresh()}><RefreshCw aria-hidden className={state === "loading" ? "motion-safe:animate-spin" : ""} />{t("lawoss.lite.folder_refresh", locale)}</Button>
    </div>
    {summary && <p className="text-sm">{t("lawoss.lite.folder_counts", { files: summary.files, folders: summary.folders, markdown: summary.markdown, lng: locale })}{listing?.truncated && <> · {t("lawoss.practice.incomplete", locale)}</>}</p>}
    {summary && summary.documents.length > 0 && <div className="flex flex-wrap gap-1.5">{summary.documents.map(entry =>
      <Button key={entry.path} size="sm" variant="outline" className="min-w-0 max-w-full" onClick={() => onOpen(entry)}><FileText aria-hidden /><span className="truncate">{entry.name}</span></Button>
    )}</div>}
    <p className="text-xs leading-relaxed text-muted-foreground">{t("lawoss.lite.folder_hint", locale)}</p>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => {
        requestHomePrefill(t("lawoss.lite.folder_draft", locale));
        navigate(homeRoute(projectId));
      }}><MessageSquare aria-hidden />{t("lawoss.lite.folder_analyze", locale)}</Button>
      <Button size="sm" variant="ghost" nativeButton={false} render={<Link to={organizeFolderLink(root)} />}><FolderTree aria-hidden />{t("lawoss.lite.folder_organize", locale)}</Button>
    </div>
    <span role="status" className="text-xs text-muted-foreground">{state === "done" ? t("lawoss.lite.folder_updated", locale) : state === "error" ? t("projects.failed", locale) : ""}</span>
  </section>;
}
