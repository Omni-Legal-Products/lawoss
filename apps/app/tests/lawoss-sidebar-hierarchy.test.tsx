// Bočný panel: čitateľné mená klientov, hierarchia Klient → Prípady → Chaty, aktívni predkovia, kompaktný
// bežný režim a poctivé stavy lehôt (alfa2 B3, N-22).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { t } from "@/i18n";
import { cardTitle, clientGroupOfProject, clientLabel, clientRowDeadline, expandedAfter, liteProjectNav, matterOfDirectory, prettyFolderName, rowDeadline } from "../src/lawoss/lite/client-row";
import { chatContextText, clientProjectRow, ClientMoreNavItem } from "../src/lawoss/lite/client-row-view";
import { shortDay } from "../src/lawoss/lite/client-row-text";
import { ClientMattersView, matterRowStatus } from "../src/lawoss/lite/client-nav";
import { clientNavModel, type ClientOverviewState } from "../src/lawoss/lite/client-projects";
import type { TreeClient } from "../src/lawoss/lite/client-tree";
import type { ClientGroup } from "../src/lawoss/lite/today-model";
import { addDays, today, type OkfReadResult, type OkfScope } from "../src/lawoss/okf/read-model";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";
import { shellCs, shellDe, shellEn, shellSk } from "../src/lawoss/i18n/shell";

const source = (path: string) => readFileSync(join(import.meta.dir, "../src", path), "utf8");
/** Prítomnosť atribútu `data-active` (natívny kontrakt), nie trieda `data-active:…`. */
const ACTIVE = /\sdata-active(?:=""|\s|>)/;
const html = (node: ReactElement, entry = "/dnes") => renderToStaticMarkup(<MemoryRouter initialEntries={[entry]}><SidebarProvider>{node}</SidebarProvider></MemoryRouter>);
const ws = (id: string, path: string, name = id): RouteWorkspace => ({ id, path, name, displayNameResolved: name, workspaceType: "local" });
const TODAY = "2026-10-22";
const deadline = (date: string, extra: { invalid?: true; file?: string } = {}) => ({ recordId: `r-${date}`, date, title: `Lehota ${date}`, ...extra });

// Prax /prax (neregistrovaná) s registrovaným klientom, ktorého meno je slug priečinka.
const SLUG = "C001-syn-tatran-automatika-s-r-o";
const CARD = "SYN Tatran Automatika, s. r. o.";
const tatran = ws("tatran", `/prax/Klienti/${SLUG}`, SLUG);
const UHRADA = { path: `Klienti/${SLUG}/Spisy/Uhrada`, title: "Úhrada dodávok", state: "aktívny", deadlines: [deadline("2026-10-24")], openTasks: [], counts: { records: 1, evidence: 0, subjects: 0 } };
const VADY = { path: `Klienti/${SLUG}/Spisy/Vady`, title: "Vady rekonštrukcie", deadlines: [], openTasks: [], counts: { records: 1, evidence: 0, subjects: 0 } };
const groups: ClientGroup[] = [{ key: `client:Klienti/${SLUG}`, client: CARD, matters: [UHRADA, VADY] }];
const scope: OkfScope = { anchor: tatran, members: [{ workspace: tatran, prefix: `Klienti/${SLUG}` }], practiceRoot: "/prax" };
const overview: ClientOverviewState = { status: "ready", scope, groups, matters: groups.flatMap((g) => g.matters) };
const model = clientNavModel([tatran], "/prax", overview);
function data(coverage: "complete" | "partial" = "complete", matters = [UHRADA, VADY]): OkfReadResult {
  const all = matters.flatMap((m) => m.deadlines.map((d) => ({ ...d, matter: { path: m.path, title: m.title } })));
  return {
    matters, upcomingDeadlines: all.filter((d) => d.date >= TODAY), overdue: all.filter((d) => d.date < TODAY),
    totals: { matters: matters.length, deadlinesWithin7Days: 0, openTasks: 0, overdue: 0, records: 0 },
    problems: [], truncated: false, inputs: [], clients: [{ path: `Klienti/${SLUG}`, title: CARD }],
    coverage: { status: coverage, scopeKey: "k", sources: [] },
  };
}
const nav = (overrides: Partial<Parameters<typeof clientProjectRow>[0] & object> = {}) => ({
  connection: null, scope, data: data(), groups, model, excludedWorkspaceIds: [], ...overrides,
});

