// Pripojené priečinky klienta (rozhodnutie MČ 19. 10. 2026): klient má jeden hlavný priečinok (OKF) a k nemu
// pripojené ďalšie, ktoré agent smie čítať. Zápis ide cez natívne „povolené priečinky“ (Authorized Folders);
// engine ich dostane len v chatoch tohto klienta (plugin na serveri, testy v apps/server/src/lawoss/linked-folders-*).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { t, type Language } from "@/i18n";
import { LegalworkServerError } from "@/app/lib/legalwork-server";
import {
  LINK_REFUSAL_TEXT, isOfficeGrant, linkFolder, linkRefusal, linkedFolderCount, linkedFolderRows, linkedFoldersPolicy, linkedFoldersWriter,
  otherClientFolders, serverRefusal, unlinkFolder, type LinkRefusal, type LinkScope,
} from "../src/lawoss/lite/linked-folders";
import { LinkedFolders, LinkedFoldersNavView, LinkedFoldersView, focusLinkedFolders, linkedFoldersKey } from "../src/lawoss/lite/linked-folders-view";
import { ClientLinkedFoldersNavItem, ClientNavTestProvider } from "../src/lawoss/lite/client-nav";
import { ClientOverviewFrom } from "../src/lawoss/lite/client-overview";
import { clientNavModel, type ClientOverviewState } from "../src/lawoss/lite/client-projects";
import type { OkfConnection } from "../src/lawoss/okf/connection";
import type { OkfReadResult, OkfScope } from "../src/lawoss/okf/read-model";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";
import { ShellConfigProvider, useShellConfig, type ShellConfig } from "../src/react-app/shell/shell-config";
import { SIDEBAR_ITEMS } from "../src/react-app/domains/session/sidebar/sidebar-customization";
import { shellCs, shellDe, shellEn, shellSk } from "../src/lawoss/i18n/shell";

const source = (path: string) => readFileSync(join(import.meta.dir, "../src", path), "utf8");
const html = (node: ReactElement, client = new QueryClient()) => renderToStaticMarkup(
  <QueryClientProvider client={client}><MemoryRouter><SidebarProvider>{node}</SidebarProvider></MemoryRouter></QueryClientProvider>,
);

const scope = (over: Partial<LinkScope> = {}): LinkScope => ({
  clientRoot: "/prax/Klienti/Šťastný",
  practiceRoot: "/prax",
  otherClients: ["/prax/Klienti/Hron"],
  linked: ["/Users/ana/Zdieľané/Vzory"],
  ...over,
});

