import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Loader2, MessageSquarePlus, MoreHorizontal, Plus, RotateCcw, Search, Settings2, Trash2, Users, LockKeyhole } from "lucide-react";
import type { WikiVault } from "@legalwork/types/wiki";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";
import { CreateWikiDialog, WikiSettingsDialog, formatWikiSize, wikiError, type WikiWorkspaceOption } from "./wiki-dialogs";
import { wikiHasUnsavedChanges } from "./wiki-drafts";
import { usePanelTabStore, workspacePanelKey } from "../session/panel/panel-tab-store";

export function WikiManager(props: { client: LegalworkServerClient | null; serverUrl: string; workspaces: WikiWorkspaceOption[]; onChanged: () => void; onOpen: (wiki: WikiVault) => void; onNewChat: (wiki: WikiVault) => Promise<void> }) {
  const { client, serverUrl } = props;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("all");
  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState<WikiVault | null>(null);
  const [deleting, setDeleting] = useState<{ wiki: WikiVault; removeOnly: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({ queryKey: ["wikis", serverUrl], queryFn: () => client!.listWikis(), enabled: Boolean(client) });
  const deleted = useQuery({ queryKey: ["deleted-wikis", serverUrl], queryFn: () => client!.deletedWikis(), enabled: Boolean(client) });
  const matches = (name: string) => name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const items = (list.data?.items ?? []).filter(wiki => matches(wiki.name) && (tab !== "personal" || !wiki.sync) && (tab !== "shared" || Boolean(wiki.sync))).sort((a, b) => a.name.localeCompare(b.name));
  const removed = (deleted.data?.items ?? []).filter(item => matches(item.wiki.name)).sort((a, b) => b.deletedAt - a.deletedAt);
  const chatWikis = [...(list.data?.items ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const startChat = async (wiki: WikiVault) => {
    setStartingChat(true);
    try { await props.onNewChat(wiki); }
    catch (cause) { toast.error(t("wiki.operation_failed"), { description: wikiError(cause) }); }
    finally { setStartingChat(false); }
  };
  const refresh = async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["wikis", serverUrl] }), queryClient.invalidateQueries({ queryKey: ["deleted-wikis", serverUrl] }), queryClient.invalidateQueries({ queryKey: ["wiki-team", serverUrl] })]);
    props.onChanged();
  };
  const accept = async (wiki: WikiVault) => { setSettings(current => current?.id === wiki.id ? wiki : current); await refresh(); };
  const requestDelete = (wiki: WikiVault, removeOnly = Boolean(wiki.sync && wiki.sharing?.role !== "owner")) => { setError(null); setDeleting({ wiki, removeOnly }); };
  const archive = async () => {
    if (!client || !deleting) return;
    setBusy(true); setError(null);
    try {
      if (wikiHasUnsavedChanges(serverUrl, deleting.wiki.id)) throw new Error(t("wiki.save_before_forget"));
      await client.archiveWiki(deleting.wiki.id, deleting.removeOnly);
      // Keep this wiki's own layout for restoration, but close unavailable cross-workspace tabs.
      const store = usePanelTabStore.getState();
      for (const [scope, panel] of Object.entries(store.sessions)) {
        if (scope === workspacePanelKey(deleting.wiki.workspaceId)) continue;
        for (const entry of panel.tabs) if ((entry.type === "wiki" && entry.serverUrl === serverUrl && entry.wikiId === deleting.wiki.id) || (entry.type === "view" && entry.serverUrl === serverUrl && entry.owner.kind === "wiki" && entry.owner.id === deleting.wiki.id)) store.closeTab(scope, entry.id);
      }
      setSettings(null); setDeleting(null); await refresh();
      toast.success(t("wiki.manager_deleted"));
    } catch (cause) { setError(wikiError(cause)); }
    finally { setBusy(false); }
  };
  const restore = async (id: string) => {
    if (!client) return;
    setBusy(true);
    try { await client.restoreWiki(id); await refresh(); toast.success(t("wiki.manager_restored")); }
    catch (cause) { toast.error(t("wiki.operation_failed"), { description: wikiError(cause) }); }
    finally { setBusy(false); }
  };
  const failure = tab === "deleted" ? deleted.error : list.error;
  const loading = tab === "deleted" ? deleted.isLoading : list.isLoading;
  return <div className="h-full min-h-0 overflow-y-auto bg-background">
    <div className="mx-auto w-full max-w-5xl px-6 py-10 sm:px-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="text-3xl font-semibold tracking-tight">{t("wiki.manage_all")}</h1><p className="mt-2 text-sm text-muted-foreground">{t("wiki.manager_hint")}</p></div>
        <div className="flex items-center gap-2">
          {chatWikis.length > 1 ? <DropdownMenu>
            <DropdownMenuTrigger render={<Button disabled={!client || startingChat} />}><MessageSquarePlus size={16} />{t("session.new_task")}</DropdownMenuTrigger>
            <DropdownMenuContent align="end">{chatWikis.map(wiki => <DropdownMenuItem key={wiki.id} onClick={() => void startChat(wiki)}><BookOpen size={15} />{wiki.name}</DropdownMenuItem>)}</DropdownMenuContent>
          </DropdownMenu> : <Button disabled={!client || !chatWikis.length || startingChat} onClick={() => { if (chatWikis[0]) void startChat(chatWikis[0]); }}><MessageSquarePlus size={16} />{t("session.new_task")}</Button>}
          <Button variant="outline" disabled={!client} onClick={() => setCreating(true)}><Plus size={16} />{t("wiki.new_wiki")}</Button>
        </div>
      </header>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4"><Tabs value={tab} onValueChange={setTab}><TabsList><TabsTrigger value="all">{t("wiki.manager_all")}</TabsTrigger><TabsTrigger value="personal">{t("wiki.personal_label")}</TabsTrigger><TabsTrigger value="shared">{t("wiki.shared_label")}</TabsTrigger><TabsTrigger value="deleted"><Trash2 size={14} />{t("wiki.manager_trash")}</TabsTrigger></TabsList></Tabs><div className="relative min-w-48"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" aria-label={t("wiki.manager_search")} placeholder={t("wiki.manager_search")} value={search} onChange={event => setSearch(event.target.value)} /></div></div>
      {!client ? <p className="py-12 text-center text-muted-foreground">{t("wiki.offline")}</p> : failure ? <div role="alert" className="py-10 text-center"><p>{wikiError(failure)}</p><Button variant="ghost" onClick={() => void refresh()}>{t("wiki.retry")}</Button></div> : loading ? <div className="flex justify-center py-16"><Loader2 className="animate-spin" aria-label={t("wiki.loading")} /></div> : <div className="divide-y border-y">
        {tab === "deleted" ? removed.map(({ wiki, deletedAt }) => <div key={wiki.id} className="flex items-center gap-4 py-5"><BookOpen className="size-5 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate font-medium">{wiki.name}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(deletedAt).toLocaleString()}</p></div><Button variant="outline" size="sm" disabled={busy} onClick={() => void restore(wiki.id)}><RotateCcw size={14} />{t("wiki.restore")}</Button></div>) : items.map(wiki => <div key={wiki.id} className="group flex items-center gap-3 py-2">
          <button className="flex min-w-0 flex-1 items-center gap-4 rounded-lg px-2 py-3 text-left transition-colors hover:bg-muted/50" onClick={() => props.onOpen(wiki)}><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted/60"><BookOpen size={21} strokeWidth={1.6} /></span><span className="min-w-0 flex-1"><span className="block truncate font-medium">{wiki.name}</span><span className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">{wiki.sync ? <Users size={12} /> : <LockKeyhole size={12} />}{t(wiki.sync ? "wiki.shared_label" : "wiki.personal_label")}<span>·</span>{t("wiki.storage_size", { pages: wiki.pageCount, size: formatWikiSize(wiki.totalBytes) })}</span>{wiki.syncStatus.error ? <span className="mt-1 block truncate text-xs text-destructive">{wiki.syncStatus.error}</span> : null}</span></button>
          <Button size="icon-sm" variant="ghost" aria-label={t("wiki.manager_settings", { name: wiki.name })} onClick={() => setSettings(wiki)}><Settings2 size={16} /></Button>
          <DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("wiki.manager_actions", { name: wiki.name })} />}><MoreHorizontal size={17} /></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => props.onOpen(wiki)}><BookOpen size={15} />{t("wiki.manager_open")}</DropdownMenuItem><DropdownMenuItem onClick={() => setSettings(wiki)}><Settings2 size={15} />{t("wiki.settings")}</DropdownMenuItem><DropdownMenuItem variant="destructive" onClick={() => requestDelete(wiki)}><Trash2 size={15} />{t(wiki.sync && wiki.sharing?.role !== "owner" ? "wiki.manager_remove" : "wiki.manager_delete")}</DropdownMenuItem>{wiki.sync && wiki.sharing?.role === "owner" ? <DropdownMenuItem onClick={() => requestDelete(wiki, true)}>{t("wiki.manager_remove")}</DropdownMenuItem> : null}</DropdownMenuContent></DropdownMenu>
        </div>)}
        {(tab === "deleted" ? !removed.length : !items.length) ? <div className="py-16 text-center"><BookOpen className="mx-auto mb-4 size-7 text-muted-foreground" /><p className="text-sm text-muted-foreground">{t(search ? "wiki.manager_no_match" : tab === "deleted" ? "wiki.manager_trash_empty" : "wiki.manager_empty")}</p></div> : null}
      </div>}
      {tab === "deleted" ? <p className="mt-4 text-xs text-muted-foreground">{t("wiki.manager_recovery")}</p> : null}
    </div>
    {creating && client ? <CreateWikiDialog client={client} serverUrl={serverUrl} wikis={list.data?.items ?? []} onClose={() => setCreating(false)} onCreate={async input => { const result = await client.createWiki(input); setCreating(false); await refresh(); if (result.sharingError) toast.error(t("wiki.sharing_pending"), { description: result.sharingError }); props.onOpen(result.wiki); }} onJoin={async input => { const result = await client.joinWiki(input); setCreating(false); await refresh(); props.onOpen(result.wiki); }} /> : null}
    {settings && client ? <WikiSettingsDialog key={settings.id} client={client} serverUrl={serverUrl} wiki={settings} projectWorkspaces={props.workspaces.filter(workspace => !list.data?.items.some(wiki => wiki.workspaceId === workspace.id))} onClose={() => setSettings(null)} onUpdate={async input => { await accept((await client.updateWiki(settings.id, input)).wiki); setSettings(null); }} onShare={async (input, update) => { await accept((await (update ? client.updateWikiSharing(settings.id, input) : client.shareWiki(settings.id, input))).wiki); }} onStopSharing={async () => { await accept((await client.stopWikiSharing(settings.id)).wiki); }} onForget={async () => { requestDelete(settings, true); setSettings(null); }} /> : null}
    <Dialog open={Boolean(deleting)} onOpenChange={open => { if (!open && !busy) setDeleting(null); }}><DialogContent><DialogHeader><DialogTitle>{t(deleting?.removeOnly ? "wiki.manager_remove_title" : "wiki.manager_delete_title", { name: deleting?.wiki.name ?? "" })}</DialogTitle><DialogDescription>{t(deleting?.removeOnly ? "wiki.manager_remove_hint" : deleting?.wiki.sync ? "wiki.manager_delete_shared_hint" : "wiki.manager_delete_hint")}</DialogDescription></DialogHeader>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<DialogFooter><Button variant="ghost" disabled={busy} onClick={() => setDeleting(null)}>{t("wiki.cancel")}</Button><Button variant="destructive" disabled={busy} onClick={() => void archive()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 size={15} />}{t(deleting?.removeOnly ? "wiki.manager_remove" : "wiki.manager_delete")}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
