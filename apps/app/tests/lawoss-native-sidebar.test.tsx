// Natívny bočný panel s klientmi a prípadmi (rozhodnutie MČ 19. 10. 2026, oprava po review): klient = natívny
// projekt (registrovaný priečinok), pod ním Domov, Prípady, Lehoty, Úlohy, Súbory, Chaty.
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createJSONStorage } from "zustand/middleware";
import type { ReactElement } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { t, type Language } from "@/i18n";
import type { WorkspaceSessionGroup } from "@/app/types";
import { chatSectionShown, LITE_CHAT_SECTIONS_KEY, reloadLiteChatSections, setLiteChatSection } from "../src/lawoss/lite/chat-sections";
import { LawossNav } from "../src/lawoss/shell/layout";
import { NEW_CLIENT_PATH, clientDeadlinesLink, liteMatterLink } from "../src/lawoss/lite/links";
import { clientDeadlines, clientGroupDirectory, clientNavAnchor, clientNavModel, ownerOfFolder, type ClientOverviewState } from "../src/lawoss/lite/client-projects";
import { closedGroups, focusedProject, forgetProjectOverride, mattersOpen, newChatAction, newChatChoices, projectNewChatAction, projectNodes } from "../src/lawoss/lite/client-nav-model";
import { isClientFolderOf } from "../src/lawoss/lite/office-scope";
import { clientChatKeys, ClientDeadlinesNavItem, ClientMattersNavItem, ClientMattersView, ClientNavTestProvider, liveConnection, liveProjectGroups, liveSessionDirectories, practiceRootState } from "../src/lawoss/lite/client-nav";
import { ClientOverviewView } from "../src/lawoss/lite/client-overview";
import { buildClientTree, clientToggle, directoryFocus, type ConversationList, type TreeClient } from "../src/lawoss/lite/client-tree";
import { SESSION_DIRECTORY_KEY, useClientTree } from "../src/lawoss/lite/client-tree-data";
import { buildClientRows } from "../src/lawoss/lite/client-row-data";
import { comparable, FOLDER_SESSIONS_KEY } from "../src/lawoss/lite/matter-conversations";
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
const ready = (items: ConversationList["items"] = []): ConversationList => ({ items, status: "ready", complete: true });
const readyOverview = (scope: OkfScope, groups: readonly ClientGroup[]): ClientOverviewState => ({ status: "ready", scope, groups, matters: groups.flatMap((g) => g.matters) });

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

// Prax s registrovaným koreňom, jedným registrovaným klientom, dvoma neregistrovanými a staršou vecou registrovanou zvlášť.
const root = ws("root", "/prax");
const tatranWs = ws("tatran", "/prax/Klienti/Tatran");
const legacy = ws("legacy", "/prax/Klienti/Hron/Spisy/Stara");
const T_UHRADA = matter("Klienti/Tatran/Spisy/Uhrada", "Úhrada dodávok", ["2026-10-21"]);
const H_STARA = matter("Klienti/Hron/Spisy/Stara", "Stará vec");
const N_DEDIC = matter("Klienti/Novak/Spisy/Dedic", "Dedičstvo", ["2026-11-30"]);
const mixedGroups: ClientGroup[] = [
  { key: "client:Klienti/Hron", client: "Hron", matters: [H_STARA] },
  { key: "client:Klienti/Novak", client: "Novák", matters: [N_DEDIC] },
  { key: "client:Klienti/Tatran", client: "Tatran", matters: [T_UHRADA] },
];
const rootScope: OkfScope = { anchor: root, members: [{ workspace: root, prefix: "" }] };
const mixed = clientNavModel([root, tatranWs, legacy], "/prax", readyOverview(rootScope, mixedGroups));

type TestValue = Parameters<typeof ClientNavTestProvider>[0]["value"];
function navValue(model: TestValue["model"], nodes: TreeClient[], extra: Partial<TestValue> = {}): TestValue {
  return {
    connection: null, scope: rootScope, data: undefined, groups: mixedGroups, model, excludedWorkspaceIds: [], rows: new Map(),
    tree: { nodes, toggle: () => {}, openConversation: () => {}, newConversation: () => {} },
    open: {}, setOpen: () => {}, focused: null, startNewChat: () => false, ...extra,
  };
}
const mixedTree = (focus = {}, overrides = {}) => buildClientTree({ groups: mixedGroups, focus, overrides, canStart: () => true, lists: { client: () => ready(), matter: () => ready() } });

