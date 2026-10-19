// Strom klientov, vecí a rozhovorov v bočnom paneli (variant A, MČ 19. 10. 2026; oprava po review).
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { shellCs, shellDe, shellEn, shellSk } from "../src/lawoss/i18n/shell";
import { LiteNav, LiteNavView } from "../src/lawoss/lite/lite-nav";
import {
  buildClientTree, clearFocusOverrides, clientFolderFor, clientToggle, fetchPlan, matterToggle, routeFocus, sessionFocus,
  TREE_CONVERSATION_LIMIT, type ConversationList,
} from "../src/lawoss/lite/client-tree";
import {
  assignConversations, comparable, FOLDER_SESSION_LIMIT, folderSessionsQuery, listFolderSessions, projectRelative,
  type FolderEngine, type FolderListing, type MatterConversation,
} from "../src/lawoss/lite/matter-conversations";
import { clientOverviewLink, LITE_CLIENTS_PATH, liteMatterLink } from "../src/lawoss/lite/links";
import { ClientsView } from "../src/lawoss/lite/pages/clients-page";
import { LiteMatterView } from "../src/lawoss/lite/pages/matter-page";
import type { ClientGroup } from "../src/lawoss/lite/today-model";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";

const matter = (path: string, title: string) => ({ path, title, deadlines: [], openTasks: [], counts: { records: 0, evidence: 0, subjects: 0 } });
const UHRADA = matter("Tatran/Spisy/Uhrada", "Úhrada dodávok");
const VADY = matter("Tatran/Spisy/Vady", "Vady rekonštrukcie");
const HRON_ZMLUVA = matter("Hron/Spisy/Zmluva", "Zmluva o dielo");
const groups: ClientGroup[] = [
  { key: "client:Tatran", client: "SYN Tatran Automatika", matters: [UHRADA, VADY] },
  { key: "client:Hron", client: "SYN Hron Technológie", matters: [HRON_ZMLUVA] },
];
const ws = (id: string, path: string): RouteWorkspace => ({ id, path, name: id, displayNameResolved: id, workspaceType: "local" });
const tatran = ws("ws-tatran", "/prax/Tatran");
const hron = ws("ws-hron", "/prax/Hron");
const at = (d: number) => Date.UTC(2026, 9, d, 9);
const session = (id: string, title: string, directory: string, day: number) => ({ id, title, directory, time: { created: at(day), updated: at(day) } });
const TATRAN: FolderListing = {
  workspaceId: tatran.id, folder: comparable("/prax/Tatran"), subtree: true, complete: true, items: [
    session("s-zhrnutie", "Zhrnutie spisu", "/prax/Tatran/Spisy/Uhrada", 19),
    session("s-navrh", "Návrh odpovede", "/prax/Tatran/Spisy/Uhrada", 18),
    session("s-bez", "New session - 2026-10-17T10:00:00Z", "/prax/Tatran/Spisy/Uhrada", 17),
    session("s-podanie", "Podanie na súd", "/prax/Tatran/Spisy/Uhrada/Podania", 14),
    session("s-klient", "Otázka ku klientovi", "/prax/Tatran", 16),
    session("s-vady", "Vady - posudok", "/prax/Tatran/Spisy/Vady", 15),
    session("s-dvojka", "Iná vec s podobným menom", "/prax/Tatran/Spisy/Uhrada2", 13),
  ],
};
const owners = {
  clients: [{ key: "client:Tatran", folder: comparable("/prax/Tatran") }, { key: "client:Hron", folder: comparable("/prax/Hron") }],
  matters: [
    { path: UHRADA.path, folder: comparable("/prax/Tatran/Spisy/Uhrada") },
    { path: VADY.path, folder: comparable("/prax/Tatran/Spisy/Vady") },
    { path: HRON_ZMLUVA.path, folder: comparable("/prax/Hron/Spisy/Zmluva") },
  ],
};
const assigned = assignConversations([TATRAN], owners);
const ready = (items: readonly MatterConversation[] = []): ConversationList => ({ items, status: "ready", complete: true });
const lists = { client: (key: string) => ready(assigned.byClient.get(key)), matter: (path: string) => ready(assigned.byMatter.get(path)) };

const render = (node: ReactElement, entry = "/dnes") => renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[entry]}><SidebarProvider>{node}</SidebarProvider></MemoryRouter>
  </QueryClientProvider>,
);
const tree = (focus = {}, overrides = {}) => buildClientTree({ groups, focus, overrides, lists, canStart: () => true });

