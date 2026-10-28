// LAWOSS: pravidlá pripojených priečinkov, ktoré zdieľa server a plugin enginu `lawoss-linked-folders`.
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowedFolders, canonicalPath, externalDirectoryAllowed, externalDirectoryOtherClient, folderOfGrant, isOfficeMemoryFolder, linkedFolderConflict, parseLinkedFoldersMap, patternDirectory, type LinkedFoldersMap } from "./linked-folders-rules.js";
import { withoutClientFolderGrants } from "./linked-folders.js";

const map = (over: Partial<LinkedFoldersMap> = {}): LinkedFoldersMap => ({
  version: 1, officeRoot: "/prax", firmManaged: false,
  clients: [
    { root: "/prax", folders: ["/zdielane/Prax"] },
    { root: "/prax/Klienti/Tatran", folders: ["/zdielane/Vzory", "/prax/Klienti/Hron/Spisy", "/prax/Vzory", "/prax/_kancelaria"] },
    { root: "/prax/Klienti/Hron", folders: ["/hron/podklady"] },
  ],
  ...over,
});

describe("rozhodnutie pre chat", () => {
  test("chat klienta (koreň aj prípad): koreň klienta a pripojené priečinky; kolízie s iným klientom a praxou vypadnú", () => {
    for (const directory of ["/prax/Klienti/Tatran", "/prax/Klienti/Tatran/Spisy/Úhrada"])
      expect(allowedFolders(map(), directory)).toEqual(["/prax/Klienti/Tatran", "/zdielane/Vzory", "/prax/_kancelaria"]);
    expect(allowedFolders(map(), "/prax/Klienti/Hron")).toEqual(["/prax/Klienti/Hron", "/hron/podklady"]);
  });

  test("registrovaný koreň praxe nie je klient: jeho koreň sa nepovolí; neznámy priečinok nič; firma = nič", () => {
    expect(allowedFolders(map(), "/prax/Klienti/Novak")).toEqual(["/zdielane/Prax"]);
    expect(allowedFolders(map(), "/ine/Projekt")).toEqual([]);
    expect(allowedFolders(map({ firmManaged: true }), "/prax/Klienti/Tatran")).toEqual([]);
  });

  test("všetky ciele musia ležať v povolených priečinkoch; neznámy tvar vzoru nerozhoduje", () => {
    expect(externalDirectoryAllowed(map(), "/prax/Klienti/Tatran/Spisy/X", ["/zdielane/Vzory/2026", "/prax/Klienti/Tatran"])).toBe(true);
    expect(externalDirectoryAllowed(map(), "/prax/Klienti/Tatran", ["/zdielane/Vzory", "/hron/podklady"])).toBe(false);
    expect(externalDirectoryAllowed(map(), "/prax/Klienti/Hron", ["/zdielane/Vzory"])).toBe(false);
    expect(externalDirectoryAllowed(map(), "/prax/Klienti/Tatran", [null])).toBe(false);
    expect(externalDirectoryAllowed(map(), "/prax/Klienti/Tatran", [])).toBe(false);
    expect(patternDirectory("/zdielane/Vzory/*")).toBe("/zdielane/Vzory");
    expect(patternDirectory("*")).toBeNull();
  });
});

