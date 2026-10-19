/**
 * Co LAWOSS-lite skryje. Stejný vzor jako `feature-flags.ts`: skrývá, nemaže -
 * v pro vše zůstává přesně jako dnes.
 */
import type { UiMode } from "./ui-mode";
import { LITE_TODAY_PATH } from "./links";

/** Keep native integrations and permission controls accessible in both modes. */
const LITE_SETTINGS_TABS: ReadonlySet<string> = new Set(["general", "ai", "extensions", "permissions", "personalisation", "appearance", "updates"]);

/** V pro vrací `tabs` beze změny (stejné pole). */
export const liteSettingsTabs = <T extends string>(tabs: T[], mode: UiMode): T[] =>
  mode === "pro" ? tabs : tabs.filter((tab) => LITE_SETTINGS_TABS.has(tab));

export const isSettingsTabVisible = (tab: string, mode: UiMode): boolean =>
  mode === "pro" || LITE_SETTINGS_TABS.has(tab);

/** Technické položky upstream bočního panelu, které lite nezobrazí. */
const LITE_HIDDEN_SIDEBAR = ["new_task", "tasks", "workflows", "recorder", "evals", "folders"] as const;
export type SidebarItem = (typeof LITE_HIDDEN_SIDEBAR)[number];

export const isSidebarItemVisible = (item: SidebarItem, mode: UiMode): boolean =>
  mode === "pro" || !LITE_HIDDEN_SIDEBAR.includes(item);

/** Sekcie chatu, ktoré bežný režim nezobrazí: pripnuté a nedávne chaty (ostávajú v Pokročilom a v prispôsobení). */
const LITE_HIDDEN_CHAT_SECTIONS: ReadonlySet<string> = new Set(["sectionPinned", "sectionRecent"]);

/** Bežný režim ukáže natívnu sekciu klientov (projekty) bez zoznamov chatov (MČ 19. 10. 2026). */
export const isChatSectionVisible = (key: string, mode: UiMode): boolean =>
  mode === "pro" || !LITE_HIDDEN_CHAT_SECTIONS.has(key);

/** Always identify the workspace whose settings and permissions are being edited. */
export const isWorkspaceSwitcherVisible = (_mode: UiMode): boolean => true;

/** Preserve the upstream home destination in advanced mode. */
export const landingPath = (mode: UiMode): string => (mode === "lite" ? LITE_TODAY_PATH : "/home");

/** Úvodné stránky oboch režimov: aj pri `preserveRoute` z nich musí prvé spustenie presmerovať na /welcome. */
export const isLandingPath = (pathname: string): boolean => pathname === LITE_TODAY_PATH || pathname === "/home";

/**
 * Apply Lite filtering to the v0.2.1 native action rail. Wiki, kalendár a plánované úlohy
 * (spec 0017, časť 6.2) ostanú v Lite skryté aj po neskoršom odkrytí v Pro.
 */
export const isMainRailItemVisible = (key: string, mode: UiMode): boolean =>
  mode === "pro" || !["navTasks", "navWorkflows", "navRecorder", "navEvaluations", "navWikis", "navCalendar", "navScheduled"].includes(key);