describe("rozhovory: priradenie podľa priečinka", () => {
  test("vec dostane aj rozhovory z podpriečinka (po celých segmentoch), klient tie zo svojho koreňa", () => {
    expect(assigned.byMatter.get(UHRADA.path)?.map((c) => c.id)).toEqual(["s-zhrnutie", "s-navrh", "s-bez", "s-podanie"]);
    expect(assigned.byMatter.get(VADY.path)?.map((c) => c.id)).toEqual(["s-vady"]);
    // „Spisy/Uhrada2“ nie je „Spisy/Uhrada“: patrí klientovi (jeho podpriečinok mimo vecí).
    expect(assigned.byClient.get("client:Tatran")?.map((c) => c.id)).toEqual(["s-klient", "s-dvojka"]);
    expect(assigned.byClient.get("client:Hron")).toBeUndefined();
    expect(assigned.owner.get("s-podanie")).toEqual({ matter: UHRADA.path });
    expect(assigned.owner.get("s-klient")).toEqual({ client: "client:Tatran" });
    expect(assigned.byMatter.get(UHRADA.path)?.[2].title).toBeNull();
  });

  test("rozložená diakritika (NFD) a koncová lomka nič nemenia", () => {
    const nfd: FolderListing = { ...TATRAN, items: [session("u", "Úhrada", "/prax/Tatran/Spisy/Úhrada/".normalize("NFD"), 1)] };
    const result = assignConversations([nfd], { clients: [], matters: [{ path: "x", folder: comparable("/prax/Tatran/Spisy/Úhrada".normalize("NFC")) }] });
    expect(result.byMatter.get("x")?.map((c) => c.id)).toEqual(["u"]);
  });
});

describe("výpis priečinka cez engine", () => {
  test("cesta voči koreňu projektu: globálny projekt „/“, git koreň, rovnaký priečinok, mimo po segmentoch", () => {
    expect(projectRelative("/", "/prax/Tatran")).toBe("prax/Tatran");
    expect(projectRelative("/prax/Tatran", "/prax/Tatran/Spisy/Uhrada")).toBe("Spisy/Uhrada");
    expect(projectRelative("/prax/Tatran/", "/prax/Tatran")).toBe("");
    expect(projectRelative("/prax/Tat", "/prax/Tatran")).toBeNull();
    expect(projectRelative("/", "C:\\prax\\Tatran")).toBeNull();
  });

  const fake = (worktree: string | null, items: ReturnType<typeof session>[], id = "global") => {
    const calls: unknown[] = [];
    const engine: FolderEngine = {
      project: async (folder) => { calls.push(["worktree", folder]); if (worktree === null) throw new Error("no project"); return { worktree, id }; },
      list: async (folder, query, signal) => { calls.push(["list", folder, query, signal instanceof AbortSignal]); return items; },
    };
    return { engine, calls };
  };

  test("podstrom klienta cez `path` (limit platí po filtri enginu), cudzie položky sa zahodia, signal sa odovzdá", async () => {
    const { engine, calls } = fake("/", [...TATRAN.items, session("cudzi", "Beta", "/prax/Beta/Spisy/Najom", 20)]);
    const listing = await listFolderSessions(engine, "ws-tatran", "/prax/Tatran", new AbortController().signal);
    expect(calls).toEqual([["worktree", "/prax/Tatran"], ["list", "/prax/Tatran", { path: "prax/Tatran", roots: true, limit: FOLDER_SESSION_LIMIT }, true]]);
    expect(listing.subtree).toBe(true);
    expect(listing.complete).toBe(true);
    expect(listing.items.map((s) => s.id)).not.toContain("cudzi");
    expect(listing.items).toHaveLength(TATRAN.items.length);
  });

  test("bez koreňa projektu: presný výpis priečinka (bez `path`), podpriečinky nepredstiera", async () => {
    const { engine, calls } = fake(null, TATRAN.items);
    const listing = await listFolderSessions(engine, "ws-tatran", "/prax/Tatran");
    expect(calls[1]).toEqual(["list", "/prax/Tatran", { roots: true, limit: FOLDER_SESSION_LIMIT }, false]);
    expect(listing.subtree).toBe(false);
    expect(listing.items.map((s) => s.id)).toEqual(["s-klient"]);
  });

  test("koreň vlastného projektu (git) = priečinok: `path` = \"\" vypíše len ten projekt", async () => {
    const { engine, calls } = fake("/prax/Tatran", TATRAN.items, "a1b2c3");
    const listing = await listFolderSessions(engine, "ws-tatran", "/prax/Tatran");
    expect(calls[1]).toEqual(["list", "/prax/Tatran", { path: "", roots: true, limit: FOLDER_SESSION_LIMIT }, false]);
    expect(listing.subtree).toBe(true);
  });

  test("globálny projekt s koreňom v priečinku (git bez commitu): nie celý engine, ale presný výpis", async () => {
    // Skutočný engine 1.18.29: `path=` by vypísal všetky konverzácie všetkých klientov a limit by ich orezal.
    const { engine, calls } = fake("/prax/Tatran", TATRAN.items, "global");
    const listing = await listFolderSessions(engine, "ws-tatran", "/prax/Tatran");
    expect(calls[1]).toEqual(["list", "/prax/Tatran", { roots: true, limit: FOLDER_SESSION_LIMIT }, false]);
    expect(listing.subtree).toBe(false);
  });

  test(`plný výpis (${FOLDER_SESSION_LIMIT}) nie je úplný`, async () => {
    const many = Array.from({ length: FOLDER_SESSION_LIMIT }, (_, i) => session(`m${i}`, `R ${i}`, "/prax/Tatran", 1));
    expect((await listFolderSessions(fake("/", many).engine, "ws-tatran", "/prax/Tatran")).complete).toBe(false);
  });

  test("strom aj detail veci zdieľajú jeden dotaz na ten istý priečinok", async () => {
    let calls = 0;
    const queries = new QueryClient();
    const connection = { client: {} as never, baseUrl: "http://x", token: "t" };
    const options = folderSessionsQuery(connection, { workspace: tatran, abs: "/prax/Tatran" });
    const again = folderSessionsQuery(connection, { workspace: tatran, abs: "/prax/Tatran/" });
    expect(again.queryKey).toEqual(options.queryKey);
    const queryFn = async () => { calls += 1; return TATRAN; };
    await queries.fetchQuery({ ...options, queryFn });
    await queries.fetchQuery({ ...again, queryFn });
    expect(calls).toBe(1);
  });
});

