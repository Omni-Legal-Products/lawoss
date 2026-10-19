// Natívny bočný panel s klientmi a prípadmi (rozhodnutie MČ 19. 10. 2026): klient = natívny projekt
// (registrovaný priečinok), pod ním Domov, Prípady, Lehoty, Úlohy, Súbory, Chaty.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { t, type Language } from "@/i18n";
import { isChatSectionVisible } from "../src/lawoss/lite/visibility";
import { LawossNav } from "../src/lawoss/shell/layout";
import { NEW_CLIENT_PATH, clientDeadlinesLink, liteMatterLink } from "../src/lawoss/lite/links";
import { clientDeadlines, clientGroupsOf, clientNavAnchor, hiddenClientProjects, isClientProject } from "../src/lawoss/lite/client-projects";
import { ClientMattersView } from "../src/lawoss/lite/client-nav";
import { ClientOverviewView } from "../src/lawoss/lite/client-overview";
import { buildClientTree, type ConversationList } from "../src/lawoss/lite/client-tree";
import type { ClientGroup } from "../src/lawoss/lite/today-model";
import type { OkfReadResult, OkfScope } from "../src/lawoss/okf/read-model";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";
import { ShellConfigProvider, useShellConfig, type ShellConfig } from "../src/react-app/shell/shell-config";
import { SIDEBAR_ITEMS } from "../src/react-app/domains/session/sidebar/sidebar-customization";
import { shellCs, shellDe, shellEn, shellSk } from "../src/lawoss/i18n/shell";

const source = (path: string) => readFileSync(join(import.meta.dir, "../src", path), "utf8");
const html = (node: ReactElement, entry = "/dnes") => renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[entry]}><SidebarProvider>{node}</SidebarProvider></MemoryRouter>
  </QueryClientProvider>,
);
const ws = (id: string, path: string): RouteWorkspace => ({ id, path, name: id, displayNameResolved: id, workspaceType: "local" });
const deadline = (date: string) => ({ recordId: `r-${date}`, date, title: `Lehota ${date}`, file: "memory/r.md" });
const matter = (path: string, title: string, dates: string[] = []) => ({ path, title, deadlines: dates.map(deadline), openTasks: [], counts: { records: 1, evidence: 2, subjects: 0 } });

function readConfig(saved: object | null): ShellConfig {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  let config: ShellConfig | undefined;
  function ReadConfig() { config = useShellConfig().config; return null; }
  try {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: () => saved === null ? null : JSON.stringify(saved) } } });
    renderToStaticMarkup(<ShellConfigProvider><ReadConfig /></ShellConfigProvider>);
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
  if (!config) throw new Error("shell config not read");
  return config;
}

describe("Lite ukáže natívnu sekciu klientov (projekty) a natívny Nový chat", () => {
  test("Lite: sekcia projektov áno, pripnuté a nedávne chaty nie; Pro ich ukáže", () => {
    expect(isChatSectionVisible("sectionProjects", "lite")).toBe(true);
    expect(isChatSectionVisible("sectionPinnedProjects", "lite")).toBe(true);
    for (const key of ["sectionPinned", "sectionRecent"]) {
      expect(isChatSectionVisible(key, "lite")).toBe(false);
      expect(isChatSectionVisible(key, "pro")).toBe(true);
    }
  });

  test("bočný panel: sekcie a Nový chat už nie sú len v Pokročilom režime; Nový chat je v navigácii LAWOSS", () => {
    const sidebar = source("react-app/domains/session/sidebar/app-sidebar.tsx");
    expect(sidebar).not.toContain("{!lite && newChatSection");
    expect(sidebar).not.toContain("{!lite && hideCommercialSidebarItems(shellConfig.chatSectionOrder)");
    expect(sidebar).toContain("isChatSectionVisible(key, uiMode)");
    expect(sidebar).toContain("newChat={newChatSection}");
  });

  test("hore: Dnes · Nový chat · Pridať klienta (v tomto poradí); strom ani Opýtať sa už nie sú", () => {
    const nav = html(<LawossNav newChat={<li data-native-new-chat="" />} />);
    const today = nav.indexOf('data-lawoss-lite-nav="today"');
    const chat = nav.indexOf("data-native-new-chat");
    const add = nav.indexOf('data-lawoss-lite-nav="add_client"');
    expect(today).toBeGreaterThan(-1);
    expect(chat).toBeGreaterThan(today);
    expect(add).toBeGreaterThan(chat);
    expect(nav).toMatch(new RegExp(`<a(?=[^>]*href="${NEW_CLIENT_PATH.replace(/[?]/g, "\\?")}")(?=[^>]*data-lawoss-lite-nav="add_client")[^>]*>`));
    expect(nav).toContain("Add client");
    expect(nav).not.toContain("data-lawoss-lite-tree");
    expect(nav).not.toContain('data-lawoss-lite-nav="ask"');
    expect(nav).not.toContain('data-lawoss-lite-nav="clients"');
  });

  test("hlavička sekcie: mriežka vedie na všetkých klientov, + na pridanie klienta", () => {
    const sidebar = source("react-app/domains/session/sidebar/app-sidebar.tsx");
    expect(sidebar).toContain("navigate(LITE_CLIENTS_PATH)");
    expect(sidebar).toContain("navigate(NEW_CLIENT_PATH)");
  });
});

