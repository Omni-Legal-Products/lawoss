// Pripojené priečinky klienta (rozhodnutie MČ 19. 10. 2026): klient má jeden hlavný priečinok (OKF) a k nemu
// pripojené ďalšie, ktoré agent smie čítať. Zápis ide cez natívne „povolené priečinky“ (Authorized Folders).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { t, type Language } from "@/i18n";
import {
  LINK_REFUSAL_TEXT, isOfficeGrant, linkFolder, linkRefusal, linkedFolderRows, linkedFoldersPolicy, otherClientFolders, unlinkFolder,
  type LinkRefusal, type LinkScope,
} from "../src/lawoss/lite/linked-folders";
import { LinkedFoldersNavView, LinkedFoldersView } from "../src/lawoss/lite/linked-folders-view";
import { ShellConfigProvider, useShellConfig, type ShellConfig } from "../src/react-app/shell/shell-config";
import { SIDEBAR_ITEMS } from "../src/react-app/domains/session/sidebar/sidebar-customization";
import { shellCs, shellDe, shellEn, shellSk } from "../src/lawoss/i18n/shell";

const source = (path: string) => readFileSync(join(import.meta.dir, "../src", path), "utf8");
const html = (node: ReactElement) => renderToStaticMarkup(<MemoryRouter><SidebarProvider>{node}</SidebarProvider></MemoryRouter>);

const scope = (over: Partial<LinkScope> = {}): LinkScope => ({
  clientRoot: "/prax/Klienti/Šťastný",
  practiceRoot: "/prax",
  otherClients: ["/prax/Klienti/Hron"],
  linked: ["/Users/ana/Zdieľané/Vzory"],
  ...over,
});