describe("strom klientov: rozbalenie", () => {
  test("bez aktuálneho klienta sú všetci klienti zbalení a veci nie sú vidieť", () => {
    const out = render(<LiteNavView tree={tree()} />);
    expect(out).toContain("SYN Tatran Automatika");
    expect(out).toContain(`href="${clientOverviewLink("client:Tatran").replace(/&/g, "&amp;")}"`);
    expect(out).not.toContain("Úhrada dodávok");
    expect(out).not.toContain("Otázka ku klientovi");
    expect(out.match(/aria-expanded="false"/g)).toHaveLength(2);
  });

  test("detail veci rozbalí jej klienta aj vec; ostatní ostanú zbalení", () => {
    const focus = routeFocus("/vec", `?vec=${encodeURIComponent(UHRADA.path)}`);
    const built = tree(focus);
    expect(built.map((c) => [c.key, c.expanded])).toEqual([["client:Tatran", true], ["client:Hron", false]]);
    expect(built[0].matters.map((m) => [m.path, m.expanded])).toEqual([[UHRADA.path, true], [VADY.path, false]]);
    const out = render(<LiteNavView tree={built} />, liteMatterLink(UHRADA.path));
    expect(out).toMatch(/<a(?=[^>]*aria-current="page")[^>]*href="\/vec\?vec=Tatran%2FSpisy%2FUhrada"/);
  });

  test("otvorený rozhovor v koreni klienta rozbalí klienta a je označený; vo veci rozbalí vec", () => {
    const route = routeFocus("/workspace/ws-tatran/session/s-klient", "");
    expect(sessionFocus(route, assigned)).toEqual({ client: "client:Tatran" });
    expect(sessionFocus(routeFocus("/workspace/ws-tatran/session/s-podanie", ""), assigned)).toEqual({ matter: UHRADA.path });
    expect(sessionFocus(routeFocus("/workspace/ws-x/session/neznamy", ""), assigned)).toEqual({});
    const built = tree(sessionFocus(route, assigned));
    expect(built[0].expanded).toBe(true);
    const out = render(<LiteNavView tree={built} />, "/workspace/ws-tatran/session/s-klient");
    expect(out).toMatch(/<button(?=[^>]*aria-current="page")(?=[^>]*data-lawoss-tree-conversation="s-klient")[^>]*>/);
  });

  test("prepnutie používateľa platí, kým sa trasa nepresunie na ten uzol", () => {
    const overrides = { [matterToggle(UHRADA.path)]: false, [clientToggle("client:Hron")]: true, [clientToggle("client:Tatran")]: false };
    const built = tree({ matter: UHRADA.path }, overrides);
    expect(built[0].expanded).toBe(false);
    expect(built[1].expanded).toBe(true);
    // Trasa prešla na Úhradu: jej prepnutie aj prepnutie jej klienta sa zabudnú, iné ostanú.
    expect(clearFocusOverrides(overrides, { matter: UHRADA.path }, groups)).toEqual({ [clientToggle("client:Hron")]: true });
    expect(clearFocusOverrides(overrides, { client: "client:Hron" }, groups)).toEqual({ [matterToggle(UHRADA.path)]: false, [clientToggle("client:Tatran")]: false });
    expect(clearFocusOverrides(overrides, {}, groups)).toBe(overrides);
  });

  test("šípka je samostatné tlačidlo s aria-expanded, nie odkaz", () => {
    const out = render(<LiteNavView tree={tree({ matter: UHRADA.path }, { [clientToggle("client:Hron")]: true })} />);
    const toggles = out.match(/<button[^>]*data-lawoss-tree-toggle[^>]*>/g) ?? [];
    expect(toggles).toHaveLength(5);
    for (const toggle of toggles) expect(toggle).toMatch(/aria-expanded="(true|false)"/);
  });
});

