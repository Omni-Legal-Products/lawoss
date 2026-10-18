import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ALPHA_HIDE_UNADOPTED_UPSTREAM,
  hideCommercialSidebarItems,
  isCommercialSurfaceHidden,
  isProjectViewHidden,
  isSidebarItemHidden,
  isUpstreamRouteHidden,
  isWikiHidden,
} from "../src/lawoss/feature-flags";
import { LawossLanding } from "../src/lawoss/lite/landing";
import { isMainRailItemVisible, landingPath } from "../src/lawoss/lite/visibility";
import type { UiMode } from "../src/lawoss/lite/ui-mode";
import { upstreamRoute } from "../src/lawoss/shell/routes";
import { ShellConfigProvider, useShellConfig, type ShellConfig } from "../src/react-app/shell/shell-config";

const HIDDEN_NAV = ["navWikis", "navCalendar", "navScheduled"];

/** Prečíta konfiguráciu panela tak, ako ju appka načíta z uloženého profilu. */
function readConfig(saved: object | null): ShellConfig {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  let config: ShellConfig | undefined;
  function ReadConfig() {
    config = useShellConfig().config;
    return null;
  }
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
      localStorage: { getItem: () => saved === null ? null : JSON.stringify(saved) },
    } });
    renderToStaticMarkup(<ShellConfigProvider><ReadConfig /></ShellConfigProvider>);
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
  if (!config) throw new Error("shell config not read");
  return config;
}

/** Položky hlavnej lišty tak, ako ich filtruje `main-action-rail.tsx`. */
const railItems = (config: ShellConfig, mode: UiMode) =>
  hideCommercialSidebarItems(config.navOrder).filter((key) => isMainRailItemVisible(key, mode) && config[key]);