describe("čitateľné meno klienta (N-22)", () => {
  test("upravené meno priečinka: oddeľovače na medzery, kód klienta ostáva, meno s medzerami sa nemení", () => {
    expect(prettyFolderName(SLUG)).toBe("C001 syn tatran automatika s r o");
    expect(prettyFolderName("C001 SYN Tatran Automatika, s. r. o.")).toBe("C001 SYN Tatran Automatika, s. r. o.");
    expect(prettyFolderName("Novak_Jan")).toBe("Novak Jan");
  });

  test("poradie: meno od používateľa → názov z karty → upravený priečinok; neklient má natívne meno", () => {
    const path = `/prax/Klienti/${SLUG}`;
    expect(clientLabel({ nativeLabel: SLUG, path, isClient: true, cardTitle: CARD })).toEqual({ label: CARD, folder: SLUG, path });
    expect(clientLabel({ nativeLabel: SLUG, path, isClient: true }).label).toBe("C001 syn tatran automatika s r o");
    expect(clientLabel({ nativeLabel: "Tatran (hlavný)", path, isClient: true, cardTitle: CARD }).label).toBe("Tatran (hlavný)");
    expect(clientLabel({ nativeLabel: path, path, isClient: true, cardTitle: CARD }).label).toBe(CARD);
    expect(clientLabel({ nativeLabel: SLUG, path, isClient: false, cardTitle: CARD })).toEqual({ label: SLUG });
  });

  test("karta patrí projektu len vtedy, keď je jej priečinok priečinkom projektu (koreň praxe nedostane meno klienta)", () => {
    expect(clientGroupOfProject(scope, groups, tatran.path)?.key).toBe(`client:Klienti/${SLUG}`);
    const root = ws("root", "/prax");
    const rootScope: OkfScope = { anchor: root, members: [{ workspace: root, prefix: "" }] };
    expect(clientGroupOfProject(rootScope, groups, root.path)).toBeNull();
    expect(cardTitle(data(), `client:Klienti/${SLUG}`)).toBe(CARD);
    expect(cardTitle({ clients: [{ path: `Klienti/${SLUG}` }], inputs: [] }, `client:Klienti/${SLUG}`)).toBeUndefined();
    expect(cardTitle(data(), "path:Tatran")).toBeUndefined();
  });

  test("riadok projektu: názov z karty, priečinok v bublinke; bez dát panela natívne meno", () => {
    const row = clientProjectRow(nav(), tatran, SLUG, "sk", TODAY);
    expect(row.label).toBe(CARD);
    expect(row.tooltip).toBe(`Priečinok: /prax/Klienti/${SLUG}`);
    expect(clientProjectRow(null, tatran, SLUG, "sk", TODAY)).toEqual({ label: SLUG });
    expect(clientProjectRow(nav({ excludedWorkspaceIds: ["tatran"] }), tatran, SLUG, "sk", TODAY)).toEqual({ label: SLUG });
  });
});

describe("stav a lehota v riadku: len to, čo je v súboroch", () => {
  test("najbližšia lehota; zmeškaná a dátum na overenie majú prednosť; lehota kancelárie sa nepočíta", () => {
    expect(rowDeadline([deadline("2026-11-30"), deadline("2026-10-24")], TODAY)).toEqual({ kind: "next", date: "2026-10-24", urgency: "near" });
    expect(rowDeadline([deadline("2026-10-23")], TODAY)?.urgency).toBe("hot");
    expect(rowDeadline([deadline("2026-10-01"), deadline("2026-10-24")], TODAY)).toEqual({ kind: "overdue", urgency: "hot" });
    expect(rowDeadline([deadline("2026-13-40", { invalid: true })], TODAY)).toEqual({ kind: "invalid", urgency: "hot" });
    expect(rowDeadline([deadline("2026-10-24", { file: "Office/memory/r.md" })], TODAY)).toBeNull();
    expect(rowDeadline([], TODAY)).toBeNull();
  });

  test("krátky dátum v riadku: bez dňa v týždni, iný rok s rokom", () => {
    expect(shortDay("2026-10-24", "sk", TODAY)).toBe("24. 10.");
    expect(shortDay("2027-01-05", "sk", TODAY)).toBe("5. 1. 2027");
  });

  test("klient: lehota len pri úplnom čítaní; bez lehôt ani neúplné čítanie netvrdí „žiadne lehoty“", () => {
    expect(clientRowDeadline([UHRADA], true, TODAY)).toMatchObject({ kind: "next", date: "2026-10-24" });
    expect(clientRowDeadline([UHRADA], false, TODAY)).toBeNull();
    expect(clientRowDeadline([VADY], true, TODAY)).toBeNull();
    expect(clientProjectRow(nav(), tatran, SLUG, "sk", TODAY).status?.text).toMatch(/^Lehota /);
    for (const quiet of [nav({ data: data("partial") }), nav({ data: data("complete", [VADY]) })]) {
      const row = clientProjectRow(quiet, tatran, SLUG, "sk", TODAY);
      expect(row.status).toBeUndefined();
      expect(JSON.stringify(row)).not.toMatch(/žiadn|bez lehôt|no deadline/i);
    }
  });

  test("vec: stav z karty doslovne a lehota; nič z toho = žiadny riadok stavu", () => {
    expect(matterRowStatus(UHRADA, TODAY, "sk")).toMatchObject({ urgency: "near" });
    expect(matterRowStatus(UHRADA, TODAY, "sk")?.text).toMatch(/^aktívny · Lehota /);
    expect(matterRowStatus(VADY, TODAY, "sk")).toBeNull();
    expect(matterRowStatus({ ...VADY, state: "uzavretý" }, TODAY, "cs")?.text).toBe("uzavretý");
  });
});

