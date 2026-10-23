// LAWOSS: pravidlá pripojených priečinkov, ktoré zdieľa server a plugin enginu `lawoss-linked-folders`.
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowedFolders, canonicalPath, externalDirectoryAllowed, folderOfGrant, isOfficeMemoryFolder, linkedFolderConflict, parseLinkedFoldersMap, patternDirectory, type LinkedFoldersMap } from "./linked-folders-rules.js";
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
