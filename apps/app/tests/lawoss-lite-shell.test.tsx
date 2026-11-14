import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { liteSettingsTabs, isMainRailItemVisible, isMainRailShown, isSidebarHeaderToolsVisible, isSidebarItemVisible, isWorkspaceSwitcherVisible, isLandingPath, landingPath } from "../src/lawoss/lite/visibility";
import { SettingsSidebar } from "../src/react-app/domains/settings/shell/settings-page";
import { t } from "@/i18n";
import { LAWOSS_ROUTES } from "../src/lawoss/shell/routes";
import { LiteNav, LiteNavView, restoresOfficeScope } from "../src/lawoss/lite/lite-nav";
import { UiModeSwitchView } from "../src/lawoss/lite/ui-mode-switch";
import { LawossNav, LawossLayout } from "../src/lawoss/shell/layout";
import { LEHOTY_PATH, LITE_MATTER_PATH, NEW_CLIENT_PATH } from "../src/lawoss/lite/links";
import { LiteSidebarFooterView, registersText } from "../src/lawoss/lite/sidebar-footer";
import { deadlineAttentionCount, feedbackPageUrl, registersSummary } from "../src/lawoss/lite/sidebar-model";
import { publishMcpStatuses } from "../src/lawoss/lite/mcp-status-store";
import type { McpStatusMap } from "../src/app/types";
import { GeneralSettingsView } from "../src/react-app/domains/settings/pages/general-view";
import { currentUiMode, setUiMode } from "../src/lawoss/lite/ui-mode";

const html = (node: ReactElement) => renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter><SidebarProvider>{node}</SidebarProvider></MemoryRouter>
  </QueryClientProvider>,
);

describe("napojení LAWOSS-lite", () => {
  const tabs = ["ai", "office-addins", "extensions", "personalisation", "appearance", "notifications", "safety", "shell", "environment", "preferences", "updates"];
  test("lite retains native integrations and permissions; pro is unchanged", () => {
    expect(liteSettingsTabs(tabs, "lite")).toEqual(["ai", "extensions", "personalisation", "appearance", "updates"]);
    expect(liteSettingsTabs(tabs, "pro")).toBe(tabs);
    expect(liteSettingsTabs(["permissions"], "lite")).toEqual(["permissions"]);
    expect(isWorkspaceSwitcherVisible("lite")).toBe(true);
  });
  test("lite skryje technické položky panelu, pro je ukáže", () => {
    for (const item of ["new_task", "tasks", "workflows", "recorder", "evals", "folders"] as const) {
      expect(isSidebarItemVisible(item, "lite")).toBe(false);
      expect(isSidebarItemVisible(item, "pro")).toBe(true);
    }
  });
  test("trasy /dnes, /klienti, /vec existují a stávající zůstaly", () => {
    const paths = LAWOSS_ROUTES.map((r) => r.path);
    for (const path of ["/dnes", "/klienti", "/vec", "/prehlad", "/spis", "/lehoty", "/experimenty/novy-spis"]) expect(paths).toContain(path);
  });
  test("úvodní stránka: lite → /dnes, pro zachová upstream /home", () => {
    expect(landingPath("lite")).toBe("/dnes");
    expect(landingPath("pro")).toBe("/home");
  });

  test("úvodné stránky povolia presmerovanie na /welcome pri prvom spustení, ostatné trasy LAWOSS nie", () => {
    expect(isLandingPath(landingPath("lite"))).toBe(true);
    expect(isLandingPath(landingPath("pro"))).toBe(true);
    expect(isLandingPath("/klienti")).toBe(false);
    expect(isLandingPath("/welcome")).toBe(false);
  });
});

