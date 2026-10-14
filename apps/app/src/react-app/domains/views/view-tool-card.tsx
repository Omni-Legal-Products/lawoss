import { useMemo } from "react";
import type { DynamicToolUIPart } from "ai";
import { FileChartColumn, ArrowUpRight, Loader2 } from "lucide-react";
import { useMessageList } from "@/components/chat/message-list-provider";
import { Button } from "@/components/ui/button";
import { useRequestPanelTab } from "../session/panel/panel-tab-destination";
import { viewPanelTab } from "./view-reference";
import { viewProgramInput, viewToolOutcome, viewGenerationId, viewDraftTab, useViewGenerationStore } from "./view-generation";

export function ViewToolCard({ part }: { part: DynamicToolUIPart }) {
  const { legalworkClient, sessionId } = useMessageList();
  const request = useRequestPanelTab();
  const outcome = useMemo(() => part.state === "output-available" ? viewToolOutcome(part.output) : null, [part.state, part.output]);
  const input = useMemo(() => viewProgramInput(part.input), [part.input]);
  const generationId = legalworkClient ? viewGenerationId(legalworkClient.baseUrl, sessionId, part.toolCallId) : "";
  const generation = useViewGenerationStore(state => state.entries[generationId]);
  const view = outcome && "view" in outcome ? outcome.view : generation?.saved ?? null;
  const failure = view ? undefined : outcome && "error" in outcome ? outcome.error : part.state === "output-error" ? part.errorText : generation?.error;
  const pending = !view && !failure && (part.state === "input-streaming" || part.state === "input-available");
  const open = () => {
    if (!legalworkClient) return;
    if (view) request(viewPanelTab(legalworkClient.baseUrl, { owner: view.owner, viewId: view.id }, view.title), { besideChat: true });
    else { const generation = useViewGenerationStore.getState().entries[generationId]; if (generation) request(viewDraftTab(generationId, generation), { besideChat: true }); }
  };
  return <div className="my-3 overflow-hidden rounded-xl border bg-card"><div className="flex items-center gap-3 p-4"><FileChartColumn className="size-5 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{view?.title ?? generation?.title ?? input.title}</p><p className="text-xs text-muted-foreground">{failure ? `Not saved. ${failure}` : pending ? "Building in its own tab…" : view?.mode === "dashboard" ? Object.keys(view.queries).length ? "Live dashboard" : "Dashboard" : view ? "Report snapshot" : "The agent did not return a saved view."}</p></div>{legalworkClient && (view || pending) ? <Button size="sm" variant="outline" onClick={open}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Open<ArrowUpRight /></Button> : null}</div></div>;
}