describe("model: čo sa smie pripojiť", () => {
  test("priečinok mimo praxe sa pripojiť smie; pamäť kancelárie tiež", () => {
    expect(linkRefusal("/Users/ana/Dokumenty/Šťastný podklady", scope())).toBeNull();
    expect(linkRefusal("/prax/_kancelaria", scope())).toBeNull();
  });

  test("koreň disku Windows (namapovaný či USB disk) sa pripojiť smie", () => {
    expect(linkRefusal("Z:\\", scope())).toBeNull();
    expect(linkRefusal("Z:/", scope())).toBeNull();
  });

  test("vlastný priečinok klienta a jeho podpriečinok netreba pripájať", () => {
    expect(linkRefusal("/prax/Klienti/Šťastný", scope())).toBe("own");
    expect(linkRefusal("/prax/Klienti/Šťastný/Spisy/Úhrada", scope())).toBe("own");
  });

  test("kontajner praxe (projekt obsahuje koreň praxe): nie „patrí klientovi“, ale pravidlá praxe a iných klientov", () => {
    const container = scope({ clientRoot: "/prax", otherClients: ["/prax/Klienti/Hron"] });
    expect(linkRefusal("/prax", container)).toBe("practice_root");
    expect(linkRefusal("/prax/Vzory", container)).toBe("practice_root");
    expect(linkRefusal("/prax/Klienti/Hron", container)).toBe("other_client");
    expect(linkRefusal("/prax/_kancelaria", container)).toBeNull();
  });

  test("priečinok iného klienta (aj jeho podpriečinok, aj priečinok, ktorý ho obsahuje) sa odmietne", () => {
    expect(linkRefusal("/prax/Klienti/Hron", scope())).toBe("other_client");
    expect(linkRefusal("/prax/Klienti/Hron/Spisy", scope())).toBe("other_client");
    expect(linkRefusal("/prax/Klienti", scope())).toBe("other_client");
    // Bez iného klienta v ňom: obsahuje priečinok tohto klienta, aj tak sa nepripojí.
    expect(linkRefusal("/prax/Klienti", scope({ otherClients: [] }))).toBe("contains_client");
  });

  test("prax: koreň, priečinok nad ním aj priečinok v nej (okrem pamäte kancelárie) sa nepripojí", () => {
    expect(linkRefusal("/prax", scope())).toBe("practice_root");
    expect(linkRefusal("/prax/", scope())).toBe("practice_root");
    expect(linkRefusal("/", scope())).toBe("practice_root");
    expect(linkRefusal("/prax/Vzory", scope())).toBe("practice_root");
  });

  test("prázdna alebo relatívna cesta je chýbajúci priečinok; už pripojený sa nepridá druhýkrát", () => {
    expect(linkRefusal("", scope())).toBe("missing");
    expect(linkRefusal(null, scope())).toBe("missing");
    expect(linkRefusal("Dokumenty/Šťastný", scope())).toBe("missing");
    expect(linkRefusal("/Users/ana/Zdieľané/Vzory/", scope())).toBe("duplicate");
  });

  test("diakritika z macOS (NFD) sa porovnáva rovnako ako NFC", () => {
    const nfd = (value: string) => value.normalize("NFD");
    expect(nfd("Šťastný")).not.toBe("Šťastný");
    expect(linkRefusal(nfd("/prax/Klienti/Šťastný/Podklady"), scope())).toBe("own");
    expect(linkRefusal(nfd("/prax/Klienti/Hron/Spisy"), scope({ otherClients: [nfd("/prax/Klienti/Hron")] }))).toBe("other_client");
    expect(linkRefusal("/Users/ana/Zdieľané/Vzory", scope({ linked: [nfd("/Users/ana/Zdieľané/Vzory")] }))).toBe("duplicate");
  });

  test("iní klienti: registrované priečinky a priečinky klientov z prehľadu, bez koreňa praxe a bez vlastných podpriečinkov", () => {
    const workspaces = [
      { id: "root", path: "/prax", workspaceType: "local" as const },
      { id: "me", path: "/prax/Klienti/Šťastný", workspaceType: "local" as const },
      { id: "old", path: "/prax/Klienti/Šťastný/Spisy/Stara".normalize("NFD"), workspaceType: "local" as const },
      { id: "hron", path: "/prax/Klienti/Hron", workspaceType: "local" as const },
      { id: "far", path: "https://worker", workspaceType: "remote" as const },
    ];
    expect(otherClientFolders("/prax/Klienti/Šťastný", workspaces, ["/prax/Klienti/Novák", "/prax/Klienti/Šťastný"])).toEqual(["/prax/Klienti/Hron", "/prax/Klienti/Novák"]);
  });

  test("pamäť kancelárie (pripojila ju LAWOSS) sa nedá odpojiť a nepočíta sa; koreň praxe ňou nie je", () => {
    expect(isOfficeGrant("/prax/_kancelaria", "/prax")).toBe(true);
    expect(isOfficeGrant("/prax/Office", "/prax")).toBe(true);
    expect(isOfficeGrant("/prax", "/prax")).toBe(false);
    expect(isOfficeGrant("/prax/Klienti/_kancelaria", "/prax")).toBe(false);
    expect(isOfficeGrant("/prax/_kancelaria", null)).toBe(false);
    expect(linkedFolderRows(["/prax/_kancelaria", "/Users/ana/Zdieľané/Vzory"], "/prax")).toEqual([
      { path: "/prax/_kancelaria", name: "_kancelaria", managed: true },
      { path: "/Users/ana/Zdieľané/Vzory", name: "Vzory", managed: false },
    ]);
    expect(linkedFolderCount(["/prax/_kancelaria", "/Users/ana/Zdieľané/Vzory"], "/prax")).toBe(1);
  });

  test("firma: zamknuté len vtedy, keď firma spravuje priečinky mimo projektu a nastavenie zamkla", () => {
    expect(linkedFoldersPolicy(null)).toEqual({ managed: false, locked: false });
    expect(linkedFoldersPolicy({ locked: true, value: { bash: "ask" } })).toEqual({ managed: false, locked: false });
    expect(linkedFoldersPolicy({ locked: false, value: { external_directory: { "/x/*": "allow" } } })).toEqual({ managed: true, locked: false });
    expect(linkedFoldersPolicy({ locked: true, value: { external_directory: {} } })).toEqual({ managed: true, locked: true });
  });

  test("odmietnutie servera (kanonické cesty, symbolický odkaz) má ten istý text ako odmietnutie v appke", () => {
    expect(serverRefusal(new LegalworkServerError(409, "linked_folder_other_client", "x"))).toBe("other_client");
    expect(serverRefusal(new LegalworkServerError(409, "linked_folder_practice", "x"))).toBe("practice_root");
    expect(serverRefusal(new LegalworkServerError(409, "linked_folder_app_data", "x"))).toBe("app_data");
    expect(serverRefusal(new LegalworkServerError(400, "linked_folder_relative", "x"))).toBe("missing");
    expect(serverRefusal(new Error("network"))).toBeNull();
  });
});