describe("boční panel LAWOSS-lite", () => {
  test("LiteNav: Dnes a Pridať klienta ako odkazy (MČ 19. 10. 2026)", () => {
    const out = html(<LiteNav />);
    for (const [item, to] of [["today", "/dnes"], ["add_client", NEW_CLIENT_PATH]] as const) {
      // odkaz (<a href>) nesoucí značku položky
      expect(out).toMatch(new RegExp(`<a(?=[^>]*href="${to.replace(/[?]/g, "\\?")}")(?=[^>]*data-lawoss-lite-nav="${item}")[^>]*>`));
    }
    expect(out).not.toContain("EXP");
  });
  test("Pokročilý režim bez zmeny: Dnes · (natívny Nový chat) · Pridať klienta", () => {
    // SSR snapshot režimu je vždy "pro" (getServerSnapshot); bežný režim overuje LiteNavView s mode="lite" nižšie.
    const nav = html(<LawossNav />);
    expect(nav).toContain('data-lawoss-lite-nav="today"');
    expect(nav).toContain('data-lawoss-lite-nav="add_client"');
    expect(nav).toContain("Add client");
    // Klienti a ich prípady sú v natívnej sekcii projektov, nie v navigácii LAWOSS.
    for (const gone of ['data-lawoss-lite-nav="clients"', 'data-lawoss-lite-nav="ask"', 'data-lawoss-lite-nav="add_folder"', "data-lawoss-lite-tree"]) expect(nav).not.toContain(gone);
  });
  test("Pridať klienta: aria-current len na presnej adrese, nie na inom kroku /welcome", () => {
    const at = (entry: string) => renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[entry]}><SidebarProvider><LiteNavView /></SidebarProvider></MemoryRouter>
      </QueryClientProvider>,
    );
    const anchor = (out: string) => out.match(/<a[^>]*data-lawoss-lite-nav="add_client"[^>]*>/)?.[0] ?? "";
    expect(anchor(at("/welcome?continue=matter"))).not.toContain("aria-current");
    expect(anchor(at(NEW_CLIENT_PATH))).toContain('aria-current="page"');
  });
  test("Pokročilý režim drží vybraný priečinok: návrat na Dnes/Klienti/Vec rozsah nemení, bežný režim áno", () => {
    for (const path of ["/dnes", "/klienti", LITE_MATTER_PATH]) {
      expect(restoresOfficeScope(path, "pro")).toBe(false);
      expect(restoresOfficeScope(path, "lite")).toBe(true);
    }
    expect(restoresOfficeScope("/session", "lite")).toBe(false);
  });
  test("panel Experimenty nie je v žiadnom režime, ani lišta experimentov nad stránkou (G2 V2)", () => {
    const nav = html(<LawossNav />);
    expect(nav).not.toContain('data-lawoss-nav="experiments"');
    expect(nav).not.toContain("EXP");
    expect(html(<LawossLayout><p>obsah</p></LawossLayout>)).not.toContain("lw-experiment-nav");
  });
  test("sidebar: bez riadku ikon onboardingu; natívny Nový chat a sekcia klientov v oboch režimoch", () => {
    const sidebar = readFileSync(join(import.meta.dir, "../src/react-app/domains/session/sidebar/app-sidebar.tsx"), "utf8");
    expect(sidebar).not.toContain("OnboardingEntryActions");
    expect(sidebar).toContain("<OkfWorkspaceSkillSync");
    // MČ 19. 10. 2026: Nový chat ide do navigácie LAWOSS; sekcie filtruje režim (Lite: pripnuté a nedávne predvolene vypnuté,
    // vykreslenie overuje lawoss-native-sidebar.test.tsx).
    expect(sidebar).toContain("<LawossNav activePane={Boolean(props.activeNav)} newChat={newChatSection} onOpenSearch={props.onOpenSearch} />");
    expect(sidebar).toContain("chatSections.shown(key, shellConfig[key])");
  });
  test("alfa 14, bežný režim: Dnes · Lehoty a úlohy (počet) · Hľadať; bez Nového chatu a Pridať klienta", () => {
    const at = (entry: string, deadlines: number | null, onOpenSearch?: () => void) => renderToStaticMarkup(
      <MemoryRouter initialEntries={[entry]}><SidebarProvider>
        <LiteNavView mode="lite" deadlines={deadlines} onOpenSearch={onOpenSearch} newChat={<li data-native-new-chat="">x</li>} />
      </SidebarProvider></MemoryRouter>,
    );
    const nav = at("/dnes", 2, () => {});
    const order = ["today", "deadlines", "search"].map((item) => nav.indexOf(`data-lawoss-lite-nav="${item}"`));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(nav).not.toContain('data-lawoss-lite-nav="add_client"');
    expect(nav).not.toContain("data-native-new-chat");
    // Lehoty a úlohy: odkaz na register lehôt, počet aj pre čítačku obrazovky.
    expect(nav).toMatch(new RegExp(`<a(?=[^>]*href="${LEHOTY_PATH}")(?=[^>]*data-lawoss-lite-nav="deadlines")[^>]*>`));
    expect(nav).toContain("Overdue or due within 7 days: 2");
    expect(at("/dnes", null, () => {})).not.toContain("data-lawoss-lite-nav-count");
    // aria-current: Dnes na /dnes, Lehoty a úlohy na /lehoty (nie na lehotách jedného klienta).
    const anchor = (out: string, item: string) => out.match(new RegExp(`<a[^>]*data-lawoss-lite-nav="${item}"[^>]*>`))?.[0] ?? "";
    expect(anchor(nav, "today")).toContain('aria-current="page"');
    expect(anchor(at(LEHOTY_PATH, 1, () => {}), "deadlines")).toContain('aria-current="page"');
    expect(anchor(at(`${LEHOTY_PATH}?klient=tatran`, 1, () => {}), "deadlines")).not.toContain("aria-current");
    // Hľadať: tlačidlo dialógu so skratkou; bez obsluhy vypnuté.
    expect(nav).toMatch(/<button(?=[^>]*aria-haspopup="dialog")(?=[^>]*aria-keyshortcuts="(Meta|Control)\+k")(?=[^>]*data-lawoss-lite-nav="search")[^>]*>/);
    expect(nav).toMatch(/<kbd[^>]*>(⌘K|Ctrl K)<\/kbd>/);
    expect(at("/dnes", null).match(/<button[^>]*data-lawoss-lite-nav="search"[^>]*>/)?.[0]).toContain("disabled");
    // Pokročilý režim (bez mode) ostáva pôvodný.
    const pro = renderToStaticMarkup(<MemoryRouter><SidebarProvider><LiteNavView newChat={<li data-native-new-chat="">x</li>} /></SidebarProvider></MemoryRouter>);
    expect(pro).toContain('data-lawoss-lite-nav="add_client"');
    expect(pro).toContain("data-native-new-chat");
    expect(pro).not.toContain('data-lawoss-lite-nav="deadlines"');
  });
  test("alfa 14: počet lehôt po termíne a do 7 dní zo súčtov prehľadu; bez prehľadu alebo nula nič", () => {
    const totals = (overdue: number, deadlinesWithin7Days: number) => ({ totals: { matters: 1, openTasks: 0, records: 0, overdue, deadlinesWithin7Days } });
    expect(deadlineAttentionCount(totals(1, 2))).toBe(3);
    expect(deadlineAttentionCount(totals(0, 0))).toBeNull();
    expect(deadlineAttentionCount(undefined)).toBeNull();
  });
  test("alfa 14: stav registrov len z konektorov LAWOSS Marketplace; vypnuté sa nepočítajú, neznáme nič netvrdí", () => {
    const map = (entries: Record<string, McpStatusMap[string]>): McpStatusMap => entries;
    expect(registersSummary(null)).toEqual({ state: "unknown" });
    expect(registersSummary(map({ vlastny: { status: "connected" } }))).toEqual({ state: "unknown" });
    expect(registersSummary(map({ slovlex: { status: "connected" }, orsr: { status: "connected" }, ruz: { status: "disabled" }, vlastny: { status: "failed", error: "x" } })))
      .toEqual({ state: "ready", ready: 2, total: 2 });
    expect(registersSummary(map({ slovlex: { status: "connected" }, orsr: { status: "pending" } }))).toEqual({ state: "starting", ready: 1, total: 2 });
    expect(registersSummary(map({ slovlex: { status: "failed", error: "npm" }, orsr: { status: "needs_auth" }, cz_ares: { status: "connected" } })))
      .toEqual({ state: "failing", failing: 2, total: 3 });
    expect(registersText({ state: "ready", ready: 6, total: 6 }, "sk")).toEqual({ label: "Registre pripravené", meta: "6/6" });
    expect(registersText({ state: "failing", failing: 2, total: 6 }, "sk")).toEqual({ label: "Registre: 2 nejdú" });
    expect(registersText({ state: "failing", failing: 1, total: 6 }, "sk")?.label).toBe("Registre: 1 nejde");
    expect(registersText({ state: "failing", failing: 5, total: 6 }, "cs")?.label).toBe("Registry: 5 nefunguje");
    expect(registersText({ state: "starting", ready: 1, total: 2 }, "sk")).toEqual({ label: "Registre sa spúšťajú", meta: "1/2" });
    expect(registersText({ state: "unknown" }, "sk")).toBeNull();
  });
  test("alfa 14: spodok panela – registre do Integrácií, hlásenie chyby, Nastavenia; chyba registrov výstražnou farbou", () => {
    const footer = (summary: Parameters<typeof LiteSidebarFooterView>[0]["summary"], entry = "/dnes", workspaceId: string | null = "ws1") => renderToStaticMarkup(
      <MemoryRouter initialEntries={[entry]}><SidebarProvider><LiteSidebarFooterView workspaceId={workspaceId} summary={summary} locale="sk" onReport={() => {}} /></SidebarProvider></MemoryRouter>,
    );
    const ready = footer({ state: "ready", ready: 6, total: 6 });
    expect(ready).toMatch(/<a(?=[^>]*href="\/workspace\/ws1\/settings\/extensions\/mcp")(?=[^>]*data-lawoss-lite-nav="registers")[^>]*>/);
    expect(ready).toContain("Registre pripravené");
    expect(ready).toContain(">6/6<");
    expect(ready).toMatch(/<button[^>]*data-lawoss-lite-nav="report"[^>]*>/);
    expect(ready).toContain("Nahlásiť chybu alebo nápad");
    expect(ready).toMatch(/<a(?=[^>]*href="\/workspace\/ws1\/settings\/general")(?=[^>]*data-lawoss-lite-nav="settings")[^>]*>/);
    expect(ready.indexOf('data-lawoss-lite-nav="registers"')).toBeLessThan(ready.indexOf('data-lawoss-lite-nav="report"'));
    expect(ready.indexOf('data-lawoss-lite-nav="report"')).toBeLessThan(ready.indexOf('data-lawoss-lite-nav="settings"'));
    expect(footer({ state: "failing", failing: 2, total: 6 })).toMatch(/class="[^"]*lw-registers[^"]*"[^>]*data-state="failing"|data-state="failing"[^>]*class="[^"]*lw-registers/);
    expect(footer({ state: "unknown" })).not.toContain('data-lawoss-lite-nav="registers"');
    expect(footer({ state: "unknown" }, "/settings/general", null)).toMatch(/<a(?=[^>]*href="\/settings\/general")(?=[^>]*aria-current="page")[^>]*>/);
    const css = readFileSync(join(import.meta.dir, "../src/lawoss/shell/lawoss.css"), "utf8");
    expect(css).toContain('.lw-registers[data-state="failing"] .lw-registers-label { color: var(--lw-warning); }');
  });
  test("alfa 14: hlásenie chyby na lawoss.app v jazyku appky (sk, cz, inak en)", () => {
    expect(feedbackPageUrl("sk")).toBe("https://lawoss.app/sk/alfa/hlasenie");
    expect(feedbackPageUrl("cs")).toBe("https://lawoss.app/cz/alfa/hlasenie");
    expect(feedbackPageUrl("en")).toBe("https://lawoss.app/en/alfa/hlasenie");
    expect(feedbackPageUrl("de")).toBe("https://lawoss.app/en/alfa/hlasenie");
  });
  test("alfa 14: Dokumenty bez samostatnej akcie (práca je v chate); Tabuľková kontrola ostáva v Pokročilom strome", () => {
    // Predtým v bežnom režime tlačidlo „Porovnať dokumenty“ v hlavičke Súborov (odstránené rozhodnutím MČ 14. 11. 2026).
    const page = readFileSync(join(import.meta.dir, "../src/react-app/domains/workspace/project-files-page.tsx"), "utf8");
    expect(page).not.toContain("CompareDocuments");
    expect(page).not.toContain("LAWOSS: v bežnom režime");
    const sidebar = readFileSync(join(import.meta.dir, "../src/react-app/domains/session/sidebar/app-sidebar.tsx"), "utf8");
    expect(sidebar).toContain('projectReviews: <SidebarMenuSubItem key="projectReviews">');
    // Ceruzka pri rozbalenom klientovi zakladá chat: v bežnom režime „Nový chat“, v Pokročilom natívne.
    expect(sidebar).toContain('aria-label={projectNav.lite ? t("projects.new_chat") : t("session.new_task")}');
    expect(t("projects.new_chat", "sk")).toBe("Nový chat");
  });
  test("alfa 14: stav MCP zverejní existujúce čítanie stavového riadku, nie nové čítanie", () => {
    const hook = readFileSync(join(import.meta.dir, "../src/react-app/domains/connections/use-mcp-connected-count.ts"), "utf8");
    expect(hook).toContain("publishMcpStatuses(status);");
    const footer = readFileSync(join(import.meta.dir, "../src/lawoss/lite/sidebar-footer.tsx"), "utf8");
    expect(footer).not.toMatch(/readMcpStatuses|mcp\.list/);
    publishMcpStatuses(null);
  });
  test("prepínač Pokročilé: jeden spínač, bežná appka bez nálepky Simple/Lite (MČ 16. 10. 2026)", () => {
    const off = html(<UiModeSwitchView mode="lite" onChange={() => {}} />);
    expect(off).toContain("Advanced");
    expect(off).not.toMatch(/Simple|Lite/);
    expect(off).toMatch(/role="switch"[^>]*aria-checked="false"|aria-checked="false"[^>]*role="switch"/);
    expect(off).toContain("Your data stay the same");
    expect(html(<UiModeSwitchView mode="pro" onChange={() => {}} />)).toMatch(/role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/);
  });
});

