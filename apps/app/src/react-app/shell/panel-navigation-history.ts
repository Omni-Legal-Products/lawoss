import type { StoreApi } from "zustand";
import type { PanelTab, PanelTabStore, SessionPanelState } from "../domains/session/panel/panel-tab-store";

type TabVisit = { scope: string; paneId: string; tab: PanelTab };
export type NavigationEntry = { key: string; href: string; state: unknown };
export type PanelHistoryHost = {
  current: () => NavigationEntry;
  replace: (state: Record<string, unknown>) => void;
  push: (state: Record<string, unknown>) => void;
  schedule: (work: () => void) => () => void;
};
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function navigationTab(state: unknown, scope: string) {
  const visit = record(state) ? state.panelNavigation : null;
  if (!record(visit) || visit.scope !== scope || typeof visit.paneId !== "string" || !record(visit.tab) || typeof visit.tab.id !== "string") return null;
  return { paneId: visit.paneId, tab: visit.tab };
}
function focusedVisit(scope: string, session?: SessionPanelState): TabVisit | null {
  const pane = session?.panes.find(pane => pane.id === session.focusedPaneId) ?? session?.panes[0];
  const tab = session?.tabs.find(tab => tab.id === pane?.activeTabId);
  return pane && tab ? { scope, paneId: pane.id, tab } : null;
}
function destination(visit: TabVisit | null) {
  if (!visit) return "";
  return JSON.stringify([visit.tab.id, visit.tab.type === "wiki" ? visit.tab.location : null]);
}
function withVisit(state: unknown, visit: TabVisit | null) {
  return { ...(record(state) ? state : {}), panelNavigation: visit };
}

/** One history for routes and tabs. Background updates and layout changes are not visits. */
export function connectPanelNavigationHistory(scope: string, store: Pick<StoreApi<PanelTabStore>, "getState" | "subscribe">, host: PanelHistoryHost) {
  const entry = host.current();
  const saved = navigationTab(entry.state, scope);
  if (saved) store.getState().restoreNavigationTab(scope, saved.tab, saved.paneId);
  let previous = store.getState().sessions[scope];
  let last = focusedVisit(scope, previous);
  host.replace(withVisit(entry.state, last));
  let cancel: (() => void) | undefined;
  const unsubscribe = store.subscribe(() => {
    cancel?.();
    // Opening a chat can also navigate its route in the same event. Let that route
    // own the entry instead of inserting a duplicate visit under the old URL.
    cancel = host.schedule(() => {
      const current = host.current();
      if (current.key !== entry.key || current.href !== entry.href) return;
      const session = store.getState().sessions[scope];
      const next = focusedVisit(scope, session);
      if (destination(last) !== destination(next)) {
        const prior = last;
        const replacedPreview = prior && previous?.panes.some(pane => pane.previewTabId === prior.tab.id)
          && next && !previous?.tabs.some(tab => tab.id === next.tab.id);
        const push = prior && next && (session?.tabs.some(tab => tab.id === prior.tab.id) || replacedPreview);
        if (push) host.push(withVisit(current.state, next));
        else host.replace(withVisit(current.state, next));
      }
      previous = session;
      last = next;
    });
  });
  return () => { cancel?.(); unsubscribe(); };
}