describe("koreň praxe a staršia vec (oprava po review)", () => {
  test("koreň s registrovaným klientom a dvoma neregistrovanými ostane; Prípady koreňa len pre neregistrovaných, klient svoje; staršia vec skrytá", () => {
    expect([...mixed.hidden]).toEqual(["legacy"]);
    expect(mixed.ownerOf.get("client:Klienti/Tatran")).toBe("tatran");
    expect(mixed.ownerOf.get("client:Klienti/Hron")).toBe("root");
    expect(mixed.ownerOf.get("client:Klienti/Novak")).toBe("root");
    expect(projectNodes(mixedTree(), mixed, "root")?.map((n) => n.key)).toEqual(["client:Klienti/Hron", "client:Klienti/Novak"]);
    expect(projectNodes(mixedTree(), mixed, "tatran")?.map((n) => n.key)).toEqual(["client:Klienti/Tatran"]);
    expect(projectNodes(mixedTree(), mixed, "legacy")).toBeNull();
  });

  test("koreň sa skryje, len keď všetkých klientov vlastnia registrovaní klienti", () => {
    const hronWs = ws("hron", "/prax/Klienti/Hron");
    const novakWs = ws("novak", "/prax/Klienti/Novak");
    const all = clientNavModel([root, tatranWs, hronWs, novakWs, legacy], "/prax", readyOverview(rootScope, mixedGroups));
    expect([...all.hidden].sort()).toEqual(["legacy", "root"]);
    expect(all.ownerOf.get("client:Klienti/Hron")).toBe("hron");
  });

  test("jeden priečinok pre všetko: koreň je jediný a vlastní všetkých; bez praxe sa nič neskrýva", () => {
    const one = clientNavModel([root], "/prax", readyOverview(rootScope, mixedGroups));
    expect([...one.hidden]).toEqual([]);
    expect(projectNodes(mixedTree(), one, "root")).toHaveLength(3);
    expect([...clientNavModel([root, tatranWs, legacy], null, { status: "unavailable" }).hidden]).toEqual([]);
  });

  test("čítanie: kým sa spojenie, koreň praxe alebo prehľad číta, kandidáti (koreň aj staršia vec) sa neukážu; chyba = koreň ostane", () => {
    expect([...clientNavModel([root, tatranWs, ws("ine", "/ine")], undefined, { status: "pending" }).hidden].sort()).toEqual(["root", "tatran"]);
    expect([...clientNavModel([root, tatranWs, legacy], "/prax", { status: "pending" }).hidden].sort()).toEqual(["legacy", "root", "tatran"]);
    expect([...clientNavModel([root, legacy], "/prax", { status: "pending" }).hidden].sort()).toEqual(["legacy", "root"]);
    expect([...clientNavModel([root], "/prax", { status: "pending" }).hidden]).toEqual([]);
    expect([...clientNavModel([root, tatranWs], "/prax", { status: "unavailable" }).hidden]).toEqual([]);
  });

  test("prázdny prehľad (žiadny klient) koreň neskryje", () => {
    expect([...clientNavModel([root, tatranWs], "/prax", readyOverview(rootScope, [])).hidden]).toEqual([]);
  });

  test("registrovaný podpriečinok klienta (nie vec) sa skryje", () => {
    const sub = ws("sub", "/prax/Klienti/Tatran/Korešpondencia");
    expect([...clientNavModel([tatranWs, sub], "/prax", { status: "unavailable" }).hidden]).toEqual(["sub"]);
  });

  test("vlastník priečinka je najhlbší viditeľný projekt; prax sa číta od priečinka praxe", () => {
    expect(ownerOfFolder(mixed.visible, comparable("/prax/Klienti/Tatran/Spisy/Uhrada"))).toBe("tatran");
    expect(ownerOfFolder(mixed.visible, comparable("/prax/Klienti/Hron/Spisy/Stara"))).toBe("root");
    expect(ownerOfFolder(mixed.visible, comparable("/ine"))).toBeNull();
    const outside = ws("ine", "/ine/Projekt");
    expect(clientNavAnchor([outside, tatranWs], "/prax", outside)?.id).toBe("tatran");
    expect(clientNavAnchor([outside, tatranWs], null, outside)?.id).toBe("ine");
  });
});

describe("Prípady projektu: model a položka v paneli", () => {
  test("cudzí projekt nič; člen praxe bez klientov = prázdne Prípady", () => {
    const tatran = ws("tatran", "/p/Tatran");
    const practice: OkfScope = { anchor: tatran, members: [{ workspace: tatran, prefix: "Tatran" }], practiceRoot: "/p" };
    const model = clientNavModel([tatran, ws("ine", "/ine")], "/p", readyOverview(practice, []));
    expect(projectNodes([], model, "ine")).toBeNull();
    expect(projectNodes([], model, "tatran")).toEqual([]);
    const value = navValue(model, [], { open: { tatran: true } });
    expect(html(<ClientNavTestProvider value={value}><ul><ClientMattersNavItem workspaceId="ine" /><ClientDeadlinesNavItem workspaceId="ine" /></ul></ClientNavTestProvider>)).toContain("<ul></ul>");
    expect(html(<ClientNavTestProvider value={value}><ul><ClientMattersNavItem workspaceId="tatran" /></ul></ClientNavTestProvider>)).toContain("No cases yet");
  });

  test("jeden klient: Prípady = jeho uzol; klik prepne jeho uzol (zbalený nič nečíta)", () => {
    const [node] = mixedTree().filter((n) => n.key === "client:Klienti/Tatran");
    expect(mattersOpen([node], true, true)).toEqual({ open: false, toggle: { kind: "client", key: clientToggle(node.key), expanded: false } });
    const open = { ...node, expanded: true };
    expect(mattersOpen([open], false, false).open).toBe(true);
    const out = html(<ClientNavTestProvider value={navValue(mixed, [open])}><ul><ClientMattersNavItem workspaceId="tatran" /></ul></ClientNavTestProvider>);
    expect(out).toMatch(/<button(?=[^>]*data-lawoss-project-matters="")(?=[^>]*aria-expanded="true")[^>]*>/);
    expect(out).toContain("Úhrada dodávok");
  });

  test("viac klientov: voľba používateľa, inak otvorené pri trase v projekte; trasa zabudne zatvorenie", () => {
    const nodes = projectNodes(mixedTree(), mixed, "root") ?? [];
    expect(mattersOpen(nodes, undefined, false)).toEqual({ open: false, toggle: { kind: "project", open: true } });
    expect(mattersOpen(nodes, undefined, true).open).toBe(true);
    expect(mattersOpen(nodes, false, true).open).toBe(false);
    expect(forgetProjectOverride({ root: false, tatran: true }, "root")).toEqual({ tatran: true });
    const same = { tatran: true };
    expect(forgetProjectOverride(same, "root")).toBe(same);
    expect(focusedProject({ matter: N_DEDIC.path }, mixedGroups, mixed.ownerOf)).toBe("root");
    expect(focusedProject({ client: "client:Klienti/Tatran" }, mixedGroups, mixed.ownerOf)).toBe("tatran");
    expect(focusedProject({}, mixedGroups, mixed.ownerOf)).toBeNull();
  });

  test("zatvorené Prípady projektu s viacerými klientmi: jeho klienti sa nečítajú; jeden klient tým nie je dotknutý", () => {
    expect([...closedGroups(mixedGroups, mixed.ownerOf, {}, null)].sort()).toEqual(["client:Klienti/Hron", "client:Klienti/Novak"]);
    expect([...closedGroups(mixedGroups, mixed.ownerOf, {}, "root")]).toEqual([]);
    expect([...closedGroups(mixedGroups, mixed.ownerOf, { root: true }, null)]).toEqual([]);
    expect([...closedGroups(mixedGroups, mixed.ownerOf, { root: false }, "root")].sort()).toEqual(["client:Klienti/Hron", "client:Klienti/Novak"]);
  });

  test("koreň a registrovaný klient: každá položka ukáže len svojich klientov", () => {
    const nodes = mixedTree({ matter: N_DEDIC.path }, { [clientToggle("client:Klienti/Tatran")]: true });
    const value = navValue(mixed, nodes, { open: { root: true } });
    const rootOut = html(<ClientNavTestProvider value={value}><ul><ClientMattersNavItem workspaceId="root" /></ul></ClientNavTestProvider>);
    expect(rootOut).toContain("Novák");
    expect(rootOut).toContain("Hron");
    expect(rootOut).not.toContain("Úhrada dodávok");
    const tatranOut = html(<ClientNavTestProvider value={value}><ul><ClientMattersNavItem workspaceId="tatran" /></ul></ClientNavTestProvider>);
    expect(tatranOut).toContain("Úhrada dodávok");
    expect(tatranOut).not.toContain("Dedičstvo");
  });
});