describe("Prípady a Lehoty v natívnom prispôsobení panela", () => {
  test("nové položky projektu sú predvolene zapnuté hneď za Domovom", () => {
    const config = readConfig(null);
    expect(config.projectMatters).toBe(true);
    expect(config.projectDeadlines).toBe(true);
    expect(config.projectNavOrder.slice(0, 3)).toEqual(["projectHome", "projectMatters", "projectDeadlines"]);
  });

  test("uložené poradie starého profilu dostane Prípady a Lehoty za Domov, inak sa nemení", () => {
    const old = ["projectHome", "projectCalendar", "projectReviews", "projectTasks", "projectFiles", "projectSessions"];
    expect(readConfig({ projectNavOrder: old }).projectNavOrder).toEqual(["projectHome", "projectMatters", "projectDeadlines", ...old.slice(1)]);
    const custom = ["projectFiles", "projectHome", "projectSessions"];
    expect(readConfig({ projectNavOrder: custom }).projectNavOrder.slice(0, 5)).toEqual(["projectFiles", "projectHome", "projectMatters", "projectDeadlines", "projectSessions"]);
    const moved = ["projectDeadlines", "projectHome", "projectSessions", "projectMatters"];
    const kept = readConfig({ projectNavOrder: moved, projectMatters: false });
    expect(kept.projectNavOrder.slice(0, 4)).toEqual(moved);
    expect(kept.projectMatters).toBe(false);
  });

  test("prispôsobenie ich ponúkne s preloženým názvom vo všetkých jazykoch", () => {
    for (const key of ["projectMatters", "projectDeadlines"] as const) {
      const label = SIDEBAR_ITEMS[key].label;
      for (const locale of ["sk", "cs", "en", "de"] satisfies Language[]) expect(t(label, locale)).not.toBe(label);
    }
    expect(t(SIDEBAR_ITEMS.projectMatters.label, "sk")).toBe("Prípady");
    expect(t(SIDEBAR_ITEMS.projectDeadlines.label, "sk")).toBe("Lehoty");
    const sidebar = source("react-app/domains/session/sidebar/app-sidebar.tsx");
    expect(sidebar).toContain("projectMatters: <ClientMattersNavItem");
    expect(sidebar).toContain("projectDeadlines: <ClientDeadlinesNavItem");
  });
});

describe("klienti v natívnom zozname: koreň kancelárie nie je klient", () => {
  const root = ws("root", "/prax");
  const tatran = ws("tatran", "/prax/Tatran");
  const hron = ws("hron", "/prax/Hron");
  const nested = ws("uhrada", "/prax/Tatran/Spisy/Uhrada");
  const outside = ws("ine", "/ine/Projekt");

  test("registrovaný koreň praxe s klientmi pod ním sa skryje; staršia vec registrovaná zvlášť tiež", () => {
    expect([...hiddenClientProjects([root, tatran, hron, nested, outside], "/prax")].sort()).toEqual(["root", "uhrada"]);
    expect([...hiddenClientProjects([tatran, hron, outside], "/prax/")]).toEqual([]);
  });

  test("jeden priečinok pre všetko: koreň je jediný záznam a ostane; bez praxe sa nič neskrýva", () => {
    expect([...hiddenClientProjects([root, outside], "/prax")]).toEqual([]);
    expect([...hiddenClientProjects([root, tatran, nested], null)]).toEqual([]);
  });

  test("bočný panel filtruje sekciu klientov podľa skrytých priečinkov", () => {
    const sidebar = source("react-app/domains/session/sidebar/app-sidebar.tsx");
    expect(sidebar).toContain("const hiddenProjects = useHiddenClientProjects();");
    expect(sidebar).toContain(".filter(group => !hiddenProjects.has(group.workspace.id))");
    expect(sidebar).toContain("<ClientNavProvider>");
  });

  test("prax sa číta od klienta praxe, nie od nesúvisiaceho otvoreného priečinka", () => {
    expect(clientNavAnchor([outside, tatran, hron], "/prax", outside)?.id).toBe("tatran");
    expect(clientNavAnchor([outside, tatran], null, outside)?.id).toBe("ine");
    expect(clientNavAnchor([root, tatran], "/prax", tatran)?.id).toBe("tatran");
  });
});

