import { ViewOwnerSchema, type ViewOwner } from "@legalwork/types/views";

export type ViewReference = { owner: ViewOwner; viewId: string };
const id = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseViewReference(source: string, owner?: ViewOwner): ViewReference | null {
  const value = source.trim();
  if (owner && id.test(value)) return { owner, viewId: value };
  const match = /^(?:legalwork-view:\/\/)?(wiki|workspace)(?::|\/)([^/\s]+)\/([^/\s]+)$/.exec(value);
  if (!match || !id.test(match[3])) return null;
  try {
    const parsed = ViewOwnerSchema.safeParse({ kind: match[1], id: decodeURIComponent(match[2]) });
    return parsed.success ? { owner: parsed.data, viewId: match[3] } : null;
  } catch { return null; }
}
export function viewLink(reference: ViewReference) { return `legalwork-view://${reference.owner.kind}/${encodeURIComponent(reference.owner.id)}/${reference.viewId}`; }
export type ViewPanelTab = ViewReference & { id: string; type: "view"; serverUrl: string; label: string };
export function viewPanelTab(serverUrl: string, reference: ViewReference, label = "Report"): ViewPanelTab {
  return { ...reference, id: `view:${JSON.stringify([serverUrl, reference.owner.kind, reference.owner.id, reference.viewId])}`, type: "view", serverUrl, label };
}