describe("nastavení LAWOSS-lite: přepínač workspace", () => {
  test("Nastavení → Obecné: lite skryje patičku s „workspace“, pro ji ukáže (final review I4)", () => {
    const before = currentUiMode();
    const footer = t("settings.tab_description_general");
    try {
      setUiMode("lite");
      expect(html(<GeneralSettingsView onNavigateTab={() => {}} developerMode={false} />)).not.toContain(footer);
      setUiMode("pro");
      expect(html(<GeneralSettingsView onNavigateTab={() => {}} developerMode={false} />)).toContain(footer);
    } finally { setUiMode(before); }
  });
  test("oba režimy zobrazia projekt, ktorého oprávnenia sa upravujú", () => {
    expect(isWorkspaceSwitcherVisible("lite")).toBe(true);
    expect(isWorkspaceSwitcherVisible("pro")).toBe(true);
  });
  test("pro: boční panel nastavení dál vykreslí přepínač s popiskem skupiny", () => {
    // SSR snapshot režimu je "pro".
    const out = html(<SettingsSidebar activeTab="general" onSelectTab={() => {}} developerMode={false} onClose={() => {}}
      selectedWorkspaceId="ws_fiktivni" selectedWorkspaceName="Kancelář Vzorová" selectedWorkspaceColor="#888"
      workspaces={[{ id: "ws_fiktivni", name: "Kancelář Vzorová", color: "#888" }]} onSelectWorkspace={() => {}} />);
    expect(out).toContain("Kancelář Vzorová");
    expect(out).toContain(t("settings.group_workspace"));
  });
});

