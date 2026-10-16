import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { usePanelTabStore } from "../domains/session/panel/panel-tab-store";
import { getElectronBrowser } from "../domains/session/panel/utils";
import { connectPanelNavigationHistory } from "./panel-navigation-history";

export function usePanelNavigationHistory(scope: string | null) {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (!scope) return;
    const disconnect = connectPanelNavigationHistory(scope, usePanelTabStore, {
      current: () => ({ key: window.history.state?.key ?? "default", href: window.location.href, state: window.history.state?.usr }),
      // Annotate the existing route entry without creating another router navigation.
      replace: state => window.history.replaceState({ ...window.history.state, usr: state }, ""),
      push: state => navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { state }),
      schedule: work => { const timer = window.setTimeout(work, 0); return () => window.clearTimeout(timer); },
    });
    const session = usePanelTabStore.getState().sessions[scope];
    const activeId = session?.panes.find(pane => pane.id === session.focusedPaneId)?.activeTabId;
    if (activeId && session?.tabs.some(tab => tab.id === activeId && tab.type === "browser")) void getElectronBrowser()?.selectTab?.(activeId);
    return disconnect;
  }, [scope, location.key, location.pathname, location.search, location.hash, navigate]);
}
