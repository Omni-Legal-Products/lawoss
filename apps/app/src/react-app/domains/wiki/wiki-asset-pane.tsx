import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { isLoopbackLegalworkServerUrl } from "@/app/lib/legalwork-server";
import { ArtifactPanel } from "../session/artifacts/artifact-panel";
import { classifyOpenTarget } from "../session/artifacts/open-target";
import { PreviewError, PreviewLoading } from "../session/artifacts/preview";
import type { WikiPanelTab } from "./wiki-tabs";
import { t } from "@/i18n";

const ViewFilePanel = lazy(() => import("../views/view-file-panel").then(module => ({ default: module.ViewFilePanel })));

/** Resolve the original owning workspace on every mount, including tabs in other projects. */
export function WikiAssetPane({ client, serverUrl, tab, workspaceId, onClose }: { client: LegalworkServerClient | null; serverUrl: string; tab: WikiPanelTab; workspaceId: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ["wikis", serverUrl], queryFn: async () => {
    if (!client) throw new Error(t("wiki.offline"));
    return client.listWikis();
  }, enabled: Boolean(client) });
  const wiki = query.data?.items.find(wiki => wiki.id === tab.wikiId);
  if (query.isError) return <PreviewError message={query.error.message} />;
  if (!client) return <PreviewError message={t("wiki.offline")} />;
  if (query.isPending) return <PreviewLoading />;
  if (!wiki || tab.location.kind !== "asset") return <PreviewError message={t("wiki.asset_unavailable")} />;
  const path = tab.location.path;
  if (/\.view\.json$/i.test(path)) return <Suspense fallback={<PreviewLoading />}><ViewFilePanel client={client} workspaceId={wiki.workspaceId} owner={{ kind: "wiki", id: wiki.id }} path={path} tabId={tab.id} /></Suspense>;
  return <ArtifactPanel sessionId={`workspace:${workspaceId}`} client={client} workspaceId={wiki.workspaceId} workspaceRoot={wiki.root} isRemoteWorkspace={!isLoopbackLegalworkServerUrl(serverUrl)} localReadOnly={!wiki.writable} tab={{ id: tab.id, type: "artifact", label: tab.label, value: path, preview: classifyOpenTarget(path, "file") }} onClose={onClose} />;
}
