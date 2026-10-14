import { Loader2 } from "lucide-react";
import { useSessionActivityStore } from "../session/status/session-activity-store";
import { useViewGenerationStore, type ViewDraftTab } from "./view-generation";
import { useCallback, useEffect } from "react";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { usePanelTabStore } from "../session/panel/panel-tab-store";
import type { ViewPanelTab } from "./view-reference";
import { SavedView, OpenUIView } from "./view-renderer";

export function ViewPanel({ client, tab, sessionId }: { client: LegalworkServerClient | null; tab: ViewPanelTab; sessionId: string }) {
  const title = useCallback((label: string) => usePanelTabStore.getState().updateTabLabel(sessionId, tab.id, label), [sessionId, tab.id]);
  return <div className="h-full overflow-auto" style={{ containerType: "inline-size" }}><SavedView client={client?.baseUrl === tab.serverUrl ? client : null} reference={tab} onTitle={title} /></div>;
}

export function ViewDraftPanel({ tab, sessionId: panelScope }: { tab: ViewDraftTab; sessionId: string }) {
  const generation = useViewGenerationStore(state => state.entries[tab.generationId]);
  const activity = useSessionActivityStore(state => generation ? state.statusesByWorkspaceId[generation.workspaceId]?.[generation.sessionId] : undefined);
  useEffect(() => {
    if (generation?.title) usePanelTabStore.getState().updateTabLabel(panelScope, tab.id, generation.title);
  }, [generation?.title, panelScope, tab.id]);
  useEffect(() => {
    if (generation?.status !== "streaming" || (activity !== "idle" && activity !== "error")) return;
    // Completion parts can follow session-idle in the same event batch.
    const timer = window.setTimeout(() => useViewGenerationStore.getState().fail(tab.generationId, activity === "error" ? "Generation stopped with an error. No saved view was returned." : "Generation stopped before a saved view was returned."), 1500);
    return () => window.clearTimeout(timer);
  }, [activity, generation?.status, tab.generationId]);
  const failed = !generation || generation.status === "failed";
  return <div className="h-full overflow-auto" style={{ containerType: "inline-size" }}><div className="lw-saved-view">
    <div className="lw-saved-view-toolbar" role={failed ? "alert" : "status"}>{failed ? generation?.error ?? "This generation is no longer available. Ask the agent to create the view again." : <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Creating {generation.title === "Creating view…" ? "view" : generation.title}…</span>}</div>
    {generation?.program ? <div inert><OpenUIView program={generation.program} streaming /></div> : !failed ? <p className="lw-view-data-note">The page will appear as the agent writes it.</p> : null}
    {failed && generation?.program && <p className="lw-view-data-note">Unfinished preview. This was not saved as a report or dashboard.</p>}
  </div></div>;
}