describe("strom klientov: rozhovory", () => {
  test("rozhovory klienta sú nad jeho vecami; vec ukáže svoje vrátane podpriečinka a + Nový rozhovor", () => {
    const out = render(<LiteNavView tree={tree({ matter: UHRADA.path })} />);
    expect(out.indexOf("Otázka ku klientovi")).toBeGreaterThan(-1);
    expect(out.indexOf("Otázka ku klientovi")).toBeLessThan(out.indexOf("Úhrada dodávok"));
    expect(out).toContain("Podanie na súd");
    expect(out).toContain(`Conversation ${new Intl.DateTimeFormat("en", { day: "numeric", month: "numeric" }).format(new Date(at(17)))}`);
    expect(out).not.toContain("Vady - posudok");
    expect(out.match(/data-lawoss-tree-new/g)).toHaveLength(1);
  });

  test(`najviac ${TREE_CONVERSATION_LIMIT} pod klientom aj vecou; Zobraziť všetky vedie na prehľad klienta a detail veci`, () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ workspaceId: "ws-tatran", id: `s${i}`, title: `Rozhovor ${i}`, updated: 100 - i }));
    const built = buildClientTree({ groups, focus: { matter: UHRADA.path }, overrides: {}, canStart: () => true,
      lists: { client: (key) => ready(key === "client:Tatran" ? many.map((c) => ({ ...c, id: `k${c.id}` })) : []), matter: (path) => ready(path === UHRADA.path ? many : []) } });
    expect(built[0].conversations).toHaveLength(TREE_CONVERSATION_LIMIT);
    expect(built[0].more).toBe(true);
    expect(built[0].matters[0].more).toBe(true);
    const out = render(<LiteNavView tree={built} />);
    expect(out.match(/data-lawoss-tree-conversation=/g)).toHaveLength(2 * TREE_CONVERSATION_LIMIT);
    expect(out).toMatch(new RegExp(`<a(?=[^>]*href="${clientOverviewLink("client:Tatran").replace(/[?]/g, "\\?").replace(/&/g, "&amp;")}")(?=[^>]*data-lawoss-tree-all)[^>]*>`));
    expect(out).toMatch(new RegExp(`<a(?=[^>]*href="${liteMatterLink(UHRADA.path).replace(/[?]/g, "\\?")}")(?=[^>]*data-lawoss-tree-all)[^>]*>`));
  });

  test("neúplný výpis (limit) ponúkne Zobraziť všetky aj pri menej ako 5", () => {
    const built = buildClientTree({ groups, focus: { matter: UHRADA.path }, overrides: {}, canStart: () => true,
      lists: { client: () => ready(), matter: () => ({ items: [{ workspaceId: "w", id: "a", title: "A", updated: 1 }], status: "ready", complete: false }) } });
    expect(built[0].matters[0].more).toBe(true);
  });

  test("chyba čítania nevyzerá ako prázdna vec: hláška a Skúsiť znova", () => {
    let retried = 0;
    const failing: ConversationList = { items: [], status: "error", complete: false, retry: () => { retried += 1; } };
    const built = buildClientTree({ groups, focus: { matter: UHRADA.path }, overrides: {}, canStart: () => true, lists: { client: () => failing, matter: () => failing } });
    expect(built[0].status).toBe("error");
    const out = render(<LiteNavView tree={built} />);
    expect(out.match(/data-lawoss-tree-error/g)).toHaveLength(2);
    expect(out).toContain("Conversations could not be loaded");
    expect(out).toContain("Try again");
    built[0].retry?.();
    expect(retried).toBe(1);
  });

  test("Nový rozhovor sa overuje len pri rozbalených veciach a rovnakou funkciou ako akcia", () => {
    const asked: string[] = [];
    const built = buildClientTree({ groups, focus: { matter: UHRADA.path }, overrides: {}, lists, canStart: (path) => { asked.push(path); return path !== UHRADA.path; } });
    expect(asked).toEqual([UHRADA.path]);
    expect(render(<LiteNavView tree={built} />)).not.toContain("data-lawoss-tree-new");
  });
});

