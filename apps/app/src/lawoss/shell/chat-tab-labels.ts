import type { PanelTab } from "@/react-app/domains/session/panel/panel-tab-store";

export type ChatTabLabelUpdate = { tabId: string; label: string };

/** Uložený názov karty chatu sa inak mení len pri práve otvorenom chate (#512). */
export function chatTabLabelUpdates(tabs: readonly PanelTab[], titleFor: (sessionId: string) => string | undefined): ChatTabLabelUpdate[] {
  return tabs.flatMap(tab => {
    if (tab.type !== "chat") return [];
    const title = titleFor(tab.sessionId);
    return title && title !== tab.label ? [{ tabId: tab.id, label: title }] : [];
  });
}
