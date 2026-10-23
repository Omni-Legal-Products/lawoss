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
import { cardTitle, clientCode, clientGroupOfProject, clientLabel, expandedAfter, liteProjectNav, matterOfDirectory, matterSourceFresh, prettyFolderName, rowDeadline, sameName } from "../src/lawoss/lite/client-row";
import { buildClientRows, MAX_CARD_BYTES, readRootCards, type RootCard } from "../src/lawoss/lite/client-row-data";
import { chatContextText, clientProjectRow, ClientMoreNavItem, ClientRowLabel, ClientRowStatusLine } from "../src/lawoss/lite/client-row-view";
import { shortDay } from "../src/lawoss/lite/client-row-text";
import { ClientMattersView, matterRowStatus } from "../src/lawoss/lite/client-nav";
import { clientNavModel, type ClientOverviewState } from "../src/lawoss/lite/client-projects";
import type { TreeClient } from "../src/lawoss/lite/client-tree";
import type { ClientGroup } from "../src/lawoss/lite/today-model";
import { addDays, today, type OkfReadResult, type OkfScope } from "../src/lawoss/okf/read-model";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";
import { shellCs, shellDe, shellEn, shellSk } from "../src/lawoss/i18n/shell";
import { clientDeadlinesLink } from "../src/lawoss/lite/links";

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
type Freshness = "fresh" | "unavailable";
function data(source: Freshness = "fresh", matters = [UHRADA, VADY], extra: Partial<OkfReadResult> = {}): OkfReadResult {
  const all = matters.flatMap((m) => m.deadlines.map((d) => ({ ...d, matter: { path: m.path, title: m.title } })));
  return {
    matters, upcomingDeadlines: all.filter((d) => d.date >= TODAY), overdue: all.filter((d) => d.date < TODAY),
    totals: { matters: matters.length, deadlinesWithin7Days: 0, openTasks: 0, overdue: 0, records: 0 },
    problems: [], truncated: false, inputs: [], clients: [{ path: `Klienti/${SLUG}`, title: CARD }],
    coverage: { status: source === "fresh" ? "complete" : "partial", scopeKey: "k", sources: [{ source: "workspace", workspaceId: "tatran", checkedAt: 1, lastSuccessAt: source === "fresh" ? 1 : null, state: source }] },
    ...extra,
  };
}
type NavParts = { scope: OkfScope | null; data: OkfReadResult | undefined; groups: ClientGroup[]; model: typeof model; excludedWorkspaceIds: string[]; workspaces: RouteWorkspace[]; rootCards: ReadonlyMap<string, RootCard> };
const nav = (overrides: Partial<NavParts> = {}) => {
  const parts: NavParts = { scope, data: data(), groups, model, excludedWorkspaceIds: [], workspaces: [tatran], rootCards: new Map(), ...overrides };
  return { ...parts, connection: null, rows: buildClientRows({ ...parts, todayIso: TODAY }) };
};