describe("Prípady klienta: veci z OKF podľa priečinka klienta", () => {
  const tatran = ws("tatran", "/prax/Tatran");
  const hron = ws("hron", "/prax/Hron");
  const UHRADA = matter("Tatran/Spisy/Uhrada", "Úhrada dodávok", ["2026-10-21"]);
  const VADY = matter("Tatran/Spisy/Vady", "Vady rekonštrukcie");
  const ZMLUVA = matter("Hron/Spisy/Zmluva", "Zmluva o dielo", ["2026-11-30"]);
  const groups: ClientGroup[] = [
    { key: "client:Hron", client: "SYN Hron Technológie", matters: [ZMLUVA] },
    { key: "client:Tatran", client: "SYN Tatran Automatika", matters: [UHRADA, VADY] },
  ];
  const practice: OkfScope = { anchor: tatran, members: [{ workspace: hron, prefix: "Hron" }, { workspace: tatran, prefix: "Tatran" }], practiceRoot: "/prax" };

  test("každý klient = svoj priečinok; cudzie veci nevidí; neznámy priečinok nie je klient", () => {
    expect(clientGroupsOf(practice, tatran, groups).map((g) => g.key)).toEqual(["client:Tatran"]);
    expect(clientGroupsOf(practice, hron, groups).map((g) => g.key)).toEqual(["client:Hron"]);
    expect(isClientProject(practice, tatran, groups)).toBe(true);
    expect(isClientProject(practice, ws("ine", "/ine/Projekt"), groups)).toBe(false);
    // Klient praxe zatiaľ bez vecí je stále klient (prázdne Prípady), nie cudzí projekt.
    expect(isClientProject(practice, hron, [])).toBe(true);
  });

  test("registrovaný koreň a klienti pod ním: veci patria klientovi podľa cesty, nie koreňu", () => {
    const root = ws("root", "/prax");
    const klient = ws("tatran2", "/prax/Klienti/Tatran");
    const scope: OkfScope = { anchor: root, members: [{ workspace: root, prefix: "" }] };
    const g: ClientGroup[] = [{ key: "client:Klienti/Tatran", client: "Tatran", matters: [matter("Klienti/Tatran/Spisy/A", "A")] }, { key: "client:Klienti/Hron", client: "Hron", matters: [] }];
    expect(clientGroupsOf(scope, klient, g).map((x) => x.key)).toEqual(["client:Klienti/Tatran"]);
    // Jeden priečinok pre všetko: koreň ukáže prípady zoskupené podľa klientov.
    expect(clientGroupsOf(scope, root, g).map((x) => x.key)).toEqual(["client:Klienti/Tatran", "client:Klienti/Hron"]);
  });

  const ready = (items: ConversationList["items"] = []): ConversationList => ({ items, status: "ready", complete: true });
  const chats = [{ workspaceId: "tatran", id: "s-1", title: "Zhrnutie spisu", updated: 2 }, { workspaceId: "tatran", id: "s-2", title: "Návrh odpovede", updated: 1 }];
  const tree = (focus = {}, overrides = {}) => buildClientTree({ groups: [groups[1]], focus, overrides, canStart: () => true,
    lists: { client: () => ready(), matter: (path) => ready(path === UHRADA.path ? chats : []) } });

  test("Prípady zbalené: žiadna vec; rozbalené: veci klienta s odkazom na prehľad veci", () => {
    const closed = html(<ClientMattersView nodes={tree()} open={false} locale="en" />);
    expect(closed).toContain("Matters");
    expect(closed).toMatch(/<button(?=[^>]*data-lawoss-project-matters="")(?=[^>]*aria-expanded="false")[^>]*>/);
    expect(closed).not.toContain("Úhrada dodávok");
    const open = html(<ClientMattersView nodes={tree({}, { "c\u0000client:Tatran": true })} open locale="en" />);
    expect(open).toContain("Úhrada dodávok");
    expect(open).toContain("Vady rekonštrukcie");
    expect(open).toContain(`href="${liteMatterLink(UHRADA.path)}"`);
    expect(open).not.toContain("Zhrnutie spisu");
  });

  test("vec rozbalí svoje chaty a + Nový chat; otvorená vec je označená", () => {
    const built = tree({ matter: UHRADA.path });
    const out = html(<ClientMattersView nodes={built} open locale="en" />, liteMatterLink(UHRADA.path));
    expect(out).toContain("Zhrnutie spisu");
    expect(out).toContain("Návrh odpovede");
    expect(out.match(/data-lawoss-tree-new/g)).toHaveLength(1);
    expect(out).toContain("New chat");
    expect(out).toMatch(/<a(?=[^>]*aria-current="page")[^>]*href="\/vec\?vec=Tatran%2FSpisy%2FUhrada"/);
  });

  test("klient bez vecí: prázdne Prípady to povedia", () => {
    const empty = buildClientTree({ groups: [{ key: "client:Hron", client: "Hron", matters: [] }], focus: {}, overrides: { "c\u0000client:Hron": true }, canStart: () => true, lists: { client: () => ready(), matter: () => ready() } });
    expect(html(<ClientMattersView nodes={empty} open locale="en" />)).toContain("No matters yet");
    expect(html(<ClientMattersView nodes={[]} open locale="en" />)).toContain("No matters yet");
  });

  test("jeden priečinok pre všetko: viac klientov pod jedným projektom, každý so svojím menom", () => {
    const both = buildClientTree({ groups, focus: { matter: UHRADA.path }, overrides: {}, canStart: () => true, lists: { client: () => ready(), matter: () => ready() } });
    const out = html(<ClientMattersView nodes={both} open locale="en" />);
    expect(out).toContain("SYN Hron Technológie");
    expect(out).toContain("SYN Tatran Automatika");
    expect(out).toContain("Úhrada dodávok");
    expect(out).not.toContain("Zmluva o dielo");
  });

  test("Lehoty klienta: len lehoty jeho vecí, odkaz z bočného panela s priečinkom klienta", () => {
    const data = { matters: [UHRADA, VADY, ZMLUVA], inputs: [], clients: [], problems: [], truncated: false,
      upcomingDeadlines: [UHRADA, ZMLUVA].flatMap((m) => m.deadlines.map((d) => ({ ...d, matter: { path: m.path, title: m.title } }))),
      overdue: [], totals: { matters: 3, deadlinesWithin7Days: 1, openTasks: 0, overdue: 0, records: 3 } } satisfies OkfReadResult;
    const own = clientDeadlines(data, practice, tatran, "2026-10-19");
    expect(own.matters.map((m) => m.path)).toEqual([UHRADA.path, VADY.path]);
    expect(own.upcomingDeadlines.map((d) => d.matter.path)).toEqual([UHRADA.path]);
    expect(own.totals.matters).toBe(2);
    expect(own.totals.deadlinesWithin7Days).toBe(1);
    expect(clientDeadlines(data, practice, hron, "2026-10-19").totals.deadlinesWithin7Days).toBe(0);
    expect(clientDeadlinesLink("ws tatran")).toBe("/lehoty?klient=ws%20tatran");
  });
});

