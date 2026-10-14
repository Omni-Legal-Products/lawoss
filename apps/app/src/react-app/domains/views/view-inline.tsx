import { lazy, Suspense } from "react";
import { ArrowUpRight } from "lucide-react";
import { useViewHost } from "./view-host";
import { parseViewReference, viewPanelTab } from "./view-reference";
import { useRequestPanelTab } from "../session/panel/panel-tab-destination";
const SavedView = lazy(() => import("./view-renderer").then(module => ({ default: module.SavedView })));

export function InlineView({ source }: { source: string }) {
  const host = useViewHost();
  const reference = parseViewReference(source, host?.owner);
  const requestTab = useRequestPanelTab();
  if (!reference || !host?.client) return <div className="rounded-lg border p-4 text-sm text-muted-foreground">{reference ? "Open this page in its workspace to load the view." : "Invalid view reference. Edit this block in Source."}<code className="mt-2 block text-xs">{source}</code></div>;
  return <div className="lw-inline-view not-prose" contentEditable={false} style={{ containerType: "inline-size" }}><button type="button" className="lw-inline-view-open" aria-label="Open view in tab" title="Open view in tab" onClick={() => requestTab(viewPanelTab(host.client!.baseUrl, reference))}><ArrowUpRight size={15} /></button><Suspense fallback={<p role="status">Loading view…</p>}><SavedView client={host.client} reference={reference} inline openSource={host.openSource} /></Suspense></div>;
}
