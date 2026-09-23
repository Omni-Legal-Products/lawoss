/**
 * Co LAWOSS-lite skryje. Stejný vzor jako `feature-flags.ts`: skrývá, nemaže —
 * v pro vše zůstává přesně jako dnes.
 */
import type { UiMode } from "./ui-mode";
import { LITE_TODAY_PATH } from "./links";

/** Záložky nastavení v lite: přehled, AI, kancelář (personalizace) a vzhled. */
export const LITE_SETTINGS_TABS: ReadonlySet<string> = new Set(["general", "ai", "personalisation", "appearance"]);

/** V pro vrací `tabs` beze změny (stejné pole). */
export const liteSettingsTabs = <T extends string>(tabs: T[], mode: UiMode): T[] =>
  mode === "pro" ? tabs : tabs.filter((tab) => LITE_SETTINGS_TABS.has(tab));

export const isSettingsTabVisible = (tab: string, mode: UiMode): boolean =>
  mode === "pro" || LITE_SETTINGS_TABS.has(tab);

/** Technické položky upstream bočního panelu, které lite nezobrazí. */
export const LITE_HIDDEN_SIDEBAR = ["new_task", "tasks", "workflows", "recorder", "evals", "folders"] as const;
export type SidebarItem = (typeof LITE_HIDDEN_SIDEBAR)[number];

export const isSidebarItemVisible = (item: SidebarItem, mode: UiMode): boolean =>
  mode === "pro" || !LITE_HIDDEN_SIDEBAR.includes(item);

/** Přepínač workspace v nastavení: jen pro (lite nesmí ukázat pojem „workspace“). */
export const isWorkspaceSwitcherVisible = (mode: UiMode): boolean => mode === "pro";

/** Úvodní stránka: pro zůstává na přehledu spisů. */
export const landingPath = (mode: UiMode): string => (mode === "lite" ? LITE_TODAY_PATH : "/prehlad");