describe("Domov klienta: natívny ProjectHome s prehľadom OKF", () => {
  test("ProjectHome má jeden voliteľný slot a stránka doň dáva prehľad klienta", () => {
    const home = source("react-app/domains/workspace/project-home.tsx");
    expect(home).toContain("extra?: ReactNode;");
    expect(home).toContain("{props.extra}");
    const page = source("react-app/domains/session/chat/session-page.tsx");
    expect(page).toContain("extra={<ClientOverview workspaceId={props.selectedWorkspaceId} />}");
  });

  test("prehľad ukáže prípady klienta, najbližšie lehoty a odkaz na všetky lehoty klienta", () => {
    const UHRADA = matter("Tatran/Spisy/Uhrada", "Úhrada dodávok", ["2026-10-21"]);
    const out = renderToStaticMarkup(<MemoryRouter><ClientOverviewView workspaceId="tatran" locale="en" todayIso="2026-10-19"
      matters={[UHRADA, matter("Tatran/Spisy/Vady", "Vady rekonštrukcie")]}
      deadlines={UHRADA.deadlines.map((d) => ({ ...d, matter: { path: UHRADA.path, title: UHRADA.title } }))} /></MemoryRouter>);
    expect(out).toContain("data-lawoss-client-overview");
    expect(out).toContain("Úhrada dodávok");
    expect(out).toContain("Vady rekonštrukcie");
    expect(out).toContain(`href="${liteMatterLink(UHRADA.path)}"`);
    expect(out).toContain("Lehota 2026-10-21");
    expect(out).toContain(`href="${clientDeadlinesLink("tatran")}"`);
  });

  test("nové texty vo všetkých jazykoch, nemčina bez dlhej pomlčky", () => {
    for (const dict of [shellEn, shellCs, shellSk, shellDe]) {
      for (const key of ["project_matters", "project_matters_empty", "matter_new_chat", "client_overview_title", "client_overview_deadlines", "client_overview_no_deadlines", "client_deadlines_all", "client_deadlines_title"]) {
        expect(dict).toHaveProperty([`lawoss.lite.${key}`]);
      }
    }
    expect(shellSk["lawoss.lite.matter_new_chat"]).toBe("Nový chat");
    expect(Object.values(shellDe).some((value) => value.includes("—"))).toBe(false);
  });
});
