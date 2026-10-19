// Strom klientov, vecí a rozhovorov v bočnom paneli (variant A, MČ 19. 10. 2026).
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { shellCs, shellDe, shellEn, shellSk } from "../src/lawoss/i18n/shell";
import { LiteNav, LiteNavView } from "../src/lawoss/lite/lite-nav";
import { buildClientTree, clientToggle, matterToggle, routeFocus, sessionFocus, workspacesToFetch, TREE_CONVERSATION_LIMIT } from "../src/lawoss/lite/client-tree";
import { conversationsInDirectory, listMatterConversations, matterDirectory } from "../src/lawoss/lite/matter-conversations";
import { clientOverviewLink, LITE_CLIENTS_PATH, liteMatterLink } from "../src/lawoss/lite/links";
import { ClientsView } from "../src/lawoss/lite/pages/clients-page";
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
const sessions = [
  { id: "s-zhrnutie", title: "Zhrnutie spisu", directory: "/prax/Tatran/Spisy/Uhrada", time: { created: 1, updated: Date.UTC(2026, 9, 19, 9) } },
  { id: "s-navrh", title: "Návrh odpovede", directory: "/prax/Tatran/Spisy/Uhrada", time: { created: 1, updated: Date.UTC(2026, 9, 18, 9) } },
  { id: "s-bez", title: "New session - 2026-10-17T10:00:00Z", directory: "/prax/Tatran/Spisy/Uhrada", time: { created: 1, updated: Date.UTC(2026, 9, 17, 9) } },
  { id: "s-klient", title: "Otázka ku klientovi", directory: "/prax/Tatran", time: { created: 1, updated: Date.UTC(2026, 9, 16, 9) } },
  { id: "s-vady", title: "Vady - posudok", directory: "/prax/Tatran/Spisy/Vady", time: { created: 1, updated: Date.UTC(2026, 9, 15, 9) } },
];
const lists = [{ workspaceId: tatran.id, items: sessions }];
const locate = (path: string) => path.startsWith("Tatran/") ? { workspace: tatran, path: path.slice("Tatran/".length) }
  : path.startsWith("Hron/") ? { workspace: hron, path: path.slice("Hron/".length) } : null;
const conversationsOf = (path: string) => {
  const at = locate(path);
  return at ? conversationsInDirectory(lists, matterDirectory(at.workspace, at.path)) : [];
};

const render = (node: ReactElement, entry = "/dnes") => renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={[entry]}><SidebarProvider>{node}</SidebarProvider></MemoryRouter>
  </QueryClientProvider>,
);
const tree = (focus = {}, overrides = {}) => buildClientTree({ groups, focus, overrides, conversations: conversationsOf, canStart: (path) => locate(path) !== null });

