import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { liteSettingsTabs, isSidebarItemVisible, isWorkspaceSwitcherVisible, landingPath } from "../src/lawoss/lite/visibility";
import { SettingsSidebar } from "../src/react-app/domains/settings/shell/settings-page";
import { t } from "@/i18n";
import { LAWOSS_ROUTES } from "../src/lawoss/shell/routes";
import { LiteNav, LiteNavView } from "../src/lawoss/lite/lite-nav";
import { UiModeSwitchView } from "../src/lawoss/lite/ui-mode-switch";
import { LawossNav, LawossLayout } from "../src/lawoss/shell/layout";
import { liteMatterLink } from "../src/lawoss/lite/links";

const html = (node: ReactElement) => renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter><SidebarProvider>{node}</SidebarProvider></MemoryRouter>
  </QueryClientProvider>,
);

describe("napojení LAWOSS-lite", () => {
  const tabs = ["ai", "office-addins", "extensions", "personalisation", "appearance", "notifications", "safety", "shell", "environment", "preferences", "updates"];
  test("lite: nastavení jen AI, kancelář (personalizace) a vzhled; pro beze změny", () => {
    expect(liteSettingsTabs(tabs, "lite")).toEqual(["ai", "personalisation", "appearance"]);
    expect(liteSettingsTabs(tabs, "pro")).toBe(tabs);
    expect(liteSettingsTabs(["permissions"], "lite")).toEqual([]);
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
  test("úvodní stránka: lite → /dnes, pro beze změny /prehlad", () => {
    expect(landingPath("lite")).toBe("/dnes");
    expect(landingPath("pro")).toBe("/prehlad");
  });
});

describe("boční panel LAWOSS-lite", () => {
  const recent = [
    { path: "Klienti/Novák/Spisy/Odvolání", title: "Novák — 14 C 101/2025" },
    { path: "Klienti/ACME/Spisy/Převod", title: "ACME s.r.o. — převod podílu" },
  ];
  test("LiteNav: Dnes · Klienti a věci · Zeptat se jako odkazy", () => {
    const out = html(<LiteNav />);
    for (const [item, to] of [["today", "/dnes"], ["clients", "/klienti"], ["ask", "/session"]] as const) {
      // odkaz (<a href>) nesoucí značku položky
      expect(out).toMatch(new RegExp(`<a(?=[^>]*href="${to}")(?=[^>]*data-lawoss-lite-nav="${item}")[^>]*>`));
    }
    expect(out).not.toContain("EXP");
  });
  test("Poslední věci: nejvýš 5 odkazů na věc", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ path: `Klienti/K${i}/Spisy/V${i}`, title: `Věc ${i}` }));
    const out = html(<LiteNavView recent={many} />);
    expect(out).toContain("Recent matters");
    expect(out.match(/data-lawoss-lite-recent/g)?.length).toBe(5);
    expect(html(<LiteNavView recent={recent} />)).toContain(`href="${liteMatterLink(recent[0].path).replace(/&/g, "&amp;")}"`);
    expect(html(<LiteNavView recent={[]} />)).not.toContain("Recent matters");
  });
  test("pro: LawossNav a LawossLayout beze změny (Experiments, lišta odkazů)", () => {
    // SSR snapshot režimu je "pro" — tedy dnešní chování.
    const nav = html(<LawossNav />);
    expect(nav).toContain("EXP");
    expect(nav).not.toContain("data-lawoss-lite-nav");
    expect(html(<LawossLayout><p>obsah</p></LawossLayout>)).toContain("lw-experiment-nav");
  });
  test("přepínač režimu: obě volby jako tlačítka, aktivní aria-pressed", () => {
    const out = html(<UiModeSwitchView mode="lite" onChange={() => {}} />);
    expect(out).toContain("Simple");
    expect(out).toContain("Advanced");
    expect(out).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Simple<\/button>/);
    expect(out).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Advanced<\/button>/);
    expect(out).toContain("Same data in both modes");
  });
});

describe("nastavení LAWOSS-lite: přepínač workspace", () => {
  test("lite přepínač workspace skryje, pro ho ukáže", () => {
    expect(isWorkspaceSwitcherVisible("lite")).toBe(false);
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