/** Natívny klient s jedným zoznamom; zaznamená zápisy. */
function fakeNative(initial: string[]) {
  let folders = [...initial];
  const writes: string[][] = [];
  return {
    writes,
    setRemote: (next: string[]) => { folders = next; },
    client: {
      listAuthorizedFolders: async () => ({ folders: [...folders], hiddenCount: 0, workspaceRoot: "/prax/Klienti/Šťastný" }),
      setAuthorizedFolders: async (_workspaceId: string, next: string[]) => { writes.push(next); folders = next; return { folders: next, hiddenCount: 0, updatedAt: 1 }; },
    },
  };
}

describe("model: zápis cez natívny zoznam povolených priečinkov", () => {
  const writer = (native: ReturnType<typeof fakeNative>, managed = false, allow = true) =>
    linkedFoldersWriter({ client: native.client, workspaceId: "ws", managed, changePolicy: async (write) => { if (allow) await write(); return allow; } });

  test("pripojenie číta zoznam znova pred zápisom (súbežná zmena sa nestratí) a pošle cestu v tvare z disku (bez NFC)", async () => {
    const native = fakeNative(["/Users/ana/Zdieľané/Vzory"]);
    native.setRemote(["/Users/ana/Zdieľané/Vzory", "/Users/ana/Iné"]);
    const picked = "/Users/ana/Dokumenty/Šťastný podklady/".normalize("NFD");
    const { linked: _ignored, ...rest } = scope();
    const result = await linkFolder({ pick: async () => picked, scope: rest, current: writer(native).current, save: writer(native).save });
    expect(result).toEqual({ kind: "saved" });
    expect(native.writes).toEqual([["/Users/ana/Zdieľané/Vzory", "/Users/ana/Iné", "/Users/ana/Dokumenty/Šťastný podklady".normalize("NFD")]]);
  });

  test("zrušený výber, odmietnutý priečinok aj duplicita v čerstvom zozname nič neuložia", async () => {
    const native = fakeNative(["/Users/ana/Iné"]);
    const { linked: _ignored, ...rest } = scope();
    const io = { scope: rest, current: writer(native).current, save: writer(native).save };
    expect(await linkFolder({ pick: async () => null, ...io })).toEqual({ kind: "cancelled" });
    expect(await linkFolder({ pick: async () => "/prax/Klienti/Hron", ...io })).toEqual({ kind: "refused", reason: "other_client" });
    expect(await linkFolder({ pick: async () => "/prax", ...io })).toEqual({ kind: "refused", reason: "practice_root" });
    expect(await linkFolder({ pick: async () => "/Users/ana/Iné/", ...io })).toEqual({ kind: "refused", reason: "duplicate" });
    expect(native.writes).toEqual([]);
  });

  test("odpojenie uloží čerstvý zoznam bez priečinka, ostatné položky ostanú v pôvodnom tvare", async () => {
    const native = fakeNative(["/a/Vzory", "/b/Zmluvy".normalize("NFD")]);
    expect(await unlinkFolder(writer(native).current, "/a/Vzory", writer(native).save)).toBe("saved");
    expect(native.writes).toEqual([["/b/Zmluvy".normalize("NFD")]]);
  });

  test("firma spravuje priečinky: zápis ide cez prevzatie nastavenia; odmietnuté = „declined“, nič sa nezapíše", async () => {
    const native = fakeNative([]);
    expect(await unlinkFolder(writer(native, true, false).current, "/x", writer(native, true, false).save)).toBe("declined");
    expect(native.writes).toEqual([]);
    expect(await unlinkFolder(writer(native, true, true).current, "/x", writer(native, true, true).save)).toBe("saved");
    expect(native.writes).toEqual([[]]);
  });
});