describe("strom klientov: rozbalenie", () => {
  test("bez aktuálneho klienta sú všetci klienti zbalení a veci nie sú vidieť", () => {
    const out = render(<LiteNavView tree={tree()} />);
    expect(out).toContain("SYN Tatran Automatika");
    expect(out).toContain("SYN Hron Technológie");
    expect(out).toContain(`href="${clientOverviewLink("client:Tatran").replace(/&/g, "&amp;")}"`);
    expect(out).not.toContain("Úhrada dodávok");
    expect(out.match(/aria-expanded="false"/g)).toHaveLength(2);
    expect(out).not.toContain('aria-expanded="true"');
  });

  test("detail veci rozbalí jej klienta aj vec; ostatní ostanú zbalení", () => {
    const focus = routeFocus("/vec", `?vec=${encodeURIComponent(UHRADA.path)}`);
    expect(focus).toEqual({ matter: UHRADA.path });
    const built = tree(focus);
    expect(built.map((c) => [c.key, c.expanded, c.current])).toEqual([["client:Tatran", true, true], ["client:Hron", false, false]]);
    expect(built[0].matters.map((m) => [m.path, m.expanded, m.current])).toEqual([[UHRADA.path, true, true], [VADY.path, false, false]]);
    const out = render(<LiteNavView tree={built} />, liteMatterLink(UHRADA.path));
    expect(out).toContain("Úhrada dodávok");
    expect(out).toContain("Vady rekonštrukcie");
    expect(out).not.toContain("Zmluva o dielo");
    expect(out).toMatch(/<a(?=[^>]*aria-current="page")[^>]*href="\/vec\?vec=Tatran%2FSpisy%2FUhrada"/);
  });

  test("prehľad klienta (Klienti ?klient=) rozbalí len klienta", () => {
    const focus = routeFocus(LITE_CLIENTS_PATH, `?klient=${encodeURIComponent("client:Hron")}`);
    expect(focus).toEqual({ client: "client:Hron" });
    const built = tree(focus);
    expect(built.map((c) => c.expanded)).toEqual([false, true]);
    expect(built[1].matters[0].expanded).toBe(false);
  });

  test("konverzácia vo veci rozbalí vec a klienta podľa priečinka konverzácie", () => {
    const route = routeFocus("/workspace/ws-tatran/session/s-vady", "");
    expect(route).toEqual({ session: { workspaceId: "ws-tatran", sessionId: "s-vady" } });
    const matters = groups.flatMap((g) => g.matters).map((m) => ({ path: m.path, at: locate(m.path) }));
    expect(sessionFocus(route.session!, lists, matters)).toEqual({ matter: VADY.path });
    // Konverzácia nad celým klientom (priečinok klienta): rozbalí sa len klient.
    expect(sessionFocus({ workspaceId: "ws-tatran", sessionId: "s-klient" }, lists, matters, groups)).toEqual({ client: "client:Tatran" });
    // Ešte nenačítaný zoznam: nič sa nehádže.
    expect(sessionFocus({ workspaceId: "ws-hron", sessionId: "x" }, [], matters)).toEqual({});
  });

  test("používateľ zbalí aktuálnu vec alebo rozbalí iného klienta; šípka nenaviguje", () => {
    const focus = { matter: UHRADA.path };
    const built = tree(focus, { [matterToggle(UHRADA.path)]: false, [clientToggle("client:Hron")]: true });
    expect(built[0].expanded).toBe(true);
    expect(built[0].matters[0].expanded).toBe(false);
    expect(built[1].expanded).toBe(true);
    const out = render(<LiteNavView tree={built} />);
    // Šípka je samostatné tlačidlo s aria-expanded, nie odkaz.
    for (const toggle of out.match(/<button[^>]*data-lawoss-tree-toggle[^>]*>/g) ?? []) {
      expect(toggle).toMatch(/aria-expanded="(true|false)"/);
      expect(toggle).not.toContain("href");
    }
    expect(out.match(/data-lawoss-tree-toggle/g)?.length).toBe(5);
  });
});