describe("hierarchia a aktívni predkovia", () => {
  const conversation = { id: "s-uhrada", title: "Návrh odpovede", updated: 1 };
  const tree = (current: boolean): TreeClient[] => [{
    key: groups[0].key, title: CARD, expanded: true, current, conversations: [], more: false, status: "ready",
    matters: [
      { path: UHRADA.path, title: UHRADA.title, deadlines: UHRADA.deadlines, state: UHRADA.state, expanded: true, current, canStart: true, conversations: [conversation], more: false, status: "ready" },
      { path: VADY.path, title: VADY.title, deadlines: [], expanded: false, current: false, canStart: false, conversations: [], more: false, status: "ready" },
    ],
  }];

  test("otvorený chat vo veci: Prípady a vec sú predkovia (nie data-active), chat je aktívny", () => {
    const out = html(<ul><ClientMattersView nodes={tree(true)} open locale="sk" /></ul>, "/workspace/tatran/session/s-uhrada");
    expect(out).toMatch(/<button(?=[^>]*data-lawoss-project-matters="")(?=[^>]*data-lawoss-ancestor="")[^>]*>/);
    const matter = out.match(/<a[^>]*data-lawoss-tree-matter=""[^>]*>/g) ?? [];
    expect(matter[0]).toContain('data-lawoss-ancestor=""');
    expect(matter[0]).not.toMatch(ACTIVE);
    expect(matter[1]).not.toContain("data-lawoss-ancestor");
    expect((out.match(/<button[^>]*data-lawoss-tree-conversation="s-uhrada"[^>]*>/) ?? [""])[0]).toMatch(ACTIVE);
  });

  test("otvorená stránka veci: vec je aktívna, nie predok; nič otvorené = žiadny predok", () => {
    const out = html(<ul><ClientMattersView nodes={tree(true)} open locale="sk" /></ul>, `/vec?vec=${encodeURIComponent(UHRADA.path)}`);
    const matter = (out.match(/<a[^>]*data-lawoss-tree-matter=""[^>]*>/g) ?? [])[0];
    expect(matter).toMatch(ACTIVE);
    expect(matter).not.toContain("data-lawoss-ancestor");
    expect(html(<ul><ClientMattersView nodes={tree(false)} open locale="sk" /></ul>)).not.toContain("data-lawoss-ancestor");
  });

  test("riadok veci nesie stav a lehotu ako text (nie len farbou)", () => {
    // Vykreslenie počíta s dnešným dňom: lehota o 3 dni sa blíži.
    const nodes = tree(false).map((client) => ({ ...client, matters: client.matters.map((m) => m.path === UHRADA.path ? { ...m, deadlines: [deadline(addDays(today(), 3))] } : m) }));
    const out = html(<ul><ClientMattersView nodes={nodes} open locale="sk" /></ul>);
    expect(out).toMatch(/data-lawoss-row-status=""[^>]*data-urgency="near"[^>]*>aktívny · Lehota /);
  });

  test("natívne Chaty nie sú aktívne, keď je otvorený chat vo veci (patrí pod Prípady)", () => {
    const sidebar = source("react-app/domains/session/sidebar/app-sidebar.tsx");
    expect(sidebar).toContain('isActive={isSelected && ctx.activeProjectFeature === "sessions" && !chatInMatter}');
    expect(sidebar).toContain("const chatInMatter = useMatterChatOpen(workspace.id);");
    // Riadok klienta: aktívny podľa trasy (vec, chat vo veci), inak natívny výber.
    expect(sidebar).toContain("const rowActive = useClientRowActive(workspace.id, isSelected);");
  });

  test("kontext chatu v Nedávnych/pripnutých: Klient · Prípad podľa priečinka chatu", () => {
    const dir = `/prax/Klienti/${SLUG}/Spisy/Uhrada/03_Drafty`;
    expect(matterOfDirectory(scope, [UHRADA, VADY], dir)?.title).toBe("Úhrada dodávok");
    expect(matterOfDirectory(scope, [UHRADA, VADY], `/prax/Klienti/${SLUG}`)).toBeNull();
    expect(chatContextText(nav(), tatran, SLUG, dir, "sk")).toBe(`${CARD} · Úhrada dodávok`);
    expect(chatContextText(nav(), tatran, SLUG, tatran.path, "sk")).toBe(CARD);
    expect(chatContextText(nav(), ws("ine", "/ine"), "ine", "/ine", "sk")).toBeNull();
    expect(source("react-app/domains/session/sidebar/app-sidebar.tsx")).toContain("<ChatContextLabel project={workspace} nativeLabel={workspaceLabel(workspace)} directory={session.directory} />");
  });
});