describe("strom klientov: čo sa číta (24 klientov, 72 vecí)", () => {
  const big: ClientGroup[] = Array.from({ length: 24 }, (_, c) => ({ key: `client:K${c}`, client: `Klient ${c}`, matters: Array.from({ length: 3 }, (_, m) => matter(`K${c}/Spisy/V${m}`, `Vec ${c}-${m}`)) }));
  const folderOf = (rel: string) => { const [client, ...rest] = rel.split("/"); const w = ws(`ws-${client}`, `/prax/${client}`); return { workspace: w, abs: rest.length ? `/prax/${client}/${rest.join("/")}` : w.path }; };
  const folders = { client: (key: string) => folderOf(clientFolderFor(key, "") ?? ""), matter: (path: string) => folderOf(path) };
  const build = (focus: object, overrides = {}) => buildClientTree({ groups: big, focus, overrides, lists: { client: () => ready(), matter: () => ready() }, canStart: () => true });
  const abs = (plan: ReturnType<typeof fetchPlan>) => plan.map((f) => f.abs);

  test("zbalené nič; rozbalený klient = jeden výpis jeho podstromu; vec ďalší nepridá", () => {
    expect(fetchPlan(build({}), folders, () => undefined)).toEqual([]);
    expect(abs(fetchPlan(build({ client: "client:K3" }), folders, () => undefined))).toEqual(["/prax/K3"]);
    expect(abs(fetchPlan(build({ matter: "K3/Spisy/V1" }, { [matterToggle("K3/Spisy/V2")]: true }), folders, () => ({ subtree: true, folder: comparable("/prax/K3") })))).toEqual(["/prax/K3"]);
  });

  test("ak engine nevie podstrom, dočíta sa presne priečinok rozbalenej veci", () => {
    const plan = fetchPlan(build({ matter: "K3/Spisy/V1" }), folders, (folder) => folder === comparable("/prax/K3") ? { subtree: false, folder } : undefined);
    expect(abs(plan)).toEqual(["/prax/K3", "/prax/K3/Spisy/V1"]);
  });

  test("otvorená konverzácia: priečinok jej klienta, aj keď je strom zbalený", () => {
    expect(abs(fetchPlan(build({}), folders, () => undefined, folderOf("K9")))).toEqual(["/prax/K9"]);
  });

  test("priečinok klienta podľa kľúča skupiny", () => {
    expect(clientFolderFor("client:Klienti/Tatran", "Klienti/Tatran/Spisy/U")).toBe("Klienti/Tatran");
    expect(clientFolderFor("path:Novák", "AK/N/Novák/2026_spor")).toBe("AK/N/Novák");
    expect(clientFolderFor("matter:Spor", "Spor")).toBeNull();
  });
});

