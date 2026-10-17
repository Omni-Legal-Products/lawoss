import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { ViewSaveDialog } from "./view-save-dialog";
import { viewPanelTab } from "./view-reference";
import { Loader2 } from "lucide-react";
import { useSessionActivityStore } from "../session/status/session-activity-store";
import { useViewGenerationStore, type ViewDraftTab } from "./view-generation";
import { useCallback, useEffect, useState } from "react";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { usePanelTabStore } from "../session/panel/panel-tab-store";
import type { ViewPanelTab } from "./view-reference";
import { SavedView, OpenUIView, PreviewView } from "./view-renderer";

export function ViewPanel({ client, tab, sessionId }: { client: LegalworkServerClient | null; tab: ViewPanelTab; sessionId: string }) {
  const title = useCallback((label: string) => usePanelTabStore.getState().updateTabLabel(sessionId, tab.id, label), [sessionId, tab.id]);
  return <div className="h-full overflow-auto" style={{ containerType: "inline-size" }}><SavedView client={client?.baseUrl === tab.serverUrl ? client : null} reference={tab} onTitle={title} /></div>;
}

export function ViewDraftPanel({ client, tab, sessionId: panelScope }: { client: LegalworkServerClient | null; tab: ViewDraftTab; sessionId: string }) {
  const [saving, setSaving] = useState(false);
  const generation = useViewGenerationStore(state => state.entries[tab.generationId]);
  const activity = useSessionActivityStore(state => generation ? state.statusesByWorkspaceId[generation.workspaceId]?.[generation.sessionId] : undefined);
  useEffect(() => {
    if (generation?.title) usePanelTabStore.getState().updateTabLabel(panelScope, tab.id, generation.title);
  }, [generation?.title, panelScope, tab.id]);
  useEffect(() => {
    if (generation?.status !== "streaming" || (activity !== "idle" && activity !== "error")) return;
    // Completion parts can follow session-idle in the same event batch.
    const timer = window.setTimeout(() => useViewGenerationStore.getState().fail(tab.generationId, activity === "error" ? t("views.generation_failed") : t("views.generation_stopped")), 1500);
    return () => window.clearTimeout(timer);
  }, [activity, generation?.status, tab.generationId]);
  if (generation?.preview && client?.baseUrl === tab.serverUrl) return <div className="h-full overflow-auto" style={{ containerType: "inline-size" }}><div className="lw-saved-view">
    <div className="lw-saved-view-toolbar"><span>{t(generation.saved ? "views.original_preview" : "views.preview_unsaved")}</span><Button size="sm" onClick={() => setSaving(true)}>{t(generation.saved ? "views.save_copy" : "views.save_title")}</Button></div>
    <PreviewView client={client} preview={generation.preview} generationId={tab.generationId} />
    {saving && <ViewSaveDialog fromChat={!generation.saved} savedFrom={{ workspaceId: generation.workspaceId, sessionId: generation.sessionId, callId: generation.toolCallId }} client={client} preview={generation.saved ? { ...generation.preview, target: undefined } : generation.preview} onClose={() => setSaving(false)} onSaved={view => {
      useViewGenerationStore.getState().markSaved(tab.generationId, view);
      usePanelTabStore.getState().resolveViewTab(tab.generationId, viewPanelTab(client.baseUrl, { owner: view.owner, viewId: view.id }, view.title));
      setSaving(false);
    }} />}
  </div></div>;
  const failed = !generation || generation.status === "failed";
  return <div className="h-full overflow-auto" style={{ containerType: "inline-size" }}><div className="lw-saved-view">
    <div className="lw-saved-view-toolbar" role={failed ? "alert" : "status"}>{failed ? generation?.error ?? t("views.generation_unavailable") : <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />{t("views.creating_preview")}</span>}</div>
    {generation?.program ? <div inert><OpenUIView program={generation.program} streaming /></div> : !failed ? <p className="lw-view-data-note">{t("views.preview_building_hint")}</p> : null}
    {failed && generation?.program && <p className="lw-view-data-note">{t("views.preview_unfinished")}</p>}
  </div></div>;
}