const tatran: RouteWorkspace = { id: "tatran", path: "/prax/Klienti/Šťastný", name: "Šťastný", displayNameResolved: "Šťastný", workspaceType: "local" };
const hron: RouteWorkspace = { id: "hron", path: "/prax/Klienti/Hron", name: "Hron", displayNameResolved: "Hron", workspaceType: "local" };
const remote: RouteWorkspace = { id: "rem_far", path: "/far", name: "Far", displayNameResolved: "Far", workspaceType: "remote" };
const connection: OkfConnection = { client: null, baseUrl: "http://127.0.0.1:9", token: "t", workspaces: [tatran, hron, remote], activeWorkspaceId: "tatran", authGeneration: 1 };
const practice: OkfScope = { anchor: tatran, members: [{ workspace: hron, prefix: "Klienti/Hron" }, { workspace: tatran, prefix: "Klienti/Šťastný" }], practiceRoot: "/prax" };
const ready: ClientOverviewState = { status: "ready", scope: practice, groups: [], matters: [] };
const model = clientNavModel([tatran, hron, remote], "/prax", ready);
const seeded = (workspaceId: string, folders: string[]) => {
  const client = new QueryClient();
  client.setQueryData(linkedFoldersKey(connection, workspaceId), { folders, hiddenCount: 0, workspaceRoot: "" });
  return client;
};

describe("Domov klienta: sekcia Pripojené priečinky", () => {
  const rows = linkedFolderRows(["/prax/_kancelaria", "/Users/ana/Zdieľané/Vzory"], "/prax");

  test("Domov klienta (prehľad z panela) ukáže pripojené priečinky z natívneho zoznamu tohto klienta", () => {
    const data = { matters: [], inputs: [], clients: [], problems: [], truncated: false, upcomingDeadlines: [], overdue: [],
      totals: { matters: 0, deadlinesWithin7Days: 0, openTasks: 0, overdue: 0, records: 0 }, coverage: { status: "complete", scopeKey: "k", sources: [] } } satisfies OkfReadResult;
    const nav = { connection, scope: practice, data, groups: [], model, excludedWorkspaceIds: [] };
    const out = html(<ClientOverviewFrom nav={nav} workspaceId="tatran" />, seeded("tatran", ["/Users/ana/Zdieľané/Vzory", "/prax/_kancelaria"]));
    expect(out).toContain("data-lawoss-client-overview");
    expect(out).toContain("data-lawoss-linked-folders");
    expect(out).toContain("/Users/ana/Zdieľané/Vzory");
    expect(out.match(/data-lawoss-linked-folder-unlink=/g)).toHaveLength(1);
  });

  test("vzdialený klient: krátka správa namiesto nekonečného načítania, bez Pripojiť", () => {
    const out = html(<LinkedFolders connection={connection} workspaceId="rem_far" practiceRoot="/prax" otherClients={[]} locale="sk" />);
    expect(out).toContain("data-lawoss-linked-folders-unavailable");
    expect(out).toContain(t("lawoss.lite.linked_folders_unavailable", "sk"));
    expect(out).not.toContain("data-lawoss-linked-folders-link");
  });

  test("zoznam: názov a cesta, Odpojiť pri každom okrem priečinka kancelárie, tlačidlo Pripojiť priečinok", () => {
    const out = html(<LinkedFoldersView locale="sk" state="ready" rows={rows} locked={false} canLink />);
    expect(out).toContain("Pripojené priečinky");
    expect(out).toContain("Súbory v nich LAWOSS neusporadúva.");
    expect(out).toContain("Vzory");
    expect(out).toContain("/Users/ana/Zdieľané/Vzory");
    expect(out.match(/data-lawoss-linked-folder-unlink=/g)).toHaveLength(1);
    expect(out).toContain('aria-label="Odpojiť priečinok Vzory"');
    expect(out).toContain("data-lawoss-linked-folder-managed");
    expect(out).toMatch(/<button(?=[^>]*data-lawoss-linked-folders-link="")(?![^>]*\sdisabled="")[^>]*>/);
  });

  test("zamknuté firmou: krátka poznámka, bez Pripojiť a Odpojiť", () => {
    const out = html(<LinkedFoldersView locale="sk" state="ready" rows={rows} locked canLink />);
    expect(out).toContain(t("lawoss.lite.linked_folders_locked", "sk"));
    expect(out).not.toContain("data-lawoss-linked-folders-link");
    expect(out).not.toContain("data-lawoss-linked-folder-unlink");
  });

  test("bez desktopu sa vybrať priečinok nedá: tlačidlo je vypnuté", () => {
    const out = html(<LinkedFoldersView locale="sk" state="ready" rows={[]} locked={false} canLink={false} />);
    expect(out).toMatch(/<button(?=[^>]*data-lawoss-linked-folders-link="")(?=[^>]*\sdisabled="")[^>]*>/);
    expect(out).toContain(t("lawoss.lite.linked_folders_empty", "sk"));
  });

  test("výsledok: odmietnutie jednou vetou, odmietnutá zmena firmy, uložené; chyba čítania nie je prázdny zoznam", () => {
    const view = (outcome: Parameters<typeof LinkedFoldersView>[0]["outcome"]) => html(<LinkedFoldersView locale="sk" state="ready" rows={[]} locked={false} canLink outcome={outcome} />);
    expect(view({ kind: "refused", reason: "other_client" })).toMatch(/role="alert"[^>]*>[^<]*inému klientovi/);
    expect(view({ kind: "declined" })).toContain(t("lawoss.lite.linked_folders_declined", "sk"));
    expect(view({ kind: "saved" })).toContain(t("lawoss.lite.linked_folders_reload", "sk"));
    const failed = html(<LinkedFoldersView locale="sk" state="error" rows={[]} locked={false} canLink />);
    expect(failed).toContain(t("lawoss.lite.linked_folders_error", "sk"));
    expect(failed).not.toContain(t("lawoss.lite.linked_folders_empty", "sk"));
  });
});