describe("strom v paneli: natívny chat v priečinku a zatvorené Prípady nič nečítajú", () => {
  const office = ws("office", "/prax");
  const scope: OkfScope = { anchor: office, members: [{ workspace: office, prefix: "" }] };
  const m1 = matter("AK/T/Tatran/Uhrada", "Úhrada dodávok");
  const data = { matters: [m1], inputs: [], clients: [], upcomingDeadlines: [], overdue: [], problems: [], truncated: false };
  const connection = { client: {} as never, baseUrl: "http://x", token: "t", workspaces: [office], activeWorkspaceId: office.id };
  const probe = (pathname: string, search: string, options: Parameters<typeof useClientTree>[6]) => {
    const queries = new QueryClient();
    let expanded: boolean | undefined;
    function Probe() { expanded = useClientTree(connection, scope, data as never, pathname, search, "en", options).nodes[0]?.expanded; return null; }
    renderToStaticMarkup(<QueryClientProvider client={queries}><MemoryRouter><Probe /></MemoryRouter></QueryClientProvider>);
    return {
      expanded,
      reads: queries.getQueryCache().findAll({ queryKey: [FOLDER_SESSIONS_KEY] }).length,
      ...(options && "sessionDirectory" in options ? { lookups: queries.getQueryCache().findAll({ queryKey: [SESSION_DIRECTORY_KEY] }).filter((q) => !("enabled" in q.options && q.options.enabled === false)).length } : {}),
    };
  };

  test("chat priamo v priečinku projektu (natívne Chaty) nerozbalí Prípady a nespustí výpis podstromu", () => {
    expect(probe("/workspace/office/session/s-root", "", {}).reads).toBe(1);
    expect(probe("/workspace/office/session/s-root", "", { sessionDirectory: () => "/prax" })).toEqual({ expanded: false, reads: 0, lookups: 0 });
    // Chat bez priečinka nič nerozbalí.
    expect(probe("/workspace/office/session/s-x", "", { sessionDirectory: () => null })).toEqual({ expanded: false, reads: 0, lookups: 0 });
  });

  test("chat v priečinku klienta v kancelárii (aj jeho podpriečinku mimo vecí) rozbalí klienta a načíta jeho chaty", () => {
    expect(probe("/workspace/office/session/s-x", "", { sessionDirectory: () => "/prax/AK/T/Tatran/Korešpondencia" })).toEqual({ expanded: true, reads: 1, lookups: 0 });
    expect(directoryFocus("/prax/AK/T/Tatran", { matters: [], clients: [{ key: "path:Tatran", folder: comparable("/prax/AK/T/Tatran") }] }, "/prax")).toEqual({ client: "path:Tatran" });
    // Klient, ktorého priečinok je projekt sám (registrovaný klient): chat je v natívnych Chatoch, nič sa nerozbalí.
    expect(directoryFocus("/prax/Tatran", { matters: [], clients: [{ key: "client:Tatran", folder: comparable("/prax/Tatran") }] }, "/prax/Tatran")).toEqual({});
  });

  test("chat vo veci (aj rozvetvený, ešte v zozname projektu) rozbalí svoju vec podľa priečinka, nie podľa zoznamu", () => {
    const dir = "/prax/AK/T/Tatran/Uhrada/Podania".normalize("NFD");
    expect(probe("/workspace/office/session/s-m", "", { sessionDirectory: () => dir })).toEqual({ expanded: true, reads: 1, lookups: 0 });
  });

  test("chat, ktorý panel nepozná (filtrovaný, za limitom): prečíta sa jeden chat, nie podstrom klienta", () => {
    expect(probe("/workspace/office/session/s-old", "", { sessionDirectory: () => undefined })).toEqual({ expanded: false, reads: 0, lookups: 1 });
  });

  test("priečinok chatu zo živého zoznamu: len chat v skupine svojho projektu s priečinkom; wiki zoznam nemení projekty", () => {
    const groups: WorkspaceSessionGroup[] = [
      { workspace: office, status: "ready", sessions: [{ id: "a", title: "A", directory: "/prax" }, { id: "b", title: "B", directory: null }] },
    ];
    const directory = liveSessionDirectories(groups);
    expect(directory("office", "a")).toBe("/prax");
    expect(directory("office", "b")).toBeUndefined();
    expect(directory("ine", "a")).toBeUndefined();
    const wiki: WorkspaceSessionGroup[] = [{ workspace: { ...ws("w", "/wiki"), preset: "wiki" }, status: "ready", sessions: [] }];
    expect(liveProjectGroups(wiki, groups)).toBe(groups);
    expect(liveProjectGroups([...groups, ...wiki], undefined)).toEqual(groups);
    expect(liveProjectGroups(undefined, groups)).toBe(groups);
    expect(liveProjectGroups([], groups)).toEqual([]);
  });

  test("zatvorené Prípady: klient sa nečíta ani pri detaile jeho veci", () => {
    const search = `?vec=${encodeURIComponent(m1.path)}`;
    expect(probe("/vec", search, {})).toEqual({ expanded: true, reads: 1 });
    expect(probe("/vec", search, { closedFor: () => new Set(["path:Tatran"]) })).toEqual({ expanded: false, reads: 0 });
  });

  test("zoznam projektov panela nahradí zoznam z načítania (registrácia a odobratie hneď)", () => {
    const loaded = { ...connection, workspaces: [office] };
    const fresh = [office, ws("novy", "/prax/Novy")];
    expect(liveConnection(loaded, fresh, "novy")).toEqual({ ...loaded, workspaces: fresh, activeWorkspaceId: "novy" });
    expect(liveConnection(loaded, fresh, "zmazany")?.activeWorkspaceId).toBe("office");
    expect(liveConnection(loaded, undefined)).toBe(loaded);
    expect(liveConnection(null, fresh)).toBeNull();
  });
});

