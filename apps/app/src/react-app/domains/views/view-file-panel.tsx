import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import type { ViewOwner, ViewSummary } from "@legalwork/types/views";
import { usePanelTabStore } from "../session/panel/panel-tab-store";
import { SavedView } from "./view-renderer";
import { viewPanelTab } from "./view-reference";

export function viewAtPath(items: ViewSummary[], path: string) {
  // The repository supplies the real path, including renamed or moved records.
  return items.find(item => (item.path ?? `Views/${item.id}.view.json`) === path);
}
export function ViewFilePanel({ client, workspaceId, owner: explicitOwner, path, tabId }: { client: LegalworkServerClient; workspaceId: string; owner?: ViewOwner; path: string; tabId: string }) {
  const record = useQuery({ queryKey: ["view-file", client.baseUrl, workspaceId, explicitOwner?.kind, explicitOwner?.id, path], queryFn: async () => {
    const wiki = explicitOwner ? undefined : (await client.listWikis()).items.find(item => item.workspaceId === workspaceId);
    const owner: ViewOwner = explicitOwner ?? (wiki ? { kind: "wiki", id: wiki.id } : { kind: "workspace", id: workspaceId });
    const list = await client.listViews(owner), view = viewAtPath(list.items, path);
    if (!view) throw new Error(list.issues.find(issue => issue.path === path)?.message ?? "This report file could not be opened. It may have moved or contain an invalid view.");
    return view;
  }, retry: false });
  useEffect(() => { if (record.data) usePanelTabStore.getState().resolveViewTab(tabId, viewPanelTab(client.baseUrl, { owner: record.data.owner, viewId: record.data.id }, record.data.title)); }, [record.data, tabId, client.baseUrl]);
  return record.error ? <div role="alert" className="p-6 text-sm text-destructive">{record.error.message}</div> : record.data ? <SavedView client={client} reference={{ owner: record.data.owner, viewId: record.data.id }} /> : <div role="status" className="p-6 text-sm text-muted-foreground">Opening report…</div>;
}