describe("bočný panel: Pripojené priečinky pod klientom", () => {
  type NavValue = Parameters<typeof ClientNavTestProvider>[0]["value"];
  const value: NavValue = { connection, scope: practice, data: undefined, groups: [], model, excludedWorkspaceIds: [],
    tree: { nodes: [], toggle: () => {}, openConversation: () => {}, newConversation: () => {} }, open: {}, setOpen: () => {}, focused: null, startNewChat: () => false };

  test("klient s pripojenými priečinkami: počet bez pamäte kancelárie; projekt, ktorý nie je klient, nič", () => {
    const client = seeded("tatran", ["/Users/ana/Zdieľané/Vzory", "/prax/_kancelaria"]);
    const out = html(<ClientNavTestProvider value={value}><ul><ClientLinkedFoldersNavItem workspaceId="tatran" /></ul></ClientNavTestProvider>, client);
    expect(out).toContain("Linked folders");
    expect(out).toMatch(/data-lawoss-project-linked-folders-count=""[^>]*>1</);
    expect(html(<ClientNavTestProvider value={value}><ul><ClientLinkedFoldersNavItem workspaceId="rem_far" /></ul></ClientNavTestProvider>, client)).toContain("<ul></ul>");
    expect(html(<ClientNavTestProvider value={value}><ul><ClientLinkedFoldersNavItem workspaceId="tatran" /></ul></ClientNavTestProvider>, seeded("tatran", ["/prax/_kancelaria"]))).toContain("<ul></ul>");
  });

  test("aktívna, keď je otvorený Domov klienta zo sekcie; inak nie", () => {
    const client = seeded("tatran", ["/Users/ana/Zdieľané/Vzory"]);
    const render = (active: boolean) => html(<ClientNavTestProvider value={value}><ul><ClientLinkedFoldersNavItem workspaceId="tatran" active={active} /></ul></ClientNavTestProvider>, client);
    focusLinkedFolders(null);
    expect(render(true)).not.toContain('aria-current="page"');
    focusLinkedFolders("tatran");
    expect(render(true)).toMatch(/<button(?=[^>]*data-lawoss-project-linked-folders="")(?=[^>]*aria-current="page")[^>]*>/);
    expect(render(false)).not.toContain('aria-current="page"');
    focusLinkedFolders(null);
  });

  test("pohľad položky: bez priečinkov sa neukáže", () => {
    expect(html(<LinkedFoldersNavView locale="sk" count={2} />)).toMatch(/data-lawoss-project-linked-folders-count=""[^>]*>2</);
    expect(html(<LinkedFoldersNavView locale="sk" count={0} />)).not.toContain("data-lawoss-project-linked-folders");
  });

  test("natívna mapa položiek projektu ju vykreslí ako Prípady a Lehoty (hák v upstream súbore, PATCHES)", () => {
    expect(source("react-app/domains/session/sidebar/app-sidebar.tsx")).toContain("projectLinkedFolders: <ClientLinkedFoldersNavItem key=\"projectLinkedFolders\"");
  });

  test("prispôsobenie panela: predvolene zapnutá hneď za Lehotami, staré poradie ju doplní za Lehoty", () => {
    const config = readConfig(null);
    expect(config.projectLinkedFolders).toBe(true);
    expect(config.projectNavOrder.slice(0, 4)).toEqual(["projectHome", "projectMatters", "projectDeadlines", "projectLinkedFolders"]);
    const saved = ["projectHome", "projectMatters", "projectDeadlines", "projectCalendar", "projectFiles", "projectSessions"];
    expect(readConfig({ projectNavOrder: saved }).projectNavOrder.slice(0, 5)).toEqual(["projectHome", "projectMatters", "projectDeadlines", "projectLinkedFolders", "projectCalendar"]);
    expect(readConfig({ projectNavOrder: saved, projectLinkedFolders: false }).projectLinkedFolders).toBe(false);
    for (const locale of ["sk", "cs", "en", "de"] satisfies Language[]) expect(t(SIDEBAR_ITEMS.projectLinkedFolders.label, locale)).not.toBe(SIDEBAR_ITEMS.projectLinkedFolders.label);
    expect(t(SIDEBAR_ITEMS.projectLinkedFolders.label, "sk")).toBe("Pripojené priečinky");
  });
});