/** Trvalé obchody (zustand persist), ktoré AppSidebar načíta; každý si úložisko zachytí pri prvom importe. */
const PERSISTED_STORES = [
  "../src/react-app/domains/session/sidebar/session-inbox-store",
  "../src/react-app/domains/session/sidebar/session-management-store",
  "../src/react-app/domains/workspace/project-favorites-store",
  "../src/react-app/domains/workspace/project-defaults-store",
  "../src/react-app/domains/workspace/project-filters",
  "../src/react-app/domains/session/panel/panel-tab-store",
  "../src/react-app/domains/session/fusion/fusion-store",
  "../src/react-app/domains/session/artifacts/document-preferences",
  "../src/react-app/domains/tasks/task-filter-store",
  "../src/react-app/domains/tasks/task-notification-preferences",
  "../src/react-app/domains/tasks/task-run-store",
  "../src/react-app/domains/views/view-generation",
  "../src/react-app/kernel/notification-store",
  "../src/lawoss/experiments/store",
];
type JsonStorage = ReturnType<typeof createJSONStorage>;
type PersistApi = {
  getState: () => unknown;
  setState: (state: unknown, replace: true) => void;
  persist: { setOptions: (options: { storage: JsonStorage }) => void; getOptions: () => { storage?: JsonStorage } };
};
const isPersisted = (value: unknown): value is PersistApi =>
  typeof value === "function" && "persist" in value && typeof value.persist === "object" && value.persist !== null
  && "setOptions" in value.persist && "getOptions" in value.persist && "getState" in value && "setState" in value;

const mapStorage = (own: Map<string, string>): Storage => ({
  get length() { return own.size; },
  key: (index) => [...own.keys()][index] ?? null,
  clear: () => own.clear(),
  getItem: (key) => own.get(key) ?? null,
  setItem: (key, value) => { own.set(key, value); },
  removeItem: (key) => { own.delete(key); },
});

/**
 * AppSidebar v spoločnom procese bun testov (oprava po review, kolo 3):
 * - Pred importom jedno úplné úložisko na `globalThis` aj `window`; po importe (synchrónne vo `finally`, bez
 *   ďalších awaitov, aby sa chyba importu nezamaskovala) sa oba deskriptory vrátia.
 * - Úložisko z času importu je pôvodný adaptér trvalých obchodov. Siaha po práve nainštalovanom `localStorage`
 *   (ako by ho zachytil import v neskoršom súbore, napr. session-inbox.test.ts), inak po vlastnej mape.
 * - Počas testov majú obchody súkromnú mapu testu; po testoch dostane každý späť svoj pôvodný adaptér a stav.
 */
async function importSidebar() {
  const fallback = mapStorage(new Map());
  const importTime: Storage = {
    get length() { return current().length; },
    key: (index) => current().key(index),
    clear: () => current().clear(),
    getItem: (key) => current().getItem(key),
    setItem: (key, value) => current().setItem(key, value),
    removeItem: (key) => current().removeItem(key),
  };
  const isStorage = (value: unknown): value is Storage => typeof value === "object" && value !== null && value !== importTime && "getItem" in value && "setItem" in value && "removeItem" in value;
  function current(): Storage {
    const value: unknown = Object.getOwnPropertyDescriptor(globalThis, "localStorage")?.value;
    return isStorage(value) ? value : fallback;
  }
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: importTime });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: importTime, addEventListener: () => {}, removeEventListener: () => {} } });
  let modules: [typeof import("../src/react-app/domains/session/sidebar/app-sidebar"), typeof import("../src/react-app/domains/workspace/project-personalisation-modal"), typeof import("../src/react-app/domains/workspace/project-favorites-store")];
  let storeModules: Record<string, unknown>[];
  try {
    modules = await Promise.all([
      import("../src/react-app/domains/session/sidebar/app-sidebar"),
      import("../src/react-app/domains/workspace/project-personalisation-modal"),
      import("../src/react-app/domains/workspace/project-favorites-store"),
    ]);
    // Aj obchody, ktoré AppSidebar sám nenačíta, vzniknú s úložiskom (bez neho by nemali ani persist API).
    storeModules = await Promise.all(PERSISTED_STORES.map((path) => import(path)));
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
  const stores = storeModules.flatMap((module) => Object.values(module).filter(isPersisted));
  const testStorage = createJSONStorage(() => mapStorage(new Map()));
  const originals = stores.map((store) => ({ store, storage: store.persist.getOptions().storage, state: store.getState() }));
  for (const store of stores) store.persist.setOptions({ storage: testStorage });
  afterAll(() => {
    for (const { store, storage, state } of originals) {
      if (storage) store.persist.setOptions({ storage });
      store.setState(state, true);
    }
  });
  const [{ AppSidebar }, { ProjectPersonalisationProvider }, { useProjectFavoritesStore }] = modules;
  return { AppSidebar, ProjectPersonalisationProvider, useProjectFavoritesStore };
}
const { AppSidebar, ProjectPersonalisationProvider, useProjectFavoritesStore } = await importSidebar();