describe("model: čo sa smie pripojiť", () => {
  test("cudzí priečinok mimo praxe a priečinok v praxi mimo klientov sa pripojiť smú", () => {
    expect(linkRefusal("/Users/ana/Dokumenty/Šťastný podklady", scope())).toBeNull();
    expect(linkRefusal("/prax/Vzory", scope())).toBeNull();
  });

  test("vlastný priečinok klienta a jeho podpriečinok netreba pripájať", () => {
    expect(linkRefusal("/prax/Klienti/Šťastný", scope())).toBe("own");
    expect(linkRefusal("/prax/Klienti/Šťastný/Spisy/Úhrada", scope())).toBe("own");
  });

  test("priečinok iného klienta (aj jeho podpriečinok, aj priečinok, ktorý ho obsahuje) sa odmietne", () => {
    expect(linkRefusal("/prax/Klienti/Hron", scope())).toBe("other_client");
    expect(linkRefusal("/prax/Klienti/Hron/Spisy", scope())).toBe("other_client");
    expect(linkRefusal("/prax/Klienti", scope())).toBe("other_client");
    // Bez iného klienta v ňom: obsahuje priečinok tohto klienta, aj tak sa nepripojí.
    expect(linkRefusal("/prax/Klienti", scope({ otherClients: [] }))).toBe("contains_client");
  });

  test("koreň praxe ani priečinok nad ním sa nepripojí", () => {
    expect(linkRefusal("/prax", scope())).toBe("practice_root");
    expect(linkRefusal("/prax/", scope())).toBe("practice_root");
    expect(linkRefusal("/", scope())).toBe("practice_root");
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

  test("priečinok pamäte kancelárie (pripojila ho LAWOSS) sa v zozname nedá odpojiť", () => {
    expect(isOfficeGrant("/prax/_kancelaria", "/prax")).toBe(true);
    expect(isOfficeGrant("/prax/Office", "/prax")).toBe(true);
    expect(isOfficeGrant("/prax/Klienti/_kancelaria", "/prax")).toBe(false);
    expect(isOfficeGrant("/Users/ana/_kancelaria", "/prax")).toBe(false);
    expect(isOfficeGrant("/prax/_kancelaria", null)).toBe(false);
    expect(linkedFolderRows(["/prax/_kancelaria", "/Users/ana/Zdieľané/Vzory"], "/prax")).toEqual([
      { path: "/prax/_kancelaria", name: "_kancelaria", managed: true },
      { path: "/Users/ana/Zdieľané/Vzory", name: "Vzory", managed: false },
    ]);
  });

  test("firma: zamknuté len vtedy, keď firma spravuje priečinky mimo projektu a nastavenie zamkla", () => {
    expect(linkedFoldersPolicy(null)).toEqual({ managed: false, locked: false });
    expect(linkedFoldersPolicy({ locked: true, value: { bash: "ask" } })).toEqual({ managed: false, locked: false });
    expect(linkedFoldersPolicy({ locked: false, value: { external_directory: { "/x/*": "allow" } } })).toEqual({ managed: true, locked: false });
    expect(linkedFoldersPolicy({ locked: true, value: { external_directory: {} } })).toEqual({ managed: true, locked: true });
  });
});

describe("model: pripojenie a odpojenie cez natívny zoznam povolených priečinkov", () => {
  test("pripojenie uloží celý zoznam s novým priečinkom; cestu pošle v tvare z disku (bez NFC)", async () => {
    const saved: string[][] = [];
    const picked = "/Users/ana/Dokumenty/Šťastný podklady/".normalize("NFD");
    const result = await linkFolder({ pick: async () => picked, scope: scope(), save: async (folders) => { saved.push(folders); } });
    expect(result).toEqual({ kind: "saved" });
    expect(saved).toEqual([["/Users/ana/Zdieľané/Vzory", "/Users/ana/Dokumenty/Šťastný podklady".normalize("NFD")]]);
  });

  test("zrušený výber nič neuloží; odmietnutý priečinok tiež nie", async () => {
    let calls = 0;
    const save = async () => { calls += 1; };
    expect(await linkFolder({ pick: async () => null, scope: scope(), save })).toEqual({ kind: "cancelled" });
    expect(await linkFolder({ pick: async () => "/prax/Klienti/Hron", scope: scope(), save })).toEqual({ kind: "refused", reason: "other_client" });
    expect(await linkFolder({ pick: async () => "/prax", scope: scope(), save })).toEqual({ kind: "refused", reason: "practice_root" });
    expect(calls).toBe(0);
  });

  test("odpojenie uloží zoznam bez priečinka, ostatné položky ostanú v pôvodnom tvare", async () => {
    const saved: string[][] = [];
    await unlinkFolder(["/a/Vzory", "/b/Zmluvy".normalize("NFD")], "/a/Vzory", async (folders) => { saved.push(folders); });
    expect(saved).toEqual([["/b/Zmluvy".normalize("NFD")]]);
  });
});

describe("Domov klienta: sekcia Pripojené priečinky", () => {
  const rows = linkedFolderRows(["/prax/_kancelaria", "/Users/ana/Zdieľané/Vzory"], "/prax");

  test("zoznam: názov a cesta, Odpojiť pri každom okrem priečinka kancelárie, tlačidlo Pripojiť priečinok", () => {
    const out = html(<LinkedFoldersView locale="sk" state="ready" rows={rows} locked={false} canLink />);
    expect(out).toContain("data-lawoss-linked-folders");
    expect(out).toContain("Pripojené priečinky");
    expect(out).toContain("Súbory v nich LAWOSS neusporadúva.");
    expect(out).toContain("Vzory");
    expect(out).toContain("/Users/ana/Zdieľané/Vzory");
    expect(out.match(/data-lawoss-linked-folder-unlink=/g)).toHaveLength(1);
    expect(out).toContain('aria-label="Odpojiť priečinok Vzory"');
    expect(out).toContain("data-lawoss-linked-folder-managed");
    expect(out).toMatch(/<button(?=[^>]*data-lawoss-linked-folders-link="")(?![^>]*\sdisabled="")[^>]*>/);
    expect(out).toContain("Pripojiť priečinok");
  });

  test("zamknuté firmou: krátka poznámka, bez Pripojiť a Odpojiť", () => {
    const out = html(<LinkedFoldersView locale="sk" state="ready" rows={rows} locked canLink />);
    expect(out).toContain("data-lawoss-linked-folders-locked");
    expect(out).toContain(t("lawoss.lite.linked_folders_locked", "sk"));
    expect(out).not.toContain("data-lawoss-linked-folders-link");
    expect(out).not.toContain("data-lawoss-linked-folder-unlink");
  });

  test("bez desktopu sa vybrať priečinok nedá: tlačidlo je vypnuté", () => {
    const out = html(<LinkedFoldersView locale="sk" state="ready" rows={[]} locked={false} canLink={false} />);
    expect(out).toMatch(/<button(?=[^>]*data-lawoss-linked-folders-link="")(?=[^>]*\sdisabled="")[^>]*>/);
    expect(out).toContain(t("lawoss.lite.linked_folders_empty", "sk"));
  });

  test("odmietnutie povie dôvod jednou vetou; chyba čítania nie je prázdny zoznam", () => {
    const refused = html(<LinkedFoldersView locale="sk" state="ready" rows={[]} locked={false} canLink refusal="other_client" />);
    expect(refused).toMatch(/role="alert"[^>]*>[^<]*inému klientovi/);
    const failed = html(<LinkedFoldersView locale="sk" state="error" rows={[]} locked={false} canLink />);
    expect(failed).toContain(t("lawoss.lite.linked_folders_error", "sk"));
    expect(failed).not.toContain(t("lawoss.lite.linked_folders_empty", "sk"));
  });

  test("prehľad klienta sekciu vykreslí (ClientOverview) a nevolá natívne Nastavenia inou cestou", () => {
    const overview = source("lawoss/lite/client-overview.tsx");
    expect(overview).toContain("<LinkedFolders ");
    const container = source("lawoss/lite/linked-folders-view.tsx");
    expect(container).toContain("listAuthorizedFolders(");
    expect(container).toContain("setAuthorizedFolders(");
    expect(container).toContain('changeOrgPolicySetting("tools.permissions"');
    expect(container).toContain('useOrgPolicy("tools.permissions")');
  });
});

describe("bočný panel: Pripojené priečinky pod klientom", () => {
  test("položka s počtom; bez pripojených priečinkov sa neukáže", () => {
    const out = html(<LinkedFoldersNavView locale="sk" count={2} />);
    expect(out).toContain("data-lawoss-project-linked-folders");
    expect(out).toContain("Pripojené priečinky");
    expect(out).toMatch(/data-lawoss-project-linked-folders-count=""[^>]*>2</);
    expect(html(<LinkedFoldersNavView locale="sk" count={0} />)).not.toContain("data-lawoss-project-linked-folders");
  });

  test("natívna mapa položiek projektu ju vykreslí ako Prípady a Lehoty", () => {
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
    "linked_folders_locked", "linked_folders_error", "linked_folders_save_error", "linked_folders_reload"];
  test("všetky jazyky, každý dôvod odmietnutia má statický kľúč, nemčina bez dlhej pomlčky", () => {
    const reasons: LinkRefusal[] = ["own", "contains_client", "other_client", "practice_root", "missing", "duplicate"];
    for (const dict of [shellEn, shellCs, shellSk, shellDe]) {
      for (const key of keys) expect(dict).toHaveProperty([`lawoss.lite.${key}`]);
      for (const reason of reasons) expect(dict).toHaveProperty([LINK_REFUSAL_TEXT[reason]]);
    }
    expect(Object.values(shellDe).some((value) => value.includes("—"))).toBe(false);
    for (const file of ["lawoss/lite/linked-folders.ts", "lawoss/lite/linked-folders-view.tsx"]) expect(source(file)).not.toContain("`lawoss.lite.${");
  });

  test("slovenčina: poctivo povie, že ide o čítanie aj úpravy podľa oprávnení; čeština drží pojmy Klient a složka", () => {
    expect(shellSk["lawoss.lite.linked_folders_desc"]).toContain("Agent môže čítať aj tieto priečinky");
    expect(shellSk["lawoss.lite.linked_folders_desc"]).toContain("upravovať");
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