describe("pomocné pravidlá", () => {
  test("položky natívneho zoznamu: len `<priečinok>/*: allow` je pripojený priečinok", () => {
    expect(folderOfGrant("/a/b/*", "allow")).toBe("/a/b");
    expect(folderOfGrant("/*", "allow")).toBe("/");
    // Koreň disku Windows ostáva absolútny; „Z:“ je cesta relatívna k aktuálnemu priečinku disku.
    expect(folderOfGrant("Z:/*", "allow")).toBe("Z:/");
    expect(folderOfGrant("Z:\\*", "allow")).toBe("Z:/");
    expect(folderOfGrant("Z:/Klienti/*", "allow")).toBe("Z:/Klienti");
    expect(folderOfGrant("*", "allow")).toBeNull();
    expect(folderOfGrant("/a/b/*", "deny")).toBeNull();
    expect(folderOfGrant("/a/b", "allow")).toBeNull();
    expect(withoutClientFolderGrants({ bash: "ask", external_directory: { "/a/*": "allow", "/b/*": "deny", "*": "allow" } }))
      .toEqual({ bash: "ask", external_directory: { "/b/*": "deny", "*": "allow" } });
    expect(withoutClientFolderGrants({ external_directory: { "/a/*": "allow" } })).toEqual({});
  });

  test("pamäť kancelárie je priamo v koreni praxe; koreň praxe sám ňou nie je", () => {
    expect(isOfficeMemoryFolder("/prax/_kancelaria", "/prax")).toBe(true);
    expect(isOfficeMemoryFolder("/prax/Office", "/prax")).toBe(true);
    expect(isOfficeMemoryFolder("/prax", "/prax")).toBe(false);
    expect(isOfficeMemoryFolder("/prax/Klienti/_kancelaria", "/prax")).toBe(false);
    expect(linkedFolderConflict("/prax/Vzory", { ownRoot: "/prax/Klienti/Tatran", otherRoots: [], officeRoot: "/prax" })).toBe("practice");
    expect(linkedFolderConflict("/prax/Klienti/Tatran/Spisy", { ownRoot: "/prax/Klienti/Tatran", otherRoots: ["/prax/Klienti/Hron"], officeRoot: "/prax" })).toBeNull();
  });

  test("súbor mapy: neplatný tvar = žiadne rozhodnutie", () => {
    expect(parseLinkedFoldersMap({ version: 2, clients: [] })).toBeNull();
    expect(parseLinkedFoldersMap({ version: 1, clients: [{ root: "/a", folders: [1] }] })).toBeNull();
    expect(parseLinkedFoldersMap({ version: 1, officeRoot: null, clients: [] })).toEqual({ version: 1, officeRoot: null, clients: [], firmManaged: false });
  });

  test("kanonická cesta: odkaz sa vyrieši, NFD = NFC, neexistujúci koniec sa pripojí k existujúcemu predkovi", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-linked-rules-")));
    try {
      await mkdir(join(root, "Šťastný"));
      await symlink(join(root, "Šťastný"), join(root, "odkaz"));
      expect(await canonicalPath(join(root, "odkaz", "Spisy"))).toBe(join(root, "Šťastný", "Spisy"));
      expect(await canonicalPath(join(root, "Šťastný".normalize("NFD")))).toBe(join(root, "Šťastný"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("oprava 2", () => {
  test("spoločný súbor: preč každé `allow` okrem holého `*` (aj `**`, glob, holý priečinok, `~/…`)", () => {
    expect(withoutClientFolderGrants({ external_directory: { "/a/**": "allow", "/b/*.pdf": "allow", "/c": "allow", "~/d/*": "allow", " * ": "allow", "/f/*": "deny", "/g/*": "ask" } }))
      .toEqual({ external_directory: { " * ": "allow", "/f/*": "deny", "/g/*": "ask" } });
  });

  test("iný registrovaný klient sa overí aj pre podpriečinok vlastného koreňa (kontajner praxe nepripojí koreň klienta)", () => {
    const container = { ownRoot: "/prax", otherRoots: ["/prax/Klienti/Tatran"], officeRoot: null };
    expect(linkedFolderConflict("/prax/Klienti/Tatran", container)).toBe("other_client");
    expect(linkedFolderConflict("/prax/Klienti", container)).toBe("other_client");
    expect(linkedFolderConflict("/prax/Vzory", container)).toBeNull();
  });

  test("relatívna cesta a priečinok s dátami aplikácie sa nepripoja; koreň klienta s dátami aplikácie sa nepovolí", () => {
    const scope = { ownRoot: "/prax/Klienti/Tatran", otherRoots: [], officeRoot: null, protectedDirs: ["/home/ana/Library/LAWOSS"] };
    expect(linkedFolderConflict("Zdielane", scope)).toBe("relative");
    expect(linkedFolderConflict("/home/ana", scope)).toBe("app_data");
    expect(linkedFolderConflict("/home/ana/Library/LAWOSS", scope)).toBe("app_data");
    // Aj priečinok vnútri dát aplikácie (napr. kód pluginov) sa odmietne.
    expect(linkedFolderConflict("/home/ana/Library/LAWOSS/bundled-plugins", scope)).toBe("app_data");
    const home = map({ officeRoot: null, clients: [{ root: "/home/ana", folders: [] }] });
    expect(allowedFolders(home, "/home/ana/Spisy", ["/home/ana/Library/LAWOSS"])).toEqual([]);
    expect(externalDirectoryAllowed(map(), "/prax/Klienti/Tatran/Spisy", ["/prax/Klienti/Tatran"], ["/prax/Klienti/Tatran/.app"])).toBe(false);
    // Cieľ v dátach aplikácie sa nepovolí ani vtedy, keď by ho pokrýval povolený priečinok.
    const inside = map({ officeRoot: null, clients: [{ root: "/prax/Klienti/Tatran", folders: ["/zdielane"] }] });
    expect(externalDirectoryAllowed(inside, "/prax/Klienti/Tatran/Spisy", ["/zdielane/Vzory"], ["/zdielane/LAWOSS"])).toBe(false);
    expect(externalDirectoryAllowed(inside, "/prax/Klienti/Tatran/Spisy", ["/zdielane/LAWOSS/bundled-plugins"], ["/zdielane/LAWOSS"])).toBe(false);
  });

  test("klient zaregistrovaný vnútri iného ostane oddelený aj od chatov vonkajšieho; pamäť kancelárie pod kontajnerom smie", () => {
    const nested = map({ clients: [
      { root: "/prax", folders: [] },
      { root: "/prax/Klienti/Tatran", folders: ["/prax/_kancelaria"] },
      { root: "/prax/Klienti/Tatran/Pobočka", folders: [] },
    ] });
    expect(externalDirectoryAllowed(nested, "/prax/Klienti/Tatran/Spisy", ["/prax/Klienti/Tatran/Pobočka/x"])).toBe(false);
    expect(externalDirectoryAllowed(nested, "/prax/Klienti/Tatran/Spisy", ["/prax/Klienti/Tatran/Korešpondencia"])).toBe(true);
    expect(externalDirectoryAllowed(nested, "/prax/Klienti/Tatran/Spisy", ["/prax/_kancelaria"])).toBe(true);
  });
});

describe("oprava 3", () => {
  test("dáta aplikácie oboma smermi; obsah wiki v priečinku aplikácie ostáva povolený (upstream ho tam ukladá)", () => {
    const scope = { ownRoot: "/prax/Klienti/Tatran", otherRoots: [], officeRoot: null, protectedDirs: ["/app"], contentRoots: ["/app/wikis/w1"] };
    expect(linkedFolderConflict("/app/bundled-plugins", scope)).toBe("app_data");
    expect(linkedFolderConflict("/app", scope)).toBe("app_data");
    expect(linkedFolderConflict("/app/wikis/w1", scope)).toBeNull();
    expect(linkedFolderConflict("/app/wikis", scope)).toBe("app_data");
  });
});

// N-A7-14 (test E2): chat klienta C001 žiada priečinok klienta C002 tej istej praxe → plugin odmietne bez karty.
// Klient = priečinok s kartou (`client` v mape); registrované spisy toho istého klienta nie sú iný klient (review #295).
describe("priečinok iného klienta", () => {
  const P = "/Users/advokat/Prax", c001 = `${P}/Klienti/C001-Tatran`, c002 = `${P}/Klienti/C002-Hron`, c003 = `${c001}/Dcera C003`;
  const m1 = `${c001}/Spisy/M001 Úhrada`, m2 = `${c001}/Spisy/M002 Nájom`;
  const prax = (over: Partial<LinkedFoldersMap> = {}): LinkedFoldersMap => ({
    version: 1, officeRoot: P, firmManaged: false,
    clients: [
      { root: P, folders: [], client: null },
      { root: c001, folders: ["/Users/advokat/Zdielane/Vzory"], client: c001 },
      { root: m1, folders: [], client: c001 },
      { root: m2, folders: [], client: c001 },
      { root: c002, folders: [], client: c002 },
      { root: c003, folders: [], client: c003 },
      { root: `${P}/Klienti/C004-Bez-karty`, folders: [], client: null },
    ],
    ...over,
  });

  test("cieľ v inom klientovi, aj z chatu prípadu a registrovaného spisu, aj vzor `C002*` hľadania", () => {
    for (const chat of [c001, `${c001}/Spisy/M009 Nový`, m1]) {
      for (const target of [c002, `${c002}/Spisy/M004`, `${P}/Klienti/C002*`, `${P}/Klienti/C00?-Hron/Spisy`, `${P}/Klienti/*-Hron`])
        expect(externalDirectoryOtherClient(prax(), chat, [target])).toBe(true);
    }
    if (process.platform !== "linux") expect(externalDirectoryOtherClient(prax(), c001, ["/users/advokat/prax/klienti/c002*"])).toBe(true);
    // Klient zaregistrovaný vnútri C001 má vlastnú kartu: pre chat C001 je iný klient.
    expect(externalDirectoryOtherClient(prax(), c001, [`${c003}/Zmluvy`])).toBe(true);
  });

  test("dva registrované spisy toho istého klienta sa navzájom neodmietnu; ani koreň klienta zo spisu", () => {
    expect(externalDirectoryOtherClient(prax(), m1, [m2])).toBe(false);
    expect(externalDirectoryOtherClient(prax(), m2, [m1, `${m1}/Podklady`])).toBe(false);
    expect(externalDirectoryOtherClient(prax(), m1, [c001, `${c001}/Spisy/*`])).toBe(false);
    expect(externalDirectoryOtherClient(prax(), c001, [m2])).toBe(false);
  });

  test("vzor cez vlastného klienta alebo priečinok s klientmi: karta, nie odmietnutie", () => {
    for (const target of [`${P}/Klienti/*`, `${P}/Klienti/C00*`, `${P}/**`, `${P}/K*`, `${P}/Klienti`, "/Users/advokat", `${P}/*/C002-Hron`])
      expect(externalDirectoryOtherClient(prax(), c001, [target])).toBe(target === `${P}/*/C002-Hron`);
    // Aj keď je v otázke popri inom klientovi aj vlastný priečinok.
    expect(externalDirectoryOtherClient(prax(), c001, [c001, c002])).toBe(false);
  });

  test("neisté znaky `[ ] { } $ \`` sa neodmietajú (rozhodne karta)", () => {
    for (const target of [`${P}/Klienti/C002[-_]Hron`, `${P}/Klienti/{C002-Hron,C009}`, `$HOME/Prax/Klienti/C002-Hron`, `${P}/Klienti/\`ls\``])
      expect(externalDirectoryOtherClient(prax(), c001, [target])).toBe(false);
  });

  test("pripojený priečinok mimo praxe (E1), priečinok bez karty a chat bez známeho klienta: bez odmietnutia", () => {
    expect(externalDirectoryOtherClient(prax(), c001, ["/Users/advokat/Zdielane/Vzory", "/Users/advokat/Zdielane/Vzory/2026"])).toBe(false);
    expect(externalDirectoryOtherClient(prax(), c001, [`${P}/Vzory`, `${P}/Klienti/C004-Bez-karty`, `${P}/Klienti/C005-Nezaregistrovany`])).toBe(false);
    expect(externalDirectoryOtherClient(prax(), c001, [null])).toBe(false);
    for (const chat of [P, `${P}/Klienti/C004-Bez-karty`, `${P}/Klienti/C005-Nezaregistrovany`, "/Users/advokat/Iny"])
      expect(externalDirectoryOtherClient(prax(), chat, [c002])).toBe(false);
    expect(externalDirectoryOtherClient(prax({ firmManaged: true }), c001, [c002])).toBe(false);
    // Starší súbor mapy bez `client`: nerozhoduje sa.
    const legacy = parseLinkedFoldersMap({ version: 1, officeRoot: P, clients: [{ root: c001, folders: [] }, { root: c002, folders: [] }] });
    expect(legacy && externalDirectoryOtherClient(legacy, c001, [c002])).toBe(false);
  });
});