describe("bočný panel (natívny AppSidebar, vykreslený)", () => {
  const noop = () => {};
  const group = (w: RouteWorkspace): WorkspaceSessionGroup => ({ workspace: w, sessions: [], status: "ready" });
  const sidebar = (value: TestValue, groups: WorkspaceSessionGroup[]) => renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}><TooltipProvider><ShellConfigProvider><MemoryRouter>
      <ProjectPersonalisationProvider groups={groups} client={null}><SidebarProvider><ClientNavTestProvider value={value}>
        <AppSidebar accountClient={null} workspaceSessionGroups={groups} selectedWorkspaceId="" selectedSessionId={null}
          developerMode={false} connectingWorkspaceId={null} workspaceConnectionStateById={{}} newChatDisabled={false}
          onOpenProjectFiles={noop} onSelectWorkspace={noop} onOpenSession={noop}
          onCreateChatInWorkspace={noop} onOpenRenameWorkspace={noop} onRevealWorkspace={noop} onForgetWorkspace={noop}
          onOpenCreateWorkspace={noop} onCreateChatInNewWorkspace={noop} />
      </ClientNavTestProvider></SidebarProvider></ProjectPersonalisationProvider>
    </MemoryRouter></ShellConfigProvider></TooltipProvider></QueryClientProvider>,
  );

  test("hore Dnes · natívny Nový chat · Pridať klienta; starý strom, Opýtať sa ani Klienti a prípady v navigácii nie sú", () => {
    const out = sidebar(navValue(mixed, []), [group(tatranWs)]);
    const today = out.indexOf('data-lawoss-lite-nav="today"');
    const chat = out.indexOf(`<span>${t("projects.new_chat", "en")}</span>`);
    const add = out.indexOf('data-lawoss-lite-nav="add_client"');
    expect(today).toBeGreaterThan(-1);
    expect(chat).toBeGreaterThan(today);
    expect(add).toBeGreaterThan(chat);
    expect(out).toMatch(new RegExp(`<a(?=[^>]*href="${NEW_CLIENT_PATH.replace(/[?]/g, "\\?")}")(?=[^>]*data-lawoss-lite-nav="add_client")[^>]*>`));
    for (const gone of ["data-lawoss-lite-tree", 'data-lawoss-lite-nav="ask"', 'data-lawoss-lite-nav="clients"']) expect(out).not.toContain(gone);
  });

  test("sekcia klientov: skrytý koreň nie je v zozname ani medzi pripnutými; hlavička má texty LAWOSS, + v Pokročilom ostáva natívny", () => {
    useProjectFavoritesStore.setState({ favoriteIds: ["root"] });
    try {
      const hidden = { ...mixed, hidden: new Set(["root", "legacy"]) };
      const out = sidebar(navValue(hidden, []), [group(root), group(tatranWs), group(legacy)]);
      expect(out).toContain(">tatran<");
      expect(out).not.toContain(">root<");
      expect(out).not.toContain(">legacy<");
      expect(out).not.toContain("Pinned Projects");
      expect(out).toContain('aria-label="Clients and cases"');
      // SSR je vždy Pokročilý režim: „+“ ostáva natívne vytvorenie projektu (bežný režim vedie na Pridať klienta).
      expect(out).toContain('aria-label="Create client"');
    } finally { useProjectFavoritesStore.setState({ favoriteIds: [] }); }
  });

  test("B3: klient so slugom priečinka má v hlavičke názov z karty, priečinok v bublinke, lehotu a kontext chatu", () => {
    const slug = "C001-syn-tatran-automatika-s-r-o", card = "SYN Tatran Automatika, s. r. o.";
    const client = ws(slug, `/prax/Klienti/${slug}`);
    const m = { ...matter(`Klienti/${slug}/Spisy/Uhrada`, "Úhrada dodávok"), deadlines: [deadline("2099-01-15")] };
    const groups: ClientGroup[] = [{ key: `client:Klienti/${slug}`, client: card, matters: [m] }];
    const scope: OkfScope = { anchor: client, members: [{ workspace: client, prefix: `Klienti/${slug}` }], practiceRoot: "/prax" };
    const model = clientNavModel([client], "/prax", readyOverview(scope, groups));
    const upcoming = m.deadlines.map((d) => ({ ...d, matter: { path: m.path, title: m.title } }));
    const data: OkfReadResult = { matters: [m], upcomingDeadlines: upcoming, overdue: [], totals: { matters: 1, deadlinesWithin7Days: 0, openTasks: 0, overdue: 0, records: 1 },
      problems: [], truncated: false, inputs: [], clients: [{ path: `Klienti/${slug}`, title: card }],
      coverage: { status: "complete", scopeKey: "k", sources: [{ source: "workspace", workspaceId: slug, checkedAt: 1, lastSuccessAt: 1, state: "fresh" }] } };
    const session = { id: "s1", title: "Návrh odpovede", directory: `/prax/Klienti/${slug}/Spisy/Uhrada`, time: { created: 1, updated: 2 } };
    const rows = buildClientRows({ workspaces: [client], scope, data, groups, model, excludedWorkspaceIds: [], rootCards: new Map(), todayIso: "2026-10-22" });
    const out = sidebar(navValue(model, [], { scope, data, groups, rows }), [{ workspace: client, sessions: [session], status: "ready" } as WorkspaceSessionGroup]);
    expect(out).toMatch(new RegExp(`title="Folder: /prax/Klienti/${slug}\\nDeadline [^"]+" data-lawoss-row-label="" data-lawoss-native-name="${slug}">${card}</span>`));
    expect(out).toMatch(/<span class="min-w-0 truncate" data-lawoss-row-code="">C001<\/span>/);
    expect(out).not.toContain(`>${slug}<`);
    expect(out).toMatch(/data-lawoss-row-status=""[^>]*>Deadline /);
    expect(out).toContain(`>${card} · Úhrada dodávok</span>`);
  });

  test("bežný režim: + vedie na Pridať klienta (vetva podľa režimu)", () => {
    // SSR nevie vykresliť bežný režim (snapshot režimu je vždy Pokročilý); vetva je v zdrojovom kóde.
    const sidebarSource = source("react-app/domains/session/sidebar/app-sidebar.tsx");
    expect(sidebarSource).toMatch(/uiMode === "lite"\s*\?\s*<Button[^>]*aria-label=\{t\("lawoss\.lite\.add_client"\)\}[^>]*onClick=\{\(\) => navigate\(NEW_CLIENT_PATH\)\}/);
  });
});

