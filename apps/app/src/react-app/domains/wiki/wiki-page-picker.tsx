import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2, Search } from "lucide-react";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { wikiError, wikiSelectClass } from "./wiki-dialogs";
import { wikiPanelTab, type WikiPanelTab } from "./wiki-tabs";

export function WikiPagePicker(props: {
  client: LegalworkServerClient;
  serverUrl: string;
  initialWikiId?: string;
  onClose: () => void;
  onOpen: (tab: WikiPanelTab) => void;
}) {
  const [selection, setSelection] = useState(props.initialWikiId ?? "");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(100);
  const list = useQuery({ queryKey: ["wikis", props.serverUrl], queryFn: () => props.client.listWikis() });
  const wikiId = list.data?.items.some(wiki => wiki.id === selection) ? selection : list.data?.items[0]?.id ?? "";
  const snapshot = useQuery({ queryKey: ["wiki-snapshot", props.serverUrl, wikiId], queryFn: () => props.client.wikiSnapshot(wikiId), enabled: Boolean(wikiId) });
  const query = search.trim().toLocaleLowerCase();
  const pages = snapshot.data?.pages.filter(page => !query || `${page.title}\n${page.path}`.toLocaleLowerCase().includes(query)) ?? [];
  const error = list.error ?? snapshot.error;
  return <Dialog open onOpenChange={open => { if (!open) props.onClose(); }}>
    <DialogContent className="flex max-h-[80vh] flex-col gap-3 sm:max-w-xl">
      <DialogHeader><DialogTitle>{t("wiki.open_page")}</DialogTitle></DialogHeader>
      {list.data?.items.length ? <>
        <select aria-label={t("wiki.select_wiki")} className={wikiSelectClass} value={wikiId} onChange={event => { setSelection(event.target.value); setLimit(100); }}>
          {list.data.items.map(wiki => <option key={wiki.id} value={wiki.id}>{wiki.name}</option>)}
        </select>
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input autoFocus className="pl-9" aria-label={t("wiki.search")} placeholder={t("wiki.search")} value={search} onChange={event => { setSearch(event.target.value); setLimit(100); }} /></div>
      </> : null}
      <div className="min-h-0 overflow-y-auto" aria-label={t("wiki.files")}>
        {error ? <p role="alert" className="p-3 text-sm text-destructive">{wikiError(error)}</p> : list.isLoading || wikiId && snapshot.isLoading ? <div role="status" className="flex items-center gap-2 p-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("wiki.loading")}</div> : !pages.length ? <p className="p-3 text-sm text-muted-foreground">{t(list.data?.items.length ? "wiki.no_search_results" : "wiki.empty_hint")}</p> : pages.slice(0, limit).map(page => <button key={page.path} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent" onClick={() => props.onOpen(wikiPanelTab(props.serverUrl, wikiId, { kind: "page", path: page.path }, page.title))}>
          <FileText className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0"><span className="block truncate text-sm">{page.title}</span><span className="block truncate text-xs text-muted-foreground">{page.path}</span></span>
        </button>)}
        {pages.length > limit ? <Button variant="ghost" className="w-full" onClick={() => setLimit(value => value + 100)}>{t("wiki.show_more", { remaining: pages.length - limit })}</Button> : null}
      </div>
    </DialogContent>
  </Dialog>;
}