describe("strom klientov: rozhovory veci", () => {
  test("rozbalená vec ukáže svoje rozhovory (najnovší prvý), náhradný názov s dátumom a + Nový rozhovor", () => {
    const built = tree({ matter: UHRADA.path });
    expect(built[0].matters[0].conversations.map((c) => c.id)).toEqual(["s-zhrnutie", "s-navrh", "s-bez"]);
    const out = render(<LiteNavView tree={built} />);
    expect(out).toContain("Zhrnutie spisu");
    expect(out).toContain("Návrh odpovede");
    expect(out).not.toContain("New session");
    expect(out).toContain(`Conversation ${new Intl.DateTimeFormat("en", { day: "numeric", month: "numeric" }).format(new Date(Date.UTC(2026, 9, 17, 9)))}`);
    // Rozhovor nad klientom ani nad inou vecou sem nepatrí.
    expect(out).not.toContain("Otázka ku klientovi");
    expect(out).not.toContain("Vady - posudok");
    expect(out.match(/data-lawoss-tree-new/g)).toHaveLength(1);
    expect(out).toContain("New conversation");
    expect(out).not.toContain("Show all");
  });

  test("aktuálny rozhovor je označený", () => {
    const out = render(<LiteNavView tree={tree({ matter: UHRADA.path })} />, "/workspace/ws-tatran/session/s-navrh");
    expect(out).toMatch(/<button(?=[^>]*aria-current="page")(?=[^>]*data-lawoss-tree-conversation="s-navrh")[^>]*>/);
  });

  test("vec bez rozhovorov: len + Nový rozhovor; bez priečinka klienta ani to", () => {
    const empty = buildClientTree({ groups, focus: { matter: HRON_ZMLUVA.path }, overrides: {}, conversations: conversationsOf, canStart: () => true });
    const out = render(<LiteNavView tree={empty} />);
    expect(out).toContain("Zmluva o dielo");
    expect(out.match(/data-lawoss-tree-new/g)).toHaveLength(1);
    expect(out).not.toContain("data-lawoss-tree-conversation");
    const orphan = buildClientTree({ groups, focus: { matter: HRON_ZMLUVA.path }, overrides: {}, conversations: () => [], canStart: () => false });
    expect(render(<LiteNavView tree={orphan} />)).not.toContain("data-lawoss-tree-new");
  });

  test(`najviac ${TREE_CONVERSATION_LIMIT} rozhovorov, potom Zobraziť všetky na detail veci`, () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ workspaceId: "ws-tatran", id: `s${i}`, title: `Rozhovor ${i}`, updated: 100 - i }));
    const built = buildClientTree({ groups, focus: { matter: UHRADA.path }, overrides: {}, conversations: (p) => p === UHRADA.path ? many : [], canStart: () => true });
    expect(built[0].matters[0].conversations).toHaveLength(TREE_CONVERSATION_LIMIT);
    expect(built[0].matters[0].more).toBe(true);
    const out = render(<LiteNavView tree={built} />);
    expect(out.match(/data-lawoss-tree-conversation=/g)).toHaveLength(TREE_CONVERSATION_LIMIT);
    expect(out).toMatch(new RegExp(`<a(?=[^>]*href="${liteMatterLink(UHRADA.path).replace(/[?]/g, "\\?")}")(?=[^>]*data-lawoss-tree-all)[^>]*>`));
    expect(out).toContain("Show all");
  });
});

describe("strom klientov: výkon a priečinky", () => {
  test("zoznam rozhovorov sa číta len pre priečinky rozbalených vecí a aktuálnej konverzácie (24 klientov, 72 vecí)", () => {
    const big: ClientGroup[] = Array.from({ length: 24 }, (_, c) => ({ key: `client:K${c}`, client: `Klient ${c}`, matters: Array.from({ length: 3 }, (_, m) => matter(`K${c}/Spisy/V${m}`, `Vec ${c}-${m}`)) }));
    const where = (path: string) => ({ workspace: ws(`ws-${path.split("/")[0]}`, `/prax/${path.split("/")[0]}`), path: path.split("/").slice(1).join("/") });
    const collapsed = buildClientTree({ groups: big, focus: {}, overrides: {}, conversations: () => [], canStart: () => true });
    expect(workspacesToFetch(collapsed, where)).toEqual([]);
    // Rozbalený klient bez rozbalenej veci nič nečíta - veci už sú v prehľade.
    const client = buildClientTree({ groups: big, focus: { client: "client:K3" }, overrides: {}, conversations: () => [], canStart: () => true });
    expect(workspacesToFetch(client, where)).toEqual([]);
    const one = buildClientTree({ groups: big, focus: { matter: "K3/Spisy/V1" }, overrides: { [matterToggle("K3/Spisy/V2")]: true }, conversations: () => [], canStart: () => true });
    expect(workspacesToFetch(one, where)).toEqual(["ws-K3"]);
    expect(workspacesToFetch(collapsed, where, "ws-K9")).toEqual(["ws-K9"]);
  });

  test("priečinok veci: porovnanie bez koncovej lomky; rozhovory bez priečinka sa ignorujú", () => {
    expect(matterDirectory(tatran, "Spisy/Uhrada")).toBe(matterDirectory(ws("x", "/prax/Tatran/"), "Spisy/Uhrada/"));
    expect(matterDirectory(tatran, "")).toBe(matterDirectory(tatran, "."));
    // Diakritika z disku môže byť rozložená (NFD), priečinok konverzácie zložený (NFC).
    const nfd = [{ workspaceId: "ws-tatran", items: [{ id: "u", title: "Úhrada", directory: "/prax/Tatran/Spisy/Úhrada".normalize("NFD"), time: { updated: 1 } }] }];
    expect(conversationsInDirectory(nfd, matterDirectory(tatran, "Spisy/Úhrada".normalize("NFC"))).map((c) => c.id)).toEqual(["u"]);
    const odd = [{ workspaceId: "ws-tatran", items: [{ id: "x", title: "Bez priečinka", time: { updated: 1 } }] }];
    expect(conversationsInDirectory(odd, matterDirectory(tatran, "Spisy/Uhrada"))).toEqual([]);
  });
});