describe("pripnuté a nedávne chaty v bežnom režime: predvolene vypnuté, prepínač funguje", () => {
  test("bežný režim: vypnuté, kým ich používateľ nezapne; Pokročilý a ostatné sekcie podľa natívnej voľby", () => {
    for (const key of ["sectionPinned", "sectionRecent"]) {
      expect(chatSectionShown(key, "lite", true, {})).toBe(false);
      expect(chatSectionShown(key, "lite", false, { [key]: true })).toBe(true);
      expect(chatSectionShown(key, "pro", true, { [key]: false })).toBe(true);
    }
    expect(chatSectionShown("sectionProjects", "lite", true, {})).toBe(true);
    expect(chatSectionShown("sectionProjects", "lite", false, {})).toBe(false);
  });

  test("voľba bežného režimu sa uloží zvlášť a prežije znovunačítanie", () => {
    const store = new Map<string, string>();
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } });
    try {
      setLiteChatSection("sectionRecent", true);
      expect(JSON.parse(store.get(LITE_CHAT_SECTIONS_KEY) ?? "{}")).toMatchObject({ sectionRecent: true });
      reloadLiteChatSections();
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else Reflect.deleteProperty(globalThis, "localStorage");
      reloadLiteChatSections();
    }
    // Prispôsobenie panela pri týchto sekciách v bežnom režime číta a zapisuje túto voľbu.
    expect(source("react-app/domains/session/sidebar/sidebar-customization.tsx")).toContain("chatSections.handles(key) ? chatSections.set(key, checked)");
  });
});

describe("Nový chat v bežnom režime bez otvoreného projektu", () => {
  const a = { ...ws("a", "/prax/A"), displayNameResolved: "ALFA" };
  const b = { ...ws("b", "/prax/B"), displayNameResolved: "BETA" };
  test("viac klientov = výber, jeden = rovno on, nikdy koreň praxe; Pokročilý a bez klientov natívne", () => {
    const model = { clients: new Set(["root", "a", "b"]), hidden: new Set<string>(), practiceRootId: "root" };
    expect(newChatChoices([root, b, a], model).map((c) => c.id)).toEqual(["a", "b"]);
    expect(newChatAction("lite", newChatChoices([root, b, a], model))).toEqual({ kind: "pick" });
    const [onlyA] = newChatChoices([root, a], { ...model, clients: new Set(["root", "a"]) });
    expect(newChatAction("lite", [onlyA])).toEqual({ kind: "create", target: { id: "a", workspaceId: "a", root: "/prax/A", title: "ALFA" } });
    expect(newChatAction("pro", newChatChoices([a, b], model))).toEqual({ kind: "native" });
    expect(newChatAction("lite", [])).toEqual({ kind: "native" });
  });

  test("jeden priečinok pre všetko: výber z klientov v koreni, chat v priečinku klienta, nikdy nad koreňom", () => {
    const model = { clients: new Set(["root"]), hidden: new Set<string>(), practiceRootId: "root" };
    const inRoot = [{ key: "client:Klienti/Hron", title: "Hron", folder: "/prax/Klienti/Hron" }, { key: "client:Klienti/Novak", title: "Novák", folder: "/prax/Klienti/Novak" }];
    const choices = newChatChoices([root], model, inRoot);
    expect(choices.map((c) => [c.title, c.workspaceId, c.folder])).toEqual([["Hron", "root", "/prax/Klienti/Hron"], ["Novák", "root", "/prax/Klienti/Novak"]]);
    expect(choices.some((c) => c.folder === undefined)).toBe(false);
    expect(newChatAction("lite", choices)).toEqual({ kind: "pick" });
    expect(newChatAction("lite", newChatChoices([root], model, inRoot.slice(0, 1)))).toEqual({ kind: "create", target: expect.objectContaining({ workspaceId: "root", folder: "/prax/Klienti/Hron" }) });
    // Koreň s registrovaným klientom: registrovaný ako projekt, neregistrovaní v koreni s priečinkom.
    const mixedChoices = newChatChoices([root, tatranWs], { clients: new Set(["root", "tatran"]), hidden: new Set<string>(), practiceRootId: "root" }, inRoot.slice(1));
    expect(mixedChoices.map((c) => [c.workspaceId, c.folder ?? null])).toEqual([["root", "/prax/Klienti/Novak"], ["tatran", null]]);
    // Priečinok klienta v koreni z prehľadu: v pôvodnom tvare pre engine (nie porovnávací).
    expect(clientGroupDirectory(rootScope, mixedGroups[1])).toBe("/prax/Klienti/Novak");
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
    // Pripojené priečinky (lawoss-linked-folders.test.tsx) idú za Lehoty.
    expect(readConfig({ projectNavOrder: old }).projectNavOrder).toEqual(["projectHome", "projectMatters", "projectDeadlines", "projectLinkedFolders", ...old.slice(1)]);
    const custom = ["projectFiles", "projectHome", "projectSessions"];
    expect(readConfig({ projectNavOrder: custom }).projectNavOrder.slice(0, 6)).toEqual(["projectFiles", "projectHome", "projectMatters", "projectDeadlines", "projectLinkedFolders", "projectSessions"]);
    const moved = ["projectDeadlines", "projectHome", "projectSessions", "projectMatters"];
    const kept = readConfig({ projectNavOrder: moved, projectMatters: false });
    expect(kept.projectNavOrder.filter((key) => key !== "projectLinkedFolders").slice(0, 4)).toEqual(moved);
    expect(kept.projectMatters).toBe(false);
  });

  test("prispôsobenie ich ponúkne s preloženým názvom vo všetkých jazykoch", () => {
    for (const key of ["projectMatters", "projectDeadlines"] as const) {
      const label = SIDEBAR_ITEMS[key].label;
      for (const locale of ["sk", "cs", "en", "de"] satisfies Language[]) expect(t(label, locale)).not.toBe(label);
    }
    expect(t(SIDEBAR_ITEMS.projectMatters.label, "sk")).toBe("Prípady");
    expect(t(SIDEBAR_ITEMS.projectDeadlines.label, "sk")).toBe("Lehoty");
  });
});

