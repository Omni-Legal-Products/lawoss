// Strom klientov, vecí a rozhovorov v bočnom paneli (variant A, MČ 19. 10. 2026; oprava po review).
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { shellCs, shellDe, shellEn, shellSk } from "../src/lawoss/i18n/shell";
import { LiteNav } from "../src/lawoss/lite/lite-nav";
import { ClientMattersView } from "../src/lawoss/lite/client-nav";
import {
  buildClientTree, clearFocusOverrides, clientFolderFor, clientToggle, fetchPlan, matterSource, matterToggle, routeFocus, sessionFocus,
  TREE_CONVERSATION_LIMIT, type ConversationList,
} from "../src/lawoss/lite/client-tree";
import {
  assignConversations, comparable, FOLDER_SESSION_LIMIT, FOLDER_SESSIONS_KEY, folderSessionsQuery, listFolderSessions, projectRelative,
  type FolderEngine, type FolderListing, type MatterConversation,
} from "../src/lawoss/lite/matter-conversations";
import { clientOverviewLink, LITE_CLIENTS_PATH, liteMatterLink } from "../src/lawoss/lite/links";
import { ClientsView } from "../src/lawoss/lite/pages/clients-page";
import { LiteMatterView } from "../src/lawoss/lite/pages/matter-page";
import { useClientTree, useMatterConversations } from "../src/lawoss/lite/client-tree-data";
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

  type Listed = ReturnType<typeof session> & { metadata?: unknown; time: { created: number; updated: number; archived?: number } };
  /** `engineDir`: tvar priečinka v engine (`GET /path`); `projectId: null` = projekt sa nepodarilo zistiť. */
  const fake = (worktree: string | null, items: Listed[], projectId: string | null = "global", engineDir?: (folder: string) => string) => {
    const calls: unknown[] = [];
    const engine: FolderEngine = {
      locate: async (folder) => { calls.push(["locate", folder]); if (worktree === null) throw new Error("no path"); return { directory: engineDir?.(folder) ?? folder, worktree, projectId }; },
      list: async (folder, query, signal) => { calls.push(["list", folder, query, signal instanceof AbortSignal]); return items; },
    };
    return { engine, calls };
  };

  test("podstrom klienta cez `path` (limit platí po filtri enginu), cudzie položky sa zahodia, signal sa odovzdá", async () => {
    const { engine, calls } = fake("/", [...TATRAN.items, session("cudzi", "Beta", "/prax/Beta/Spisy/Najom", 20)]);
    const listing = await listFolderSessions(engine, "ws-tatran", "/prax/Tatran", new AbortController().signal);
    expect(calls).toEqual([["locate", "/prax/Tatran"], ["list", "/prax/Tatran", { path: "prax/Tatran", roots: true, limit: FOLDER_SESSION_LIMIT }, true]]);
    expect(listing.subtree).toBe(true);
    expect(listing.complete).toBe(true);
    expect(listing.items.map((s) => s.id)).not.toContain("cudzi");
    expect(listing.items).toHaveLength(TATRAN.items.length);
  });

  test("tvar priečinka v engine nezistený: chyba, nie tichý prázdny zoznam", async () => {
    await expect(listFolderSessions(fake(null, TATRAN.items).engine, "ws-tatran", "/prax/Tatran")).rejects.toThrow("no path");
  });

  test("priečinok mimo koreňa projektu: presný výpis (bez `path`), podpriečinky nepredstiera", async () => {
    const { engine, calls } = fake("/ine", TATRAN.items);
    const listing = await listFolderSessions(engine, "ws-tatran", "/prax/Tatran");
    expect(calls[1]).toEqual(["list", "/prax/Tatran", { roots: true, limit: FOLDER_SESSION_LIMIT }, false]);
    expect(listing.subtree).toBe(false);
    expect(listing.items.map((s) => s.id)).toEqual(["s-klient"]);
  });

  test("symbolický odkaz: `path` z tvaru enginu a priečinky prevedené späť do tvaru appky", async () => {
    const real = (dir: string) => dir.replace("/prax/", "/Volumes/Data/prax/");
    const items = TATRAN.items.map((s) => ({ ...s, directory: real(s.directory) }));
    const { engine, calls } = fake("/", items, "global", real);
    const listing = await listFolderSessions(engine, "ws-tatran", "/prax/Tatran");
    expect(calls[1]).toEqual(["list", "/prax/Tatran", { path: "Volumes/Data/prax/Tatran", roots: true, limit: FOLDER_SESSION_LIMIT }, false]);
    expect(assignConversations([listing], owners).byMatter.get(UHRADA.path)?.map((c) => c.id)).toEqual(["s-zhrnutie", "s-navrh", "s-bez", "s-podanie"]);
  });

  test("diakritika na disku rozložená (NFD „Šimková“): `path` v tvare enginu, priradenie v tvare appky", async () => {
    const disk = "/prax/Šimková Ľupták".normalize("NFD");
    const app = "/prax/Šimková Ľupták".normalize("NFC");
    const { engine, calls } = fake("/", [session("n1", "Dedičstvo", `${disk}/Spisy/Dedičstvo`, 3), session("n2", "Otázka", disk, 2)], "global", () => disk);
    const listing = await listFolderSessions(engine, "ws-simkova", app);
    expect((calls[1] as [string, string, { path: string }])[2].path).toBe(disk.slice(1));
    const result = assignConversations([listing], { clients: [{ key: "simkova", folder: comparable(app) }], matters: [{ path: "D", folder: comparable(`${app}/Spisy/Dedičstvo`) }] });
    expect([result.byClient.get("simkova")?.map((c) => c.id), result.byMatter.get("D")?.map((c) => c.id)]).toEqual([["n2"], ["n1"]]);
  });

  test("interné konverzácie posudkov a archivované sa neukazujú (ako upstream)", async () => {
    const items: Listed[] = [
      session("ok", "Otázka", "/prax/Tatran", 3),
      { ...session("review", "Review: zmluva", "/prax/Tatran", 2), metadata: { legalworkReviewWorker: true } },
      { ...session("archiv", "Starý", "/prax/Tatran", 1), time: { created: 1, updated: 1, archived: 5 } },
      { ...session("obnoveny", "Obnovený", "/prax/Tatran", 1), time: { created: 1, updated: 1, archived: 0 } },
    ];
    const listing = await listFolderSessions(fake("/", items).engine, "ws-tatran", "/prax/Tatran");
    expect(listing.items.map((s) => s.id)).toEqual(["ok", "obnoveny"]);
  });

  test("koreň vlastného projektu (git) = priečinok: `path` = \"\" vypíše len ten projekt", async () => {
    const { engine, calls } = fake("/prax/Tatran", TATRAN.items, "a1b2c3");
    const listing = await listFolderSessions(engine, "ws-tatran", "/prax/Tatran");
    expect(calls[1]).toEqual(["list", "/prax/Tatran", { path: "", roots: true, limit: FOLDER_SESSION_LIMIT }, false]);
    expect(listing.subtree).toBe(true);
  });

  test("globálny alebo neznámy projekt s koreňom v priečinku (git bez commitu): presný výpis, nie celý engine", async () => {
    // Skutočný engine 1.18.29: `path=` by vypísal všetky konverzácie všetkých klientov a limit by ich orezal.
    for (const id of ["global", null]) {
      const { engine, calls } = fake("/prax/Tatran", TATRAN.items, id);
      const listing = await listFolderSessions(engine, "ws-tatran", "/prax/Tatran");
      expect(calls[1]).toEqual(["list", "/prax/Tatran", { roots: true, limit: FOLDER_SESSION_LIMIT }, false]);
      expect(listing.subtree).toBe(false);
    }
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

// Strom sa od 19. 10. 2026 vykresľuje v natívnej sekcii klientov ako položka „Prípady“ (`ClientMattersView`):
// pri projekte s viacerými klientmi (jeden priečinok pre všetko) s medzistupňom klienta, chaty klienta sú natívne „Chaty“.
const view = (nodes: ReturnType<typeof tree>) => <ClientMattersView nodes={nodes} open locale="en" />;

describe("strom klientov: rozbalenie", () => {
  test("bez aktuálneho klienta sú všetci klienti zbalení a veci nie sú vidieť", () => {
    const out = render(view(tree()));
    expect(out).toContain("SYN Tatran Automatika");
    expect(out).toContain(`href="${clientOverviewLink("client:Tatran").replace(/&/g, "&amp;")}"`);
    expect(out).not.toContain("Úhrada dodávok");
    expect(out).not.toContain("Otázka ku klientovi");
    const toggles = out.match(/<button[^>]*data-lawoss-tree-toggle[^>]*>/g) ?? [];
    expect(toggles).toHaveLength(2);
    for (const toggle of toggles) expect(toggle).toContain('aria-expanded="false"');
  });

  test("detail veci rozbalí jej klienta aj vec; ostatní ostanú zbalení", () => {
    const focus = routeFocus("/vec", `?vec=${encodeURIComponent(UHRADA.path)}`);
    const built = tree(focus);
    expect(built.map((c) => [c.key, c.expanded])).toEqual([["client:Tatran", true], ["client:Hron", false]]);
    expect(built[0].matters.map((m) => [m.path, m.expanded])).toEqual([[UHRADA.path, true], [VADY.path, false]]);
    const out = render(view(built), liteMatterLink(UHRADA.path));
    expect(out).toMatch(/<a(?=[^>]*aria-current="page")[^>]*href="\/vec\?vec=Tatran%2FSpisy%2FUhrada"/);
  });

  test("otvorený chat v koreni klienta rozbalí klienta; chat vo veci rozbalí vec a je označený", () => {
    const route = routeFocus("/workspace/ws-tatran/session/s-klient", "");
    expect(sessionFocus(route, assigned)).toEqual({ client: "client:Tatran" });
    expect(sessionFocus(routeFocus("/workspace/ws-tatran/session/s-podanie", ""), assigned)).toEqual({ matter: UHRADA.path });
    expect(sessionFocus(routeFocus("/workspace/ws-x/session/neznamy", ""), assigned)).toEqual({});
    expect(tree(sessionFocus(route, assigned))[0].expanded).toBe(true);
    const inMatter = tree(sessionFocus(routeFocus("/workspace/ws-tatran/session/s-podanie", ""), assigned));
    const out = render(view(inMatter), "/workspace/ws-tatran/session/s-podanie");
    expect(out).toMatch(/<button(?=[^>]*aria-current="page")(?=[^>]*data-lawoss-tree-conversation="s-podanie")[^>]*>/);
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
    const out = render(view(tree({ matter: UHRADA.path }, { [clientToggle("client:Hron")]: true })));
    const toggles = out.match(/<button[^>]*data-lawoss-tree-toggle[^>]*>/g) ?? [];
    expect(toggles).toHaveLength(5);
    for (const toggle of toggles) expect(toggle).toMatch(/aria-expanded="(true|false)"/);
  });
});

describe("strom klientov: chaty vecí", () => {
  test("vec ukáže svoje chaty vrátane podpriečinka a + Nový chat; chaty klienta tu nie sú (natívne Chaty)", () => {
    const out = render(view(tree({ matter: UHRADA.path })));
    expect(out).not.toContain("Otázka ku klientovi");
    expect(out).toContain("Úhrada dodávok");
    expect(out).toContain("Podanie na súd");
    expect(out).toContain(`Conversation ${new Intl.DateTimeFormat("en", { day: "numeric", month: "numeric" }).format(new Date(at(17)))}`);
    expect(out).not.toContain("Vady - posudok");
    expect(out.match(/data-lawoss-tree-new/g)).toHaveLength(1);
  });

  test(`najviac ${TREE_CONVERSATION_LIMIT} pod vecou; Zobraziť všetky vedie na detail veci`, () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ workspaceId: "ws-tatran", id: `s${i}`, title: `Rozhovor ${i}`, updated: 100 - i }));
    const built = buildClientTree({ groups, focus: { matter: UHRADA.path }, overrides: {}, canStart: () => true,
      lists: { client: (key) => ready(key === "client:Tatran" ? many.map((c) => ({ ...c, id: `k${c.id}` })) : []), matter: (path) => ready(path === UHRADA.path ? many : []) } });
    expect(built[0].conversations).toHaveLength(TREE_CONVERSATION_LIMIT);
    expect(built[0].more).toBe(true);
    expect(built[0].matters[0].more).toBe(true);
    const out = render(view(built));
    expect(out.match(/data-lawoss-tree-conversation=/g)).toHaveLength(TREE_CONVERSATION_LIMIT);
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
    const out = render(view(built));
    expect(out.match(/data-lawoss-tree-error/g)).toHaveLength(1);
    expect(out).toContain("Conversations could not be loaded");
    expect(out).toContain("Try again");
    built[0].matters[0].retry?.();
    expect(retried).toBe(1);
  });

  test("Nový chat sa overuje len pri rozbalených veciach a rovnakou funkciou ako akcia", () => {
    const asked: string[] = [];
    const built = buildClientTree({ groups, focus: { matter: UHRADA.path }, overrides: {}, lists, canStart: (path) => { asked.push(path); return path !== UHRADA.path; } });
    expect(asked).toEqual([UHRADA.path]);
    expect(render(view(built))).not.toContain("data-lawoss-tree-new");
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
    expect(abs(fetchPlan(build({ matter: "K3/Spisy/V1" }, { [matterToggle("K3/Spisy/V2")]: true }), folders, () => ({ subtree: true, folder: comparable("/prax/K3"), complete: true })))).toEqual(["/prax/K3"]);
  });

  test("ak engine nevie podstrom, dočíta sa presne priečinok rozbalenej veci", () => {
    const plan = fetchPlan(build({ matter: "K3/Spisy/V1" }), folders, (folder) => folder === comparable("/prax/K3") ? { subtree: false, folder, complete: true } : undefined);
    expect(abs(plan)).toEqual(["/prax/K3", "/prax/K3/Spisy/V1"]);
  });

  test("výpis klienta narazil na limit: rozbalená vec sa dočíta vlastným podstromom (limit až po filtri `path`)", () => {
    const plan = fetchPlan(build({ matter: "K3/Spisy/V1" }), folders, (folder) => folder === comparable("/prax/K3") ? { subtree: true, folder, complete: false } : undefined);
    expect(abs(plan)).toEqual(["/prax/K3", "/prax/K3/Spisy/V1"]);
  });

  test("zdroj rozhovorov veci: rovnaké pravidlo pre plán, strom aj detail veci", () => {
    const root = folderOf("K3"), own = folderOf("K3/Spisy/V1");
    const listing = (subtree: boolean, complete: boolean) => ({ subtree, complete, folder: comparable(root.abs) });
    expect(matterSource(root, undefined, own)).toBe("client");
    expect(matterSource(root, listing(true, true), own)).toBe("client");
    expect(matterSource(root, listing(true, false), own)).toBe("own");
    expect(matterSource(root, listing(false, true), own)).toBe("own");
    expect(matterSource(null, undefined, own)).toBe("own");
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

describe("Posledné veci ani starý strom v navigácii LAWOSS; texty", () => {
  test("navigácia LAWOSS nemá Posledné veci ani strom klientov (sú v natívnej sekcii klientov)", () => {
    const out = render(<LiteNav />);
    expect(out).not.toContain("Recent matters");
    expect(out).not.toContain("data-lawoss-lite-tree");
    for (const dict of [shellEn, shellCs, shellSk, shellDe]) expect(dict).not.toHaveProperty(["lawoss.lite.recent_matters"]);
  });

  test("texty stromu vo všetkých jazykoch; SK aj CS hovoria „chat“ aj na detaile veci (MČ 19. 10.); nemčina bez dlhej pomlčky", () => {
    for (const dict of [shellEn, shellCs, shellSk, shellDe]) {
      for (const key of ["tree_title", "tree_new_conversation", "tree_show_all", "tree_conversation_on", "tree_expand", "tree_collapse", "clients_all", "tree_load_error", "client_conversations_title", "conversations_partial"]) {
        expect(dict).toHaveProperty([`lawoss.lite.${key}`]);
      }
    }
    expect(shellSk["lawoss.lite.tree_load_error"]).toBe("Chaty sa nepodarilo načítať");
    expect(shellSk["lawoss.lite.conversations_title"]).toBe("Rozpracované chaty");
    expect(shellSk["lawoss.lite.conversation_untitled"]).toBe("Chat bez názvu");
    expect(shellCs["lawoss.lite.conversations_title"]).toBe("Rozpracované chaty");
    expect(shellCs["lawoss.lite.conversation_untitled"]).toBe("Chat bez názvu");
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

describe("háky stromu a detailu veci (server-side render nad naplnenou cache)", () => {
  // Bez DOM knižnice: React Query pri vykreslení na serveri nič nečíta, ale vráti dáta z cache
  // a zaregistruje dotazy, ktoré hák chce. Počet dotazov v cache = plán čítania.
  const office = ws("office", "/prax");
  const scope = { anchor: office, members: [{ workspace: office, prefix: "" }] };
  const m1 = matter("AK/T/Tatran/Uhrada", "Úhrada dodávok");
  const m2 = matter("AK/T/Tatran/Vady", "Vady");
  const m3 = matter("AK/H/Hron/Zmluva", "Zmluva");
  const data = { matters: [m1, m2, m3], inputs: [], clients: [], upcomingDeadlines: [], overdue: [], problems: [], truncated: false };
  const connection = { client: {} as never, baseUrl: "http://x", token: "t", workspaces: [office], activeWorkspaceId: office.id };
  const tatranListing: FolderListing = {
    workspaceId: office.id, folder: comparable("/prax/AK/T/Tatran"), subtree: true, complete: true, items: [
      session("u1", "Zhrnutie spisu", "/prax/AK/T/Tatran/Uhrada", 19),
      session("u2", "Podanie", "/prax/AK/T/Tatran/Uhrada/Podania", 18),
      session("k1", "Otázka ku klientovi", "/prax/AK/T/Tatran", 17),
    ],
  };
  const filled = () => {
    const queries = new QueryClient();
    queries.setQueryData(folderSessionsQuery(connection, { workspace: office, abs: "/prax/AK/T/Tatran" }).queryKey, tatranListing);
    return queries;
  };
  const folderQueries = (queries: QueryClient) => queries.getQueryCache().findAll({ queryKey: [FOLDER_SESSIONS_KEY] }).map((q) => q.queryKey[2]);
  const renderWith = (queries: QueryClient, entry: string, node: ReactElement) => renderToStaticMarkup(
    <QueryClientProvider client={queries}><MemoryRouter initialEntries={[entry]}>{node}</MemoryRouter></QueryClientProvider>);

  test("useClientTree: detail veci = jeden výpis klienta, rozhovory klienta aj veci z neho; ostatní klienti nič", () => {
    function Probe() {
      const tree = useClientTree(connection, scope, data as never, "/vec", `?vec=${encodeURIComponent(m1.path)}`, "en");
      return <pre>{JSON.stringify(tree.nodes.map((c) => ({ key: c.key, expanded: c.expanded, client: c.conversations.map((x) => x.id), matters: c.matters.map((m) => [m.path, m.expanded, m.status, m.conversations.map((x) => x.id)]) })))}</pre>;
    }
    const queries = filled();
    const out = renderWith(queries, "/dnes", <Probe />).replace(/&quot;/g, '"');
    expect(out).toContain('{"key":"path:Tatran","expanded":true,"client":["k1"],"matters":[["AK/T/Tatran/Uhrada",true,"ready",["u1","u2"]],["AK/T/Tatran/Vady",false,"ready",[]]]}');
    expect(out).toContain('{"key":"path:Hron","expanded":false,"client":[],"matters":[["AK/H/Hron/Zmluva",false,"ready",[]]]}');
    expect(folderQueries(queries)).toEqual([comparable("/prax/AK/T/Tatran")]);
  });

  test("useClientTree: neúplný výpis klienta → strom číta aj vlastný podstrom rozbalenej veci (žiadne večné čakanie)", () => {
    function Probe() {
      const tree = useClientTree(connection, scope, data as never, "/vec", `?vec=${encodeURIComponent(m1.path)}`, "en");
      return <pre>{JSON.stringify(tree.nodes[1]?.matters[0]?.status)}</pre>;
    }
    const queries = new QueryClient();
    queries.setQueryData(folderSessionsQuery(connection, { workspace: office, abs: "/prax/AK/T/Tatran" }).queryKey, { ...tatranListing, complete: false });
    queries.setQueryData(folderSessionsQuery(connection, { workspace: office, abs: "/prax/AK/T/Tatran/Uhrada" }).queryKey, { ...tatranListing, folder: comparable("/prax/AK/T/Tatran/Uhrada"), items: tatranListing.items.slice(0, 2) });
    expect(renderWith(queries, "/dnes", <Probe />).replace(/&quot;/g, '"')).toContain('"ready"');
    expect(folderQueries(queries).sort()).toEqual([comparable("/prax/AK/T/Tatran"), comparable("/prax/AK/T/Tatran/Uhrada")]);
  });

  test("useClientTree: zbalený strom nečíta nič", () => {
    function Probe() { useClientTree(connection, scope, data as never, "/dnes", "", "en"); return null; }
    const queries = new QueryClient();
    renderWith(queries, "/dnes", <Probe />);
    expect(folderQueries(queries)).toEqual([]);
  });

  test("useClientTree: „+ Nový chat“ len nad čerstvo prečítaným zdrojom klienta (#168 canActOnSource)", () => {
    const coverage = (state: "fresh" | "stale") => ({ status: state === "fresh" ? "complete" : "partial", scopeKey: "k", sources: [{ source: "workspace", workspaceId: office.id, checkedAt: 1, lastSuccessAt: 1, state }] });
    const canStart = (withCoverage: object) => {
      function Probe() {
        const tree = useClientTree(connection, scope, { ...data, ...withCoverage } as never, "/vec", `?vec=${encodeURIComponent(m1.path)}`, "en");
        return <pre>{JSON.stringify(tree.nodes.flatMap((n) => n.matters).find((m) => m.path === m1.path)?.canStart)}</pre>;
      }
      return renderWith(filled(), "/dnes", <Probe />);
    };
    expect(canStart({ coverage: coverage("fresh") })).toContain("true");
    expect(canStart({ coverage: coverage("stale") })).toContain("false");
    // Bez pokrytia (neznámy zdroj) sa nový chat neponúkne.
    expect(canStart({})).toContain("false");
  });

  test("useMatterConversations: všetky rozhovory veci z toho istého výpisu ako strom", () => {
    function Probe() {
      const list = useMatterConversations(connection, scope, data as never, m1);
      return <pre>{JSON.stringify([list.status, list.complete, list.items.map((x) => x.id)])}</pre>;
    }
    const queries = filled();
    expect(renderWith(queries, "/vec", <Probe />).replace(/&quot;/g, '"')).toContain('["ready",true,["u1","u2"]]');
    expect(folderQueries(queries)).toEqual([comparable("/prax/AK/T/Tatran")]);
  });

  test("useMatterConversations: neúplný výpis klienta → vlastný podstrom veci (čaká sa naň, nie prázdno)", () => {
    function Probe() {
      const list = useMatterConversations(connection, scope, data as never, m1);
      return <pre>{JSON.stringify([list.status, list.items.length])}</pre>;
    }
    const queries = new QueryClient();
    queries.setQueryData(folderSessionsQuery(connection, { workspace: office, abs: "/prax/AK/T/Tatran" }).queryKey, { ...tatranListing, complete: false });
    expect(renderWith(queries, "/vec", <Probe />).replace(/&quot;/g, '"')).toContain('["loading",0]');
    expect(folderQueries(queries)).toEqual([comparable("/prax/AK/T/Tatran"), comparable("/prax/AK/T/Tatran/Uhrada")]);
  });
});