describe("texty pripojených priečinkov", () => {
  const keys = ["linked_folders_title", "linked_folders_desc", "linked_folders_empty", "linked_folders_link", "linked_folders_unlink", "linked_folders_office",
    "linked_folders_locked", "linked_folders_error", "linked_folders_save_error", "linked_folders_reload", "linked_folders_declined", "linked_folders_unavailable"];
  test("všetky jazyky, každý dôvod odmietnutia má statický kľúč, nemčina bez dlhej pomlčky", () => {
    const reasons: LinkRefusal[] = ["own", "contains_client", "other_client", "practice_root", "app_data", "missing", "duplicate"];
    for (const dict of [shellEn, shellCs, shellSk, shellDe]) {
      for (const key of keys) expect(dict).toHaveProperty([`lawoss.lite.${key}`]);
      for (const reason of reasons) expect(dict).toHaveProperty([LINK_REFUSAL_TEXT[reason]]);
    }
    expect(Object.values(shellDe).some((value) => value.includes("—"))).toBe(false);
    for (const file of ["lawoss/lite/linked-folders.ts", "lawoss/lite/linked-folders-view.tsx"]) expect(source(file)).not.toContain("`lawoss.lite.${");
  });

  test("slovenčina poctivo: len chaty tohto klienta, čítanie aj úpravy podľa oprávnení, zmena hneď; čeština drží pojmy", () => {
    expect(shellSk["lawoss.lite.linked_folders_desc"]).toContain("V chatoch tohto klienta");
    expect(shellSk["lawoss.lite.linked_folders_desc"]).toContain("upravovať");
    // Iní klienti sa k nim dostanú len po otázke používateľovi (engine sa pýta), nie „nevidia ich“.
    expect(shellSk["lawoss.lite.linked_folders_desc"]).toContain("V chatoch iných klientov sa vás agent najprv opýta.");
    for (const dict of [shellEn, shellCs, shellSk, shellDe]) expect(dict["lawoss.lite.linked_folders_desc"]).not.toMatch(/nevidia|nevidí|do not see|sehen sie nicht/);
    expect(shellSk["lawoss.lite.linked_folders_reload"]).not.toContain("LAWOSS");
    expect(shellSk[LINK_REFUSAL_TEXT.own]).toContain("chaty klienta");
    expect(shellCs["lawoss.lite.linked_folders_title"]).toBe("Připojené složky");
    expect(shellCs[LINK_REFUSAL_TEXT.other_client]).toContain("klient");
  });
});

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