describe("Prípady klienta: zobrazenie", () => {
  const UHRADA = matter("Tatran/Spisy/Uhrada", "Úhrada dodávok", ["2026-10-21"]);
  const VADY = matter("Tatran/Spisy/Vady", "Vady rekonštrukcie");
  const ZMLUVA = matter("Hron/Spisy/Zmluva", "Zmluva o dielo", ["2026-11-30"]);
  const groups: ClientGroup[] = [
    { key: "client:Hron", client: "SYN Hron Technológie", matters: [ZMLUVA] },
    { key: "client:Tatran", client: "SYN Tatran Automatika", matters: [UHRADA, VADY] },
  ];
  const chats = [{ workspaceId: "tatran", id: "s-1", title: "Zhrnutie spisu", updated: 2 }, { workspaceId: "tatran", id: "s-2", title: "Návrh odpovede", updated: 1 }];
  const tree = (focus = {}, overrides = {}) => buildClientTree({ groups: [groups[1]], focus, overrides, canStart: () => true,
    lists: { client: () => ready(), matter: (path) => ready(path === UHRADA.path ? chats : []) } });

  test("Prípady zbalené: žiadna vec; rozbalené: veci klienta s odkazom na prehľad veci", () => {
    const closed = html(<ClientMattersView nodes={tree()} open={false} locale="en" />);
    expect(closed).toContain("Cases");
    expect(closed).toMatch(/<button(?=[^>]*data-lawoss-project-matters="")(?=[^>]*aria-expanded="false")[^>]*>/);
    expect(closed).not.toContain("Úhrada dodávok");
    const open = html(<ClientMattersView nodes={tree({}, { [clientToggle("client:Tatran")]: true })} open locale="en" />);
    expect(open).toContain("Úhrada dodávok");
    expect(open).toContain("Vady rekonštrukcie");
    expect(open).toContain(`href="${liteMatterLink(UHRADA.path)}"`);
    expect(open).not.toContain("Zhrnutie spisu");
  });

  test("vec rozbalí svoje chaty a + Nový chat; otvorená vec je označená", () => {
    const out = html(<ClientMattersView nodes={tree({ matter: UHRADA.path })} open locale="en" />, liteMatterLink(UHRADA.path));
    expect(out).toContain("Zhrnutie spisu");
    expect(out).toContain("Návrh odpovede");
    expect(out.match(/data-lawoss-tree-new/g)).toHaveLength(1);
    expect(out).toContain("New chat");
    expect(out).toMatch(/<a(?=[^>]*aria-current="page")[^>]*href="\/vec\?vec=Tatran%2FSpisy%2FUhrada"/);
  });

  test("jeden priečinok pre všetko: viac klientov pod jedným projektom, každý so svojím menom", () => {
    const both = buildClientTree({ groups, focus: { matter: UHRADA.path }, overrides: {}, canStart: () => true, lists: { client: () => ready(), matter: () => ready() } });
    const out = html(<ClientMattersView nodes={both} open locale="en" />);
    expect(out).toContain("SYN Hron Technológie");
    expect(out).toContain("SYN Tatran Automatika");
    expect(out).toContain("Úhrada dodávok");
    expect(out).not.toContain("Zmluva o dielo");
  });

  test("Lehoty klienta: len lehoty vecí, ktoré projekt vlastní; súčty znova", () => {
    const tatran = ws("tatran", "/prax/Tatran");
    const hron = ws("hron", "/prax/Hron");
    const practice: OkfScope = { anchor: tatran, members: [{ workspace: hron, prefix: "Hron" }, { workspace: tatran, prefix: "Tatran" }], practiceRoot: "/prax" };
    const data = { matters: [UHRADA, VADY, ZMLUVA], inputs: [], clients: [], problems: [], truncated: false,
      upcomingDeadlines: [UHRADA, ZMLUVA].flatMap((m) => m.deadlines.map((d) => ({ ...d, matter: { path: m.path, title: m.title } }))),
      overdue: [], totals: { matters: 3, deadlinesWithin7Days: 1, openTasks: 0, overdue: 0, records: 3 } } satisfies OkfReadResult;
    const model = clientNavModel([tatran, hron], "/prax", readyOverview(practice, groups));
    const owns = (id: string) => (folder: string) => ownerOfFolder(model.visible, folder) === id;
    const own = clientDeadlines(data, practice, owns("tatran"), "2026-10-19");
    expect(own.matters.map((m) => m.path)).toEqual([UHRADA.path, VADY.path]);
    expect(own.upcomingDeadlines.map((d) => d.matter.path)).toEqual([UHRADA.path]);
    expect(own.totals.matters).toBe(2);
    expect(own.totals.deadlinesWithin7Days).toBe(1);
    expect(clientDeadlines(data, practice, owns("hron"), "2026-10-19").totals.deadlinesWithin7Days).toBe(0);
    expect(clientDeadlinesLink("ws tatran")).toBe("/lehoty?klient=ws%20tatran");
  });
});

describe("Domov klienta: natívny ProjectHome s prehľadom OKF", () => {
  test("ProjectHome má jeden voliteľný slot a stránka doň dáva prehľad klienta", () => {
    const home = source("react-app/domains/workspace/project-home.tsx");
    expect(home).toContain("extra?: ReactNode;");
    expect(home).toContain("{props.extra}");
    expect(source("react-app/domains/session/chat/session-page.tsx")).toContain("extra={<ClientOverview workspaceId={props.selectedWorkspaceId} />}");
  });

  test("prehľad ukáže prípady, súčet lehôt do 7 dní z registra, najbližšie lehoty a odkaz na všetky lehoty klienta", () => {
    const UHRADA = matter("Tatran/Spisy/Uhrada", "Úhrada dodávok", ["2026-10-21"]);
    const out = renderToStaticMarkup(<MemoryRouter><ClientOverviewView workspaceId="tatran" locale="en" todayIso="2026-10-19" soon={7}
      matters={[UHRADA, matter("Tatran/Spisy/Vady", "Vady rekonštrukcie")]}
      deadlines={UHRADA.deadlines.map((d) => ({ ...d, matter: { path: UHRADA.path, title: UHRADA.title } }))} /></MemoryRouter>);
    expect(out).toContain("data-lawoss-client-overview");
    expect(out).toContain("Úhrada dodávok");
    expect(out).toContain("Vady rekonštrukcie");
    expect(out).toContain(`href="${liteMatterLink(UHRADA.path)}"`);
    expect(out).toContain("Lehota 2026-10-21");
    expect(out).toMatch(/Deadlines within 7 days<\/dt><dd[^>]*>7</);
    expect(out).toContain(`href="${clientDeadlinesLink("tatran")}"`);
  });

  test("texty: nové kľúče vo všetkých jazykoch, žiadne skladanie kľúča za behu, nemčina bez dlhej pomlčky", () => {
    for (const dict of [shellEn, shellCs, shellSk, shellDe]) {
      for (const key of ["project_matters", "project_matters_empty", "matter_new_chat", "client_overview_title", "client_overview_deadlines", "client_overview_no_deadlines", "client_deadlines_all", "client_deadlines_title"]) {
        expect(dict).toHaveProperty([`lawoss.lite.${key}`]);
      }
    }
    expect(shellSk["lawoss.lite.matter_new_chat"]).toBe("Nový chat");
    expect(source("lawoss/lite/client-overview.tsx")).not.toContain("`lawoss.lite.${");
    expect(Object.values(shellDe).some((value) => value.includes("—"))).toBe(false);
  });
});

