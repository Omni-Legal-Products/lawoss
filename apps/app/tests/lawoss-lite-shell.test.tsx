import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { liteSettingsTabs, isMainRailItemVisible, isSidebarItemVisible, isWorkspaceSwitcherVisible, isLandingPath, landingPath } from "../src/lawoss/lite/visibility";
import { SettingsSidebar } from "../src/react-app/domains/settings/shell/settings-page";
import { t } from "@/i18n";
import { LAWOSS_ROUTES } from "../src/lawoss/shell/routes";
import { askTarget, LiteNav, LiteNavView, restoresOfficeScope } from "../src/lawoss/lite/lite-nav";
import { UiModeSwitchView } from "../src/lawoss/lite/ui-mode-switch";
import { LawossNav, LawossLayout } from "../src/lawoss/shell/layout";
import { ADD_FOLDER_PATH, LITE_MATTER_PATH, liteMatterLink } from "../src/lawoss/lite/links";
import type { OkfScope } from "../src/lawoss/okf/read-model";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";
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
  const recent = [
    { path: "Klienti/Novák/Spisy/Odvolání", title: "Novák - 14 C 101/2025" },
    { path: "Klienti/ACME/Spisy/Převod", title: "ACME s.r.o. - převod podílu" },
  ];
  test("LiteNav: Dnes · Klienti a věci · Zeptat se jako odkazy", () => {
    const out = html(<LiteNav />);
    for (const [item, to] of [["today", "/dnes"], ["clients", "/klienti"], ["ask", "/session"]] as const) {
      // odkaz (<a href>) nesoucí značku položky
      expect(out).toMatch(new RegExp(`<a(?=[^>]*href="${to}")(?=[^>]*data-lawoss-lite-nav="${item}")[^>]*>`));
    }
    expect(out).not.toContain("EXP");
  });
  test("strom klientov nahradil Posledné veci (variant A, 19. 10. 2026); bez klientov oddiel chýba", () => {
    const tree = [{ key: "client:Novák", title: "Novák", expanded: true, current: true, matters: recent.map((m) => ({ ...m, deadlines: [], expanded: false, current: false, conversations: [], more: false, canStart: true })) }];
    const out = html(<LiteNavView tree={tree} />);
    expect(out).not.toContain("Recent matters");
    expect(out).toContain("data-lawoss-lite-tree");
    expect(out).toContain(`href="${liteMatterLink(recent[0].path).replace(/&/g, "&amp;")}"`);
    expect(html(<LiteNavView tree={[]} />)).not.toContain("data-lawoss-lite-tree");
  });
  test("jedna navigácia v oboch režimoch: Dnes · Klienti a veci · Opýtať sa · Pridať priečinok (G2, 19. 10. 2026)", () => {
    // SSR snapshot režimu je vždy "pro" (getServerSnapshot). LawossNav sa už podľa režimu nevetví,
    // takže jedno vykreslenie pokrýva bežný aj Pokročilý režim.
    const nav = html(<LawossNav />);
    for (const [item, to] of [["today", "/dnes"], ["clients", "/klienti"], ["ask", "/session"], ["add_folder", ADD_FOLDER_PATH]] as const) {
      const href = to.replace(/[?]/g, "\\?");
      expect(nav).toMatch(new RegExp(`<a(?=[^>]*href="${href}")(?=[^>]*data-lawoss-lite-nav="${item}")[^>]*>`));
    }
    expect(nav).toContain("Add folder");
  });
  test("Pridať priečinok: aria-current len na presnej adrese, nie na inom kroku /welcome", () => {
    const at = (entry: string) => renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[entry]}><SidebarProvider><LiteNavView /></SidebarProvider></MemoryRouter>
      </QueryClientProvider>,
    );
    const anchor = (out: string) => out.match(/<a[^>]*data-lawoss-lite-nav="add_folder"[^>]*>/)?.[0] ?? "";
    expect(anchor(at("/welcome?continue=matter"))).not.toContain("aria-current");
    expect(anchor(at(ADD_FOLDER_PATH))).toContain('aria-current="page"');
  });
  test("Pokročilý režim drží vybraný priečinok: návrat na Dnes/Klienti/Vec rozsah nemení, bežný režim áno", () => {
    for (const path of ["/dnes", "/klienti", LITE_MATTER_PATH]) {
      expect(restoresOfficeScope(path, "pro")).toBe(false);
      expect(restoresOfficeScope(path, "lite")).toBe(true);
    }
    expect(restoresOfficeScope("/session", "lite")).toBe(false);
  });
  test("Opýtať sa: v Pokročilom režime konverzácia v aktívnom priečinku, bežný režim beze zmeny", () => {
    const ws = (id: string): RouteWorkspace => ({ id, path: `/k/${id}`, name: id, displayNameResolved: id, workspaceType: "local" });
    const acme = ws("acme");
    const scope: OkfScope = { anchor: ws("prax"), members: [{ workspace: acme, prefix: "ACME" }] };
    const matter = `?vec=${encodeURIComponent("ACME/Spisy/Prevod")}`;
    // Pro: nikdy kancelária ani klient (tie aktivujú iný priečinok), vždy aktívny priečinok.
    for (const [count, sc, path, search] of [[0, null, "/dnes", ""], [1, scope, "/dnes", ""], [3, scope, "/dnes", ""], [3, scope, LITE_MATTER_PATH, matter]] as const) {
      expect(askTarget("pro", sc, count, path, search)).toEqual({ kind: "active" });
    }
    // Lite: ako doteraz.
    expect(askTarget("lite", scope, 1, "/dnes", "")).toEqual({ kind: "office" });
    expect(askTarget("lite", null, 3, "/dnes", "")).toEqual({ kind: "office" });
    expect(askTarget("lite", scope, 3, "/dnes", "")).toEqual({ kind: "pick" });
    expect(askTarget("lite", scope, 3, LITE_MATTER_PATH, matter)).toEqual({ kind: "client", workspaceId: "acme" });
  });
  test("panel Experimenty nie je v žiadnom režime, ani lišta experimentov nad stránkou (G2 V2)", () => {
    const nav = html(<LawossNav />);
    expect(nav).not.toContain('data-lawoss-nav="experiments"');
    expect(nav).not.toContain("EXP");
    expect(html(<LawossLayout><p>obsah</p></LawossLayout>)).not.toContain("lw-experiment-nav");
  });
  test("sidebar: bez riadku ikon onboardingu; Pokročilé pridá Nový chat a sekcie upstreamu", () => {
    const sidebar = readFileSync(join(import.meta.dir, "../src/react-app/domains/session/sidebar/app-sidebar.tsx"), "utf8");
    expect(sidebar).not.toContain("OnboardingEntryActions");
    expect(sidebar).toContain("<OkfWorkspaceSkillSync");
    // Projekty a Nedávne sesie (chatSectionOrder) a Nový chat len v Pokročilom režime, ako doteraz.
    expect(sidebar).toContain("{!lite && newChatSection && ");
    expect(sidebar).toContain("{!lite && hideCommercialSidebarItems(shellConfig.chatSectionOrder)");
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
  for (const key of ["navTasks", "navWorkflows", "navRecorder", "navEvaluations"]) {
    expect(isMainRailItemVisible(key, "lite")).toBe(false);
    expect(isMainRailItemVisible(key, "pro")).toBe(true);
  }
  for (const key of ["navHome", "navProjects"]) expect(isMainRailItemVisible(key, "lite")).toBe(true);
});