test("native action rail keeps projects and hides advanced actions only in Lite", () => {
  // Alfa 14: in Lite the rail itself shows only when the sidebar is collapsed (isMainRailShown below).
  for (const key of ["navTasks", "navWorkflows", "navRecorder", "navEvaluations"]) {
    expect(isMainRailItemVisible(key, "lite")).toBe(false);
    expect(isMainRailItemVisible(key, "pro")).toBe(true);
  }
  for (const key of ["navHome", "navProjects"]) expect(isMainRailItemVisible(key, "lite")).toBe(true);
});

test("alfa 14: bežný režim bez ľavej lišty (okrem zbaleného panela) a bez Prispôsobiť navigáciu; Pokročilý bez zmeny", () => {
  expect(isMainRailShown("lite", false)).toBe(false);
  expect(isMainRailShown("lite", true)).toBe(true);
  expect(isMainRailShown("pro", false)).toBe(true);
  expect(isSidebarHeaderToolsVisible("lite")).toBe(false);
  expect(isSidebarHeaderToolsVisible("pro")).toBe(true);
  const sidebar = readFileSync(join(import.meta.dir, "../src/react-app/domains/session/sidebar/app-sidebar.tsx"), "utf8");
  expect(sidebar).toContain("{(!customizingNavigation || collapsed) && isMainRailShown(uiMode, collapsed) && <MainActionRail");
  expect(sidebar).toContain("{isSidebarHeaderToolsVisible(uiMode) && <div className=\"ml-auto flex shrink-0 items-center gap-0.5\">");
  expect(sidebar).toContain('{uiMode === "lite" && <LiteSidebarFooter workspaceId={props.selectedWorkspaceId} />}');
});