describe("kolo 3: chat v kancelárii, chyba spojenia, chaty klienta", () => {
  const inRoot = [{ key: "client:Klienti/Hron", title: "Hron", folder: "/prax/Klienti/Hron" }, { key: "client:Klienti/Novak", title: "Novák", folder: "/prax/Klienti/Novak" }];
  const rootModel = { clients: new Set(["root"]), hidden: new Set<string>(), practiceRootId: "root" };
  const targets = newChatChoices([root], rootModel, inRoot);

  test("Nový chat v otvorenom koreni kancelárie: klient z kontextu trasy, inak výber; obyčajný projekt a Pokročilý natívne", () => {
    expect(projectNewChatAction("lite", "root", "root", targets, "client:Klienti/Novak")).toEqual({ kind: "create", target: expect.objectContaining({ workspaceId: "root", folder: "/prax/Klienti/Novak" }) });
    expect(projectNewChatAction("lite", "root", "root", targets)).toEqual({ kind: "pick" });
    expect(projectNewChatAction("lite", "root", "root", targets, "client:Iny")).toEqual({ kind: "pick" });
    expect(projectNewChatAction("lite", "root", "root", targets.slice(0, 1))).toEqual({ kind: "create", target: expect.objectContaining({ folder: "/prax/Klienti/Hron" }) });
    expect(projectNewChatAction("lite", "tatran", "root", targets, "client:Klienti/Novak")).toBeNull();
    expect(projectNewChatAction("pro", "root", "root", targets, "client:Klienti/Novak")).toBeNull();
    expect(projectNewChatAction("lite", "root", "root", [], "client:Klienti/Novak")).toBeNull();
    // Panel sa opýta LAWOSS skôr, než natívne založí chat v otvorenom projekte.
    expect(source("react-app/domains/session/sidebar/app-sidebar.tsx")).toMatch(/if \(lawossNewChat\(openProjectId \|\| null, props\.onCreateChatInWorkspace\)\) return;\s*if \(openProjectId\) props\.onCreateChatInWorkspace\(openProjectId\);/);
  });

  test("priečinok pre chat klienta nikdy nie je koreň ani vec", () => {
    expect(clientGroupDirectory(rootScope, { key: "matter:Spis", matters: [matter("Spis", "Spis")] })).toBeNull();
    expect(clientGroupDirectory(rootScope, { key: "client:", matters: [] })).toBeNull();
    expect(isClientFolderOf("/prax", "/prax/Klienti/Hron")).toBe(true);
    expect(isClientFolderOf("/prax", "/prax")).toBe(false);
    expect(isClientFolderOf("/prax", "/prax/")).toBe(false);
    expect(isClientFolderOf("/prax", "/ine/Hron")).toBe(false);
  });

  test("spojenie zlyhalo: bez praxe, nič sa neskrýva natrvalo; kým sa číta, prax je neznáma", () => {
    const loaded = { client: null, baseUrl: "", token: "", workspaces: [], activeWorkspaceId: "" };
    expect(practiceRootState(null, "Server nebeží", undefined)).toBeNull();
    expect(practiceRootState(null, null, undefined)).toBeUndefined();
    expect(practiceRootState(loaded, null, "/prax")).toBe("/prax");
    expect([...clientNavModel([root, tatranWs, legacy], practiceRootState(null, "Server nebeží", undefined), { status: "unavailable" }).hidden]).toEqual([]);
  });

  test("prax známa a prehľad sa číta: kandidáti len pod koreňom praxe, nesúvisiace vnorené projekty ostanú", () => {
    const outer = ws("outer", "/ine");
    const inner = ws("inner", "/ine/Pod");
    expect([...clientNavModel([root, tatranWs, outer, inner], "/prax", { status: "pending" }).hidden].sort()).toEqual(["root", "tatran"]);
  });

  test("klient v koreni kancelárie: jeho vlastné chaty pod ním (5 + Zobraziť všetky), otvorený chat označený; registrovaný klient nie", () => {
    const chats = Array.from({ length: 6 }, (_, i) => ({ workspaceId: "root", id: `k${i}`, title: `Chat klienta ${i}`, updated: 100 - i }));
    const nodes = buildClientTree({ groups: mixedGroups, focus: { client: "client:Klienti/Novak" }, overrides: {}, canStart: () => true,
      lists: { client: (key) => ready(key === "client:Klienti/Novak" ? chats : []), matter: () => ready() } });
    const own = (projectNodes(nodes, mixed, "root") ?? []);
    expect([...clientChatKeys(rootScope, mixedGroups, own, "/prax")].sort()).toEqual(["client:Klienti/Hron", "client:Klienti/Novak"]);
    expect([...clientChatKeys(rootScope, mixedGroups, projectNodes(nodes, mixed, "tatran") ?? [], "/prax/Klienti/Tatran")]).toEqual([]);
    const out = html(<ClientMattersView nodes={own} open locale="en" clientChats={clientChatKeys(rootScope, mixedGroups, own, "/prax")} />, "/workspace/root/session/k1");
    expect(out.match(/data-lawoss-tree-conversation=/g)).toHaveLength(5);
    expect(out).toMatch(/<button(?=[^>]*aria-current="page")(?=[^>]*data-lawoss-tree-conversation="k1")[^>]*>/);
    expect(out).toContain(`href="/klienti?klient=${encodeURIComponent("client:Klienti/Novak")}"`);
    expect(out.indexOf("Chat klienta 0")).toBeLessThan(out.indexOf("Dedičstvo"));
    // Bez príznaku (registrovaný klient, chaty v natívnych Chatoch) sa chaty klienta neukážu.
    expect(html(<ClientMattersView nodes={own} open locale="en" />)).not.toContain("Chat klienta 0");
  });
});
