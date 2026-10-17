import { FolderIcon } from "@/react-app/design-system/folder-icon";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileText, Loader2, ShieldCheck } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { LegalworkServerError, type LegalworkServerClient } from "@/app/lib/legalwork-server";
import { t } from "@/i18n";
import { useProjectFiles } from "../workspace/project-file-context";

export function WikiProjectFilesDialog({ open, onOpenChange, client, wikiId, workspaceId, sessionId }: {
  open: boolean; onOpenChange: (open: boolean) => void; client: LegalworkServerClient; wikiId?: string; workspaceId: string; sessionId: string;
}) {
  const files = useProjectFiles(), cache = useQueryClient();
  const [projectId, setProjectId] = useState<string | null>(null), [path, setPath] = useState("");
  const [pendingProjects, setPendingProjects] = useState<string[]>([]);
  const wikis = useQuery({ queryKey: ["wikis", client.baseUrl], queryFn: () => client.listWikis(), enabled: open });
  const projects = files?.projects.filter(item => !item.isWiki && item.workspaceId !== workspaceId && (item.client.baseUrl !== client.baseUrl || wikis.data && !wikis.data.items.some(wiki => wiki.workspaceId === item.workspaceId))) ?? [];
  const selected = projects.find(item => item.projectId === projectId);
  const queryKey = ["wiki-project-access", client.baseUrl, wikiId, sessionId];
  const access = useQuery({ queryKey, queryFn: () => client.wikiProjects(wikiId!, sessionId), enabled: open && Boolean(wikiId), refetchInterval: open ? 2000 : false });
  const sandbox = useQuery({ queryKey: ["session-sandbox", client.baseUrl, workspaceId, sessionId], queryFn: () => client.sessionSandbox(workspaceId, sessionId), enabled: open });
  const listing = useQuery({ queryKey: ["wiki-project-picker", selected?.client.baseUrl, selected?.workspaceId, path],
    queryFn: () => selected!.client.listWorkspaceDirectory(selected!.workspaceId, path), enabled: open && Boolean(selected) });
  const grant = access.data?.items.find(item => item.id === selected?.workspaceId && selected.client.baseUrl === client.baseUrl);
  const busy = Boolean(grant && pendingProjects.includes(grant.id));
  const changeAccess = async () => {
    if (!wikiId || !grant || busy) return;
    setPendingProjects(values => [...values, grant.id]);
    if (!grant.granted) { onOpenChange(false); toast.info(t("wiki.project_approval_pending")); }
    try {
      if (grant.granted) await client.revokeWikiProjectAccess(wikiId, sessionId, grant.id);
      else await client.requestWikiProjectAccess(wikiId, sessionId, grant.id);
      await cache.invalidateQueries({ queryKey });
    } catch (error) {
      if (error instanceof LegalworkServerError && error.code === "wiki_project_access_denied") toast.info(t("wiki.project_access_not_granted"));
      else toast.error(error instanceof Error ? error.message : t("project_files.failed"));
    }
    finally { setPendingProjects(values => values.filter(id => id !== grant.id)); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="sm:max-w-xl gap-4">
    <DialogHeader><DialogTitle>{t("wiki.project_files")}</DialogTitle><DialogDescription>{t("wiki.project_attachment_hint")}</DialogDescription></DialogHeader>
    {wikis.error && <p role="alert" className="text-xs text-destructive">{wikis.error.message}<Button variant="ghost" size="sm" onClick={() => void wikis.refetch()}>{t("wiki.retry")}</Button></p>}
    {sandbox.error && <p role="alert" className="text-xs text-destructive">{sandbox.error.message}<Button variant="ghost" size="sm" onClick={() => void sandbox.refetch()}>{t("wiki.retry")}</Button></p>}
    {sandbox.data && (!sandbox.data.enabled || !sandbox.data.supported) && <p className="text-xs text-muted-foreground">{t("wiki.project_sandbox_off")}</p>}
    {selected ? <>
      <div className="flex items-center gap-2"><Button variant="ghost" size="icon-sm" aria-label={t("wiki.project_back")} onClick={() => path ? setPath(path.replace(/\/?[^/]+\/?$/, "")) : setProjectId(null)}><ArrowLeft className="size-4" /></Button><span className="min-w-0 truncate text-sm font-medium">{selected.name}{path ? ` / ${path}` : ""}</span></div>
      {grant && <div className="flex items-center justify-between gap-3 rounded-lg border p-3 text-xs"><span className="flex items-center gap-2" role={busy ? "status" : undefined}>{busy ? <Loader2 className="size-4 shrink-0 animate-spin" /> : grant.granted && <ShieldCheck className="size-4" />}{busy ? t(grant.granted ? "common.loading" : "wiki.project_waiting_approval") : grant.granted ? t("wiki.project_read_only") : t("wiki.project_allow")}</span><Button size="sm" variant="outline" disabled={busy} onClick={() => void changeAccess()}>{grant.granted ? t("wiki.project_revoke") : t("wiki.project_allow")}</Button></div>}
      {access.error && <p role="alert" className="text-xs text-destructive">{access.error.message}<Button variant="ghost" size="sm" onClick={() => void access.refetch()}>{t("wiki.retry")}</Button></p>}
      <div className="max-h-72 overflow-auto" aria-busy={listing.isPending}>
        {listing.isPending && <p role="status" className="p-3 text-sm text-muted-foreground">{t("wiki.loading")}</p>}
        {listing.error && <p role="alert" className="text-sm text-destructive">{listing.error.message}<Button variant="ghost" size="sm" onClick={() => void listing.refetch()}>{t("wiki.retry")}</Button></p>}
        {listing.data?.entries.map(entry => <button key={entry.path} type="button" className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" onClick={() => {
          if (entry.kind === "dir") { setPath(entry.path); return; }
          try { files?.attach({ projectId: selected.projectId, workspaceId: selected.workspaceId, path: entry.path, name: entry.name }, sessionId); onOpenChange(false); }
          catch (error) { toast.error(error instanceof Error ? error.message : t("project_files.failed")); }
        }}>{entry.kind === "dir" ? <FolderIcon empty={entry.empty === true} className="size-4" /> : <FileText className="size-4 shrink-0 text-muted-foreground" />}<span className="truncate">{entry.name}</span></button>)}
        {listing.data?.entries.length === 0 && <p className="p-3 text-sm text-muted-foreground">{t("wiki.project_no_files")}</p>}
      </div>
    </> : <div className="max-h-72 overflow-auto">{wikis.isPending && <p role="status" className="p-3 text-sm text-muted-foreground">{t("wiki.loading")}</p>}{projects.map(project => <button type="button" key={project.projectId} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { setProjectId(project.projectId); setPath(""); }}><FolderIcon className="size-4" /><span className="truncate">{project.name}</span></button>)}{!projects.length && !wikis.isPending && !wikis.error && <p className="text-sm text-muted-foreground">{t("wiki.project_no_projects")}</p>}</div>}
  </DialogContent></Dialog>;
}


export const WIKI_PROJECT_PICKER_EVENT = "legalwork:wiki-project-picker";
export function openWikiProjectPicker(sessionId: string) { window.dispatchEvent(new CustomEvent(WIKI_PROJECT_PICKER_EVENT, { detail: sessionId })); }
