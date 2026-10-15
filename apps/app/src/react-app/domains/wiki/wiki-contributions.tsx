import { WikiDiffStats } from "./wiki-diff";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Inbox, Loader2 } from "lucide-react";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { t } from "@/i18n";
import { useRequestPanelTab } from "../session/panel/panel-tab-destination";
import { suggestionTab } from "./wiki-suggestion-model";

export function WikiContributions({ client, wikiId, workspaceId }: { client: LegalworkServerClient; wikiId: string; workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const requestTab = useRequestPanelTab({ kind: "workspace", workspaceId });
  const query = useQuery({ queryKey: ["wiki-contributions", client.baseUrl, wikiId], queryFn: () => client.wikiContributions(wikiId), refetchInterval: 10_000 });
  const title = t("wiki.pending_contributions");
  return <>
    <button className="wiki-nav-row" title={title} onClick={() => setOpen(true)}><Inbox size={15} /><span>{title}</span><span className="wiki-contributions-count">{query.error ? "!" : query.data?.items.length ?? "…"}</span></button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="sm:max-w-xl">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{t("wiki.contributions_hint")}</DialogDescription></DialogHeader>
      <div className="max-h-[60vh] space-y-3 overflow-y-auto">
        {query.isPending && <Loader2 className="mx-auto size-5 animate-spin" aria-label={t("wiki.loading")} />}
        {query.error && <p role="alert" className="text-sm text-destructive">{query.error.message}<Button variant="ghost" size="sm" onClick={() => void query.refetch()}>{t("wiki.retry")}</Button></p>}
        {query.data?.unavailableProjects.length ? <p role="alert" className="text-sm text-muted-foreground">{t("wiki.contributions_unavailable", { projects: query.data.unavailableProjects.join(", ") })}</p> : null}
        {query.data && !query.data.items.length && <p className="py-6 text-center text-sm text-muted-foreground">{t("wiki.no_contributions")}</p>}
        {query.data?.items.map(item => <button type="button" key={`${item.workspaceId}:${item.id}`} className="w-full space-y-2 rounded-xl border p-4 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring" onClick={() => { requestTab(suggestionTab(item)); setOpen(false); }}>
          <span className="flex items-start justify-between gap-3"><span className="min-w-0 break-words text-sm font-medium">{item.title}</span><WikiDiffStats changes={item.changes} /></span>
          <p className="text-xs text-muted-foreground">{item.projectName} · {new Date(item.createdAt).toLocaleString()}</p>
          <p className="break-all text-xs text-muted-foreground">{item.destination.path}</p>
          <span className="block text-xs text-muted-foreground">{t("wiki.review_contribution")} →</span>
        </button>)}
      </div>
    </DialogContent></Dialog>
  </>;
}