describe("Posledné veci nahradil strom; texty", () => {
  test("bočný panel už nemá Posledné veci", () => {
    const out = render(<LiteNav />);
    expect(out).not.toContain("Recent matters");
    for (const dict of [shellEn, shellCs, shellSk, shellDe]) expect(dict).not.toHaveProperty(["lawoss.lite.recent_matters"]);
  });

  test("texty stromu vo všetkých jazykoch; SK hovorí „rozhovor“ aj na detaile veci; nemčina bez dlhej pomlčky", () => {
    for (const dict of [shellEn, shellCs, shellSk, shellDe]) {
      for (const key of ["tree_title", "tree_new_conversation", "tree_show_all", "tree_conversation_on", "tree_expand", "tree_collapse", "clients_all", "tree_load_error", "client_conversations_title", "conversations_partial"]) {
        expect(dict).toHaveProperty([`lawoss.lite.${key}`]);
      }
    }
    expect(shellSk["lawoss.lite.tree_load_error"]).toBe("Rozhovory sa nepodarilo načítať");
    expect(shellSk["lawoss.lite.conversations_title"]).toBe("Rozpracované rozhovory");
    expect(shellSk["lawoss.lite.conversation_untitled"]).toBe("Rozhovor bez názvu");
    expect(Object.values(shellDe).some((value) => value.includes("—"))).toBe(false);
  });
});

describe("prehľad klienta a detail veci", () => {
  const client = [{ workspaceId: "ws-hron", id: "k1", title: "Otázka ku klientovi", updated: at(16) }];
  test("?klient= ukáže len kartu klienta, jeho rozhovory a odkaz na všetkých klientov", () => {
    const out = renderToStaticMarkup(<MemoryRouter><ClientsView locale="en" groups={groups} focus="client:Hron" clientConversations={{ items: client, status: "ready", complete: true }} /></MemoryRouter>);
    expect(out).toContain("SYN Hron Technológie");
    expect(out).not.toContain("SYN Tatran Automatika");
    expect(out).toContain("Otázka ku klientovi");
    expect(out).toContain("Client conversations");
    expect(out).toMatch(new RegExp(`<a[^>]*href="${LITE_CLIENTS_PATH}"[^>]*>All clients</a>`));
    const all = renderToStaticMarkup(<MemoryRouter><ClientsView locale="en" groups={groups} focus="client:Nikto" /></MemoryRouter>);
    expect(all).toContain("SYN Tatran Automatika");
    expect(all).not.toContain("All clients");
  });

  test("detail veci ukáže všetky rozhovory veci (nie 5) a pri neúplnom výpise to povie", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ workspaceId: "ws-tatran", id: `s${i}`, title: `Rozhovor ${i}`, updated: 100 - i }));
    const view = (complete: boolean) => renderToStaticMarkup(<MemoryRouter><LiteMatterView matter={UHRADA} cockpit={null} busy={null} error={null} onAction={() => {}} conversations={many} conversationsComplete={complete} /></MemoryRouter>);
    expect(view(true).match(/lw-matter-conv-title/g)).toHaveLength(8);
    expect(view(true)).not.toContain("Showing the most recent conversations");
    expect(view(false)).toContain("Showing the most recent conversations");
  });
});

describe("výpis priečinka ide do enginu, nie na výpis koreňa priečinka (PATCHES.md)", () => {
  test("session.list s `path` alebo `directory` použije proxy enginu; bez nich ostáva výpis LegalWork", async () => {
    const { createClient } = await import("../src/app/lib/opencode");
    const original = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(new Request(input, init).url);
      return new Response(JSON.stringify(urls.at(-1)?.includes("/sessions") ? { items: [] } : []), { headers: { "content-type": "application/json" } });
    }, { preconnect: original.preconnect });
    try {
      const client = createClient("http://127.0.0.1:9/workspace/ws-tatran/opencode", "/prax/Tatran", { token: "t", mode: "legalwork" });
      await client.session.list({ directory: "/prax/Tatran", path: "prax/Tatran", roots: true, limit: 5 });
      await client.session.list({ directory: "/prax/Tatran/Spisy/Uhrada", roots: true, limit: 5 });
      await client.session.list({ roots: true, limit: 5 });
    } finally { globalThis.fetch = original; }
    expect(urls[0]).toContain("/workspace/ws-tatran/opencode/session?");
    expect(urls[0]).toContain("path=prax%2FTatran");
    expect(urls[1]).toContain("/workspace/ws-tatran/opencode/session?directory=%2Fprax%2FTatran%2FSpisy%2FUhrada");
    expect(urls[2]).toContain("/workspace/ws-tatran/sessions?roots=true&limit=5");
  });
});