describe("spec 0017 S3: neprevzaté plochy LegalWork v0.2.9 sú skryté", () => {
  test("jeden prepínač drží skrytie", () => {
    expect(ALPHA_HIDE_UNADOPTED_UPSTREAM).toBe(true);
    expect(isWikiHidden()).toBe(true);
  });

  test("hlavná lišta v Pro ani v Lite neukáže wiki, kalendár ani plánované úlohy", () => {
    const config = readConfig(null);
    for (const mode of ["pro", "lite"] satisfies UiMode[]) {
      const items = railItems(config, mode);
      for (const key of HIDDEN_NAV) expect(items).not.toContain(key);
      expect(items).toContain("navHome");
      expect(items).toContain("navProjects");
    }
    // Lite ich skryje aj po neskoršom odkrytí v Pro (spec 0017, časť 6.2).
    for (const key of HIDDEN_NAV) expect(isMainRailItemVisible(key, "lite")).toBe(false);
  });

  test("ani po migrácii starého profilu, ktorá doplní kalendár, plánované úlohy a wiki", () => {
    const config = readConfig({ navOrder: ["navNewChat", "navTasks", "navRecorder"], chatSectionOrder: ["navNewChat", "sectionPinned", "sectionProjects", "sectionRecent"] });
    // Migrácia ich doplní a zapne (upstream správanie ostáva) ...
    for (const key of HIDDEN_NAV) expect(config.navOrder).toContain(key);
    expect(config.navCalendar).toBe(true);
    expect(config.chatSectionOrder).toContain("sectionSharedProjects");
    // ... ale vykreslenie ich skryje.
    for (const mode of ["pro", "lite"] satisfies UiMode[]) {
      for (const key of HIDDEN_NAV) expect(railItems(config, mode)).not.toContain(key);
    }
    expect(hideCommercialSidebarItems(config.chatSectionOrder)).not.toContain("sectionSharedProjects");
    expect(hideCommercialSidebarItems(config.projectNavOrder)).not.toContain("projectCalendar");
    expect(hideCommercialSidebarItems(config.projectNavOrder)).toContain("projectHome");
  });

  test("kalendár projektu a Dashboards sa neponúkajú v „+“ ani na stránke projektu", () => {
    expect(isSidebarItemHidden("projectCalendar")).toBe(true);
    expect(isProjectViewHidden("calendar")).toBe(true);
    expect(isProjectViewHidden("dashboards")).toBe(true);
    expect(isProjectViewHidden("reviews")).toBe(false);
    expect(isProjectViewHidden("tasks")).toBe(false);
  });

  test("trasy wiki, kalendára, plánovaných úloh a Dashboards sú skryté, ostatné nie", () => {
    for (const path of ["/wikis", "/wikis/:workspaceId", "/wikis/ws_1/session/ses_1", "/calendar", "/scheduled", "/workspace/:workspaceId/calendar", "/workspace/ws_1/dashboards"]) {
      expect(isUpstreamRouteHidden(path)).toBe(true);
    }
    for (const path of ["/home", "/projects", "/tasks", "/lehoty", "/workspace/ws_1/reviews", "/wikisx", "/calendar/x"]) {
      expect(isUpstreamRouteHidden(path)).toBe(false);
    }
  });

  test("stará adresa presmeruje na úvodnú stránku režimu (/dnes v Lite, /home v Pro)", () => {
    const screen = <p>upstream</p>;
    for (const path of ["/wikis", "/wikis/:workspaceId/session/:sessionId", "/calendar", "/scheduled", "/workspace/:workspaceId/calendar"]) {
      expect(upstreamRoute(path, screen).type).toBe(LawossLanding);
    }
    expect(upstreamRoute("/workspace/:workspaceId/reviews", screen)).toBe(screen);
    expect(landingPath("lite")).toBe("/dnes");
    expect(landingPath("pro")).toBe("/home");
  });

  test("app-root posiela skryté trasy upstreamu cez presmerovanie LAWOSS", () => {
    const root = readFileSync(join(import.meta.dir, "../src/react-app/shell/app-root.tsx"), "utf8");
    for (const path of ["/wikis", "/wikis/:workspaceId", "/wikis/:workspaceId/session/:sessionId", "/scheduled", "/calendar", "/workspace/:workspaceId/calendar", "/workspace/:workspaceId/dashboards"]) {
      expect(root).toContain(`<Route path="${path}" element={upstreamRoute("${path}", `);
    }
  });

  test("miesta vykreslenia používajú prepínače", () => {
    const read = (path: string) => readFileSync(join(import.meta.dir, "../src", path), "utf8");
    expect(read("react-app/domains/session/sidebar/app-sidebar.tsx")).toContain("hideCommercialSidebarItems(shellConfig.chatSectionOrder)");
    expect(read("react-app/domains/session/sidebar/app-sidebar.tsx")).toContain("hideCommercialSidebarItems(config.projectNavOrder)");
    expect(read("react-app/domains/workspace/projects-page.tsx")).toContain("hideCommercialSidebarItems(config.projectNavOrder)");
    expect(read("react-app/domains/session/panel/side-panel.tsx")).toContain(".filter(view => !isProjectViewHidden(view))");
    const session = read("react-app/domains/session/chat/session-page.tsx");
    expect(session).toContain("onOpenWiki={props.wiki?.client && !isWikiHidden() ?");
    expect(session).toContain("props.wiki?.client && !isWikiHidden() ? pane =>");
    expect(session).toContain('inWorkspace || isProjectViewHidden("calendar") ? undefined');
    expect(read("react-app/domains/workspace/project-home.tsx")).toContain('isProjectViewHidden("calendar") ? null : <UpcomingDeadlines');
  });
});

describe("spec 0017 S5: plochy Eigenweltu natrvalo skryté", () => {
  test("tímová wiki, Zdieľané projekty a odber kalendára", () => {
    expect(isCommercialSurfaceHidden("wiki-team")).toBe(true);
    expect(isCommercialSurfaceHidden("shared-projects")).toBe(true);
    expect(isCommercialSurfaceHidden("calendar-subscription")).toBe(true);
    expect(isSidebarItemHidden("sectionSharedProjects")).toBe(true);
  });

  test("miesta vykreslenia sa pýtajú svojej plochy", () => {
    const read = (path: string) => readFileSync(join(import.meta.dir, "../src", path), "utf8");
    expect(read("react-app/domains/calendar/calendar-view.tsx")).toContain('isCommercialSurfaceHidden("calendar-subscription") ? null : <Button');
    const wiki = read("react-app/domains/wiki/wiki-dialogs.tsx");
    expect(wiki).toContain('isCommercialSurfaceHidden("wiki-team") ? null : <TabsTrigger value="join"');
    expect(wiki).toContain('isCommercialSurfaceHidden("wiki-team") ? null : <fieldset');
    expect(wiki).toContain('isCommercialSurfaceHidden("wiki-team") ? null : <TabsTrigger value="sharing"');
    expect(wiki).toContain('isCommercialSurfaceHidden("wiki-team") ? null : <TabsContent value="sharing"');
  });
});
