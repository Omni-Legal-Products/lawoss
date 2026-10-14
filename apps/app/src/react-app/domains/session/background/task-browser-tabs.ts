import { create } from "zustand";
import type { BrowserPanelTab } from "@/app/lib/desktop-types";

/** Window-local browser inventory, independent of whichever project is visible. */
export const useTaskBrowserTabs = create<{
  tabs: BrowserPanelTab[];
  update: (tabs: BrowserPanelTab[]) => void;
}>(set => ({ tabs: [], update: tabs => set({ tabs }) }));
