import type { ViewReference } from "@legalwork/types/views";
export { parseViewReference, viewReferenceKey as viewLink, type ViewReference } from "@legalwork/types/views";
export type ViewPanelTab = ViewReference & { id: string; type: "view"; serverUrl: string; label: string };
export function viewPanelTab(serverUrl: string, reference: ViewReference, label = "Report"): ViewPanelTab {
  return { ...reference, id: `view:${JSON.stringify([serverUrl, reference.owner.kind, reference.owner.id, reference.viewId])}`, type: "view", serverUrl, label };
}