describe("bežný režim: krátky zoznam pod klientom, Viac a accordion", () => {
  const all = ["projectHome", "projectMatters", "projectDeadlines", "projectLinkedFolders", "projectCalendar", "projectReviews", "projectTasks", "projectFiles", "projectSessions"] as const;

  test("bežný: Prehľad, Prípady, Chaty, Súbory, Pripojené priečinky; ostatné pod Viac; Pokročilý natívne", () => {
    expect(liteProjectNav(all, "lite")).toEqual({
      lite: true,
      main: ["projectHome", "projectMatters", "projectSessions", "projectFiles", "projectLinkedFolders"],
      more: ["projectDeadlines", "projectCalendar", "projectReviews", "projectTasks"],
    });
    expect(liteProjectNav(all, "pro")).toEqual({ lite: false, main: [...all], more: [] });
    // Vypnutá položka ostane vypnutá aj v krátkom zozname.
    expect(liteProjectNav(["projectMatters", "projectSessions"], "lite").main).toEqual(["projectMatters", "projectSessions"]);
  });

  test("Viac: zbalené, otvorené pri otvorenej stránke vnútri; text vo všetkých jazykoch", () => {
    expect(html(<ul><ClientMoreNavItem><li>Lehoty</li></ClientMoreNavItem></ul>)).not.toContain("Lehoty");
    const open = html(<ul><ClientMoreNavItem active><li>Lehoty</li></ClientMoreNavItem></ul>);
    expect(open).toContain("Lehoty");
    expect(open).toMatch(/aria-expanded="true"[^>]*data-lawoss-project-more=""/);
    expect([shellSk, shellCs, shellEn, shellDe].map((d) => d["lawoss.lite.nav_more"])).toEqual(["Viac", "Více", "More", "Mehr"]);
    expect([shellSk, shellCs, shellEn, shellDe].every((d) => d["lawoss.lite.client_folder_tooltip"].includes("{path}"))).toBe(true);
  });

  test("accordion v bežnom režime: rozbalený jeden klient; Pokročilý môže mať viac; nezmenené = tá istá množina", () => {
    const one = new Set(["a"]);
    expect([...expandedAfter(one, "b", "lite", "toggle")]).toEqual(["b"]);
    expect([...expandedAfter(new Set(["a", "b"]), "b", "lite", "expand")]).toEqual(["b"]);
    expect(expandedAfter(one, "a", "lite", "expand")).toBe(one);
    expect([...expandedAfter(one, "a", "lite", "toggle")]).toEqual([]);
    expect([...expandedAfter(one, "b", "pro", "toggle")].sort()).toEqual(["a", "b"]);
    const both = new Set(["a", "b"]);
    expect(expandedAfter(both, "a", "pro", "expand")).toBe(both);
  });

  test("natívny panel: rozdelenie a accordion podľa režimu, Pracovný priestor v bežnom režime pod Viac", () => {
    const sidebar = source("react-app/domains/session/sidebar/app-sidebar.tsx");
    expect(sidebar).toContain("const projectNav = liteProjectNav(projectNavItems, useUiMode());");
    expect(sidebar).toContain('setExpandedWorkspaceIds((previous) => expandedAfter(previous, id, uiMode, "expand"));');
    expect(sidebar).toContain('setExpandedWorkspaceIds((previous) => expandedAfter(previous, id, uiMode, "toggle"));');
    expect(sidebar).toMatch(/\{projectNav\.lite && <ClientMoreNavItem[^>]*>\{workbench\(false\)\}/);
  });

  test("Domov klienta je Prehľad (jeden pojem; „Domov“ ostáva len v hlavnej lište)", () => {
    expect(t("workspace.overview", "sk")).toBe("Prehľad");
    expect(t("workspace.overview", "cs")).toBe("Přehled");
    expect(t("home.nav_label", "sk")).toBe("Domov");
  });
});