describe("čitateľné meno klienta (N-22)", () => {
  test("upravené meno priečinka: oddeľovače na medzery, kód klienta ostáva, meno s medzerami sa nemení", () => {
    expect(prettyFolderName(SLUG)).toBe("C001 syn tatran automatika s r o");
    expect(prettyFolderName("C001 SYN Tatran Automatika, s. r. o.")).toBe("C001 SYN Tatran Automatika, s. r. o.");
    expect(prettyFolderName("Novak_Jan")).toBe("Novak Jan");
  });

  test("poradie: meno od používateľa → názov z karty → upravený priečinok; neklient má natívne meno; kód klienta ostáva viditeľný", () => {
    const path = `/prax/Klienti/${SLUG}`;
    expect(clientLabel({ nativeLabel: SLUG, path, eligible: true, cardTitle: CARD })).toEqual({ label: CARD, folder: SLUG, path, code: "C001" });
    expect(clientLabel({ nativeLabel: SLUG, path, eligible: true })).toEqual({ label: "C001 syn tatran automatika s r o", folder: SLUG, path });
    expect(clientLabel({ nativeLabel: "Tatran (hlavný)", path, eligible: true, cardTitle: CARD }).label).toBe("Tatran (hlavný)");
    expect(clientLabel({ nativeLabel: path, path, eligible: true, cardTitle: CARD }).label).toBe(CARD);
    expect(clientLabel({ nativeLabel: SLUG, path, eligible: false, cardTitle: CARD })).toEqual({ label: SLUG });
    // Meno priečinka v inom tvare (veľké/malé písmená, NFD) nie je meno od používateľa.
    expect(clientLabel({ nativeLabel: SLUG.toUpperCase(), path, eligible: true, cardTitle: CARD }).label).toBe(CARD);
    expect(sameName("Šimková".normalize("NFD"), "ŠIMKOVÁ")).toBe(true);
    expect([clientCode(SLUG), clientCode("K12 Novák"), clientCode("Novák Ján"), clientCode("2024-03 Kúpna")]).toEqual(["C001", "K12", undefined, undefined]);
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

  test("riadok projektu: názov z karty, kód a priečinok; bez dát panela natívne meno", () => {
    const row = clientProjectRow(nav(), tatran, SLUG, "sk");
    expect(row).toMatchObject({ label: CARD, code: "C001", client: true, tooltip: `Priečinok: /prax/Klienti/${SLUG}\nLehota 24. 10.` });
    expect(clientProjectRow(null, tatran, SLUG, "sk")).toEqual({ label: SLUG, nativeLabel: SLUG, client: false });
    expect(clientProjectRow(nav({ excludedWorkspaceIds: ["tatran"] }), tatran, SLUG, "sk")).toMatchObject({ label: SLUG, client: false });
  });

  test("I-1: bez praxe sa meno nemení podľa výberu; obyčajný projekt ostane natívny", () => {
    // Dva registrované klientske priečinky so slugom a obyčajný projekt; bez profilu praxe číta OKF len vybraný.
    const alfa = ws("alfa", "/data/C001-syn-alfa", "C001-syn-alfa"), beta = ws("beta", "/data/C002-syn-beta", "C002-syn-beta"), plain = ws("plain", "/data/zmluvy-2026", "zmluvy-2026");
    const rootCards = new Map<string, RootCard>([["alfa", { card: true, title: "SYN Alfa, s. r. o." }], ["beta", { card: true, title: "SYN Beta, a. s." }], ["plain", { card: false }]]);
    const select = (selected: RouteWorkspace) => {
      const own: OkfScope = { anchor: selected, members: [{ workspace: selected, prefix: "" }] };
      const ownModel = clientNavModel([alfa, beta, plain], null, { status: "ready", scope: own, groups: [], matters: [] });
      const n = nav({ scope: own, groups: [], model: ownModel, data: undefined, workspaces: [alfa, beta, plain], rootCards, excludedWorkspaceIds: [alfa, beta, plain].filter((w) => w.id !== selected.id).map((w) => w.id) });
      return [alfa, beta, plain].map((w) => clientProjectRow(n, w, w.name, "sk").label);
    };
    const expected = ["SYN Alfa, s. r. o.", "SYN Beta, a. s.", "zmluvy-2026"];
    expect(select(alfa)).toEqual(expected);
    expect(select(beta)).toEqual(expected);
    expect(select(plain)).toEqual(expected);
  });

  test("karty v koreňoch priečinkov: jeden výpis a jedna karta na priečinok, chyba = bez karty", async () => {
    const calls: string[] = [];
    const client = {
      listWorkspaceDirectory: async (id: string) => { calls.push(`list:${id}`); if (id === "zly") throw new Error("404"); return { entries: id === "alfa" ? [{ kind: "file", name: "client.md", path: "client.md" }] : id === "beta" ? [{ kind: "file", name: "klient.md", path: "klient.md" }] : [] }; },
      readWorkspaceFile: async (id: string, path: string) => { calls.push(`read:${id}:${path}`); return { content: id === "alfa" ? "---\ntitle: \"SYN Alfa, s. r. o.\"\n---\n" : "---\ntype: klient\n---\n" }; },
    };
    const cards = await readRootCards(client as never, [{ id: "alfa" }, { id: "beta" }, { id: "plain" }, { id: "zly" }]);
    expect(Object.fromEntries(cards)).toEqual({ alfa: { card: true, title: "SYN Alfa, s. r. o." }, beta: { card: true }, plain: { card: false }, zly: { card: false } });
    expect(calls.filter((c) => c.startsWith("read:")).sort()).toEqual(["read:alfa:client.md", "read:beta:klient.md"]);
    // Veľká karta (> 64 KB podľa výpisu) sa nečíta; z prečítanej sa parsuje len začiatok.
    const big = { listWorkspaceDirectory: async () => ({ entries: [{ kind: "file", name: "client.md", path: "client.md", size: MAX_CARD_BYTES + 1 }] }), readWorkspaceFile: async () => { throw new Error("nemá sa čítať"); } };
    expect(Object.fromEntries(await readRootCards(big as never, [{ id: "velka" }]))).toEqual({ velka: { card: true } });
    const padded = { listWorkspaceDirectory: async () => ({ entries: [{ kind: "file", name: "client.md", path: "client.md" }] }), readWorkspaceFile: async () => ({ content: `---\n${"x: y\n".repeat(20_000)}title: Neskoro\n---\n` }) };
    expect(Object.fromEntries(await readRootCards(padded as never, [{ id: "dlha" }]))).toEqual({ dlha: { card: true } });
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

  test("I-3: brána podľa zdroja vlastniaceho projektu, nie globálnej úplnosti; neúplný zdroj = len zmeškaná lehota", () => {
    expect(matterSourceFresh(data(), scope, UHRADA.path)).toBe(true);
    expect(matterSourceFresh(data("unavailable"), scope, UHRADA.path)).toBe(false);
    expect(matterSourceFresh(data("fresh", [UHRADA, VADY], { truncated: true }), scope, UHRADA.path)).toBe(false);
    expect(clientProjectRow(nav(), tatran, SLUG, "sk").status?.text).toMatch(/^Lehota /);
    // Problém mimo klienta (napr. okf.office_orphans) robí čítanie „partial“, zdroj klienta je však čerstvý.
    const orphans = data("fresh", [UHRADA, VADY], { problems: [{ path: "Office", message: "x", code: "okf.office_orphans" }], coverage: { ...data().coverage, status: "partial" } });
    expect(clientProjectRow(nav({ data: orphans }), tatran, SLUG, "sk").status?.text).toMatch(/^Lehota /);
    for (const quiet of [nav({ data: data("unavailable") }), nav({ data: data("fresh", [VADY]), groups: [{ ...groups[0], matters: [VADY] }] })]) {
      const row = clientProjectRow(quiet, tatran, SLUG, "sk");
      expect(row.status).toBeUndefined();
      expect(JSON.stringify(row)).not.toMatch(/žiadn|bez lehôt|no deadline/i);
    }
    const late = { ...UHRADA, deadlines: [deadline("2026-10-01")] };
    expect(clientProjectRow(nav({ data: data("unavailable", [late]), groups: [{ ...groups[0], matters: [late] }] }), tatran, SLUG, "sk").status).toEqual({ text: "po lehote", urgency: "hot" });
  });

  test("I-2: riadok veci nesie len lehotu (žiadny surový stav), s rovnakou bránou zdroja", () => {
    expect(matterRowStatus(UHRADA, TODAY, "sk", true)).toEqual({ text: "Lehota 24. 10.", urgency: "near" });
    expect(matterRowStatus(UHRADA, TODAY, "sk", false)).toBeNull();
    expect(matterRowStatus({ ...UHRADA, deadlines: [deadline("2026-10-01")] }, TODAY, "sk", false)).toEqual({ text: "po lehote", urgency: "hot" });
    expect(matterRowStatus(VADY, TODAY, "sk", true)).toBeNull();
  });

  test("koreň praxe s viacerými klientmi: meno priečinka, žiadna spoločná lehota", () => {
    const root = ws("root", "/prax", "prax");
    const rootScope: OkfScope = { anchor: root, members: [{ workspace: root, prefix: "" }], practiceRoot: "/prax" };
    const rootModel = clientNavModel([root], "/prax", { status: "ready", scope: rootScope, groups, matters: [UHRADA, VADY] });
    const rootData = { ...data(), coverage: { ...data().coverage, sources: [{ source: "workspace" as const, workspaceId: "root", checkedAt: 1, lastSuccessAt: 1, state: "fresh" as const }] } };
    const row = clientProjectRow(nav({ scope: rootScope, model: rootModel, data: rootData, workspaces: [root] }), root, "prax", "sk");
    expect(row.label).toBe("prax");
    expect(row.status).toBeUndefined();
  });

  test("UX: zmeškaná lehota červeno, blížiaca sa zlato; kód a lehota v druhom riadku; meno klienta na dva riadky s natívnym menom", () => {
    const late = clientProjectRow(nav({ data: data("fresh", [{ ...UHRADA, deadlines: [deadline("2026-10-01")] }]), groups: [{ ...groups[0], matters: [{ ...UHRADA, deadlines: [deadline("2026-10-01")] }] }] }), tatran, SLUG, "sk");
    const line = html(<ClientRowStatusLine row={late} />);
    // R-1: najprv lehota (neskracuje sa: shrink-0, bez truncate), potom kód, ktorý sa skráti ako jediný.
    expect(line).toMatch(/title="po lehote · C001"><span class="shrink-0 whitespace-nowrap text-destructive" data-lawoss-row-status="" data-urgency="hot">po lehote<\/span><span aria-hidden="true" class="shrink-0">·<\/span><span class="min-w-0 truncate" data-lawoss-row-code="">C001<\/span>/);
    expect(line.indexOf("data-lawoss-row-status")).toBeLessThan(line.indexOf("data-lawoss-row-code"));
    expect(late.tooltip).toBe(`Priečinok: /prax/Klienti/${SLUG}\npo lehote`);
    const label = html(<ClientRowLabel row={late} />);
    expect(label).toContain("line-clamp-2");
    expect(label).toContain(`data-lawoss-native-name="${SLUG}"`);
    expect(html(<ClientRowLabel row={clientProjectRow(null, tatran, SLUG, "sk")} />)).toContain("block truncate");
    expect(html(<ClientRowStatusLine row={clientProjectRow(null, tatran, SLUG, "sk")} />)).not.toContain("data-lawoss-row-secondary");
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

  test("otvorený chat vo veci: Prípady a vec sú predkovia (nie data-active, aria-current=location), chat je aktívny", () => {
    const out = html(<ul><ClientMattersView nodes={tree(true)} open locale="sk" /></ul>, "/workspace/tatran/session/s-uhrada");
    expect(out).toMatch(/<button(?=[^>]*data-lawoss-project-matters="")(?=[^>]*data-lawoss-ancestor="")(?=[^>]*aria-current="location")[^>]*>/);
    const matter = out.match(/<a[^>]*data-lawoss-tree-matter=""[^>]*>/g) ?? [];
    expect(matter[0]).toContain('data-lawoss-ancestor=""');
    expect(matter[0]).toContain('aria-current="location"');
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

  test("riadok veci nesie lehotu ako text (nie len farbou), len pri čerstvom zdroji", () => {
    // Vykreslenie počíta s dnešným dňom: lehota o 3 dni sa blíži.
    const nodes = tree(false).map((client) => ({ ...client, matters: client.matters.map((m) => m.path === UHRADA.path ? { ...m, deadlines: [deadline(addDays(today(), 3))] } : m) }));
    const out = html(<ul><ClientMattersView nodes={nodes} open locale="sk" isFresh={() => true} /></ul>);
    expect(out).toMatch(/data-lawoss-row-status=""[^>]*data-urgency="near"[^>]*>Lehota /);
    expect(out).not.toContain("aktívny");
    expect(html(<ul><ClientMattersView nodes={nodes} open locale="sk" /></ul>)).not.toContain("data-lawoss-row-status");
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
    expect(chatContextText(nav({ excludedWorkspaceIds: ["tatran"] }), tatran, SLUG, dir, "sk")).toBeNull();
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
    // Lehoty klienta (jediná položka pod Viac s vlastnou trasou) otvoria Viac len pre svojho klienta.
    expect(html(<ul><ClientMoreNavItem workspaceId="tatran"><li>Lehoty</li></ClientMoreNavItem></ul>, clientDeadlinesLink("tatran"))).toContain("Lehoty");
    expect(html(<ul><ClientMoreNavItem workspaceId="ine"><li>Lehoty</li></ClientMoreNavItem></ul>, clientDeadlinesLink("tatran"))).not.toContain("Lehoty");
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