describe("detail veci číta rozhovory z priečinka veci v klientovi", () => {
  test("rozhovor založený nad vecou (priečinok veci v priečinku klienta) sa ukáže aj bez registrovanej veci", async () => {
    const calls: unknown[] = [];
    const client = { listSessions: async (id: string, options: unknown) => { calls.push([id, options]); return { items: id === tatran.id ? sessions : [] }; } };
    const connection = { client, baseUrl: "", token: "", workspaces: [tatran, hron], activeWorkspaceId: tatran.id };
    const list = await listMatterConversations(connection as never, "Spisy/Uhrada", 5, tatran);
    expect(list.map((c) => [c.id, c.title, c.workspaceId])).toEqual([["s-zhrnutie", "Zhrnutie spisu", "ws-tatran"], ["s-navrh", "Návrh odpovede", "ws-tatran"], ["s-bez", null, "ws-tatran"]]);
    expect(calls).toHaveLength(1);
    expect((calls[0] as [string])[0]).toBe("ws-tatran");
  });
});

describe("Posledné veci nahradil strom", () => {
  test("bočný panel už nemá Posledné veci", () => {
    const out = render(<LiteNav />);
    expect(out).not.toContain("Recent matters");
    expect(out).not.toContain("data-lawoss-lite-recent");
    for (const dict of [shellEn, shellCs, shellSk, shellDe]) expect(dict).not.toHaveProperty(["lawoss.lite.recent_matters"]);
  });

  test("nové texty stromu sú vo všetkých jazykoch, nemecké bez dlhej pomlčky", () => {
    for (const dict of [shellEn, shellCs, shellSk, shellDe]) {
      for (const key of ["tree_title", "tree_new_conversation", "tree_show_all", "tree_conversation_on", "tree_expand", "tree_collapse", "clients_all"]) {
        expect(dict).toHaveProperty([`lawoss.lite.${key}`]);
      }
    }
    expect(shellSk["lawoss.lite.tree_new_conversation"]).toBe("Nový rozhovor");
    expect(shellSk["lawoss.lite.tree_show_all"]).toBe("Zobraziť všetky");
    expect(shellSk["lawoss.lite.tree_conversation_on"]).toBe("Rozhovor {date}");
    expect(Object.values(shellDe).some((value) => value.includes("—"))).toBe(false);
  });
});

describe("prehľad klienta na stránke Klienti a veci", () => {
  test("?klient= ukáže len kartu klienta a odkaz na všetkých klientov", () => {
    const out = renderToStaticMarkup(<MemoryRouter><ClientsView locale="en" groups={groups} focus="client:Hron" /></MemoryRouter>);
    expect(out).toContain("SYN Hron Technológie");
    expect(out).not.toContain("SYN Tatran Automatika");
    expect(out).toMatch(new RegExp(`<a[^>]*href="${LITE_CLIENTS_PATH}"[^>]*>All clients</a>`));
    // Neznámy klient (premenovaný priečinok): celý prehľad, nič sa neskryje.
    const all = renderToStaticMarkup(<MemoryRouter><ClientsView locale="en" groups={groups} focus="client:Nikto" /></MemoryRouter>);
    expect(all).toContain("SYN Tatran Automatika");
    expect(all).toContain("SYN Hron Technológie");
    expect(all).not.toContain("All clients");
  });
});
