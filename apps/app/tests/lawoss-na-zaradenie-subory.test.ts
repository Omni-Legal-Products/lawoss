import { describe, expect, test } from "bun:test";
import { inputCounts } from "../src/lawoss/lite/client-cards";
import { inputGroups, unfiledInputs } from "../src/lawoss/lite/inputs-model";
import { buildToday } from "../src/lawoss/lite/today-model";
import { okfScope, readScopeMemory, type OkfScopeClient } from "../src/lawoss/okf/read-model";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";

// N-A5-3 (UI test dev 25. 10. 2026): súbor, ktorý advokát vloží do `00_Na_zatriedenie` vo Finderi, nemá riadok vo
// `VSTUPY.md`, a Dnes ukázal „0 Na zaradenie“. Počítajú sa aj súbory v priečinkoch na nezaradené (klienta aj prípadu,
// vrátane vlastnej roly `inbox` z #241); súbor s riadkom vo `VSTUPY.md` sa nezráta dvakrát.

const TODAY = "2026-10-25";
const ROOT = "/Users/advokat/AK Synteticka/Klienti";
const ws = (id: string, path: string): RouteWorkspace => ({ id, path, name: id, displayNameResolved: id, workspaceType: "local" });
const hron = ws("hron", `${ROOT}/C002 SYN Hron`);
const tatran = ws("tatran", `${ROOT}/C001 SYN Tatran`);

type Tree = Record<string, string>;
function fakeServer(trees: Record<string, Tree>): OkfScopeClient {
  const tree = (id: string): Tree => {
    const files = trees[id];
    if (!files) throw new Error(`404 workspace ${id}`);
    return files;
  };
  return {
    listWorkspaceDirectory: async (id, path) => {
      const prefix = path ? `${path}/` : "";
      const names = new Map<string, "file" | "dir">();
      for (const p of Object.keys(tree(id))) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        names.set(rest.split("/")[0]!, rest.includes("/") ? "dir" : "file");
      }
      if (names.size === 0) throw new Error(`404 ${path}`);
      return { path, truncated: false, entries: [...names].map(([name, kind]) => ({ name, kind, path: `${prefix}${name}` })) };
    },
    readWorkspaceFile: async (id, path) => {
      const content = tree(id)[path];
      if (content === undefined) throw new Error(`404 ${path}`);
      return { path, content, bytes: content.length, updatedAt: 0 };
    },
  };
}

const M004 = "Spisy/M004 Vyúčtovanie nájmu";
const M005 = "Spisy/M005 Pošta";
const profile = '---\ntype: working-profile\nfolders: ["Posta/Nezaradene","01_Podklady"]\nfolder_roles: {"inbox":"Posta/Nezaradene","client_documents":"01_Podklady"}\ndocument_naming: "{date}_{description}"\n---\n';
const register = (...rows: string[]) => ["| ID | Prijaté | Zdroj | Originál | Stav | Výsledné záznamy |", "| --- | --- | --- | --- | --- | --- |", ...rows].join("\n");
const HRON: Tree = {
  "client.md": "---\ntitle: SYN Hron Technológie a. s.\n---\n",
  "00_Na_zatriedenie/.keep": "",
  "00_Na_zatriedenie/email-klient-SYN.txt": "SYN",
  [`${M004}/matter.md`]: "---\ntitle: Vyúčtovanie nájmu\n---\n",
  [`${M004}/00_Na_zatriedenie/.keep`]: "",
  [`${M004}/00_Na_zatriedenie/.DS_Store`]: "",
  [`${M004}/00_Na_zatriedenie/vyzva-sud-SYN.txt`]: "SYN",
  [`${M004}/01_Podklady/zmluva.pdf`]: "%PDF",
  [`${M005}/matter.md`]: "---\ntitle: Pošta\n---\n",
  [`${M005}/PRACOVNY-PROFIL.md`]: profile,
  [`${M005}/Posta/Nezaradene/sken 50%.pdf`]: "%PDF",
};
const TATRAN: Tree = { "client.md": "---\ntitle: SYN Tatran\n---\n" };

async function read(hronTree: Tree) {
  const scope = okfScope([hron, tatran], hron, ROOT);
  if (!scope) throw new Error("no scope");
  return readScopeMemory(fakeServer({ hron: hronTree, tatran: TATRAN }), scope, TODAY);
}

describe("N-A5-3: Na zaradenie ráta aj súbory v priečinkoch na nezaradené", () => {
  test("súbory vložené vo Finderi do priečinka klienta, prípadu a vlastného priečinka z profilu", async () => {
    const data = await read(HRON);
    expect(buildToday(data, TODAY).inputs).toHaveLength(3);
    const groups = inputGroups(data);
    expect(groups.map((group) => group.client)).toEqual(["SYN Hron Technológie a. s."]);
    expect(groups[0]!.rows.map((row) => [row.label, row.matter?.title ?? null]).sort()).toEqual([
      ["email-klient-SYN.txt", null],
      ["sken 50%.pdf", "Pošta"],
      ["vyzva-sud-SYN.txt", "Vyúčtovanie nájmu"],
    ]);
    // Domov klienta ráta tie isté nezaradené vstupy ako Dnes.
    expect(inputCounts(data.inputs, data.matters.map((m) => m.path), data.clients)).toEqual({ processed: 0, waiting: 0, unfiled: 3 });
  });

  test("súbor s riadkom vo VSTUPY.md sa ráta podľa riadku, nie druhýkrát (IN-901 z testu)", async () => {
    const data = await read({
      ...HRON,
      "VSTUPY.md": register("| IN-901 | 2026-10-25 | e-mail | [email-klient-SYN.txt](00_Na_zatriedenie/email-klient-SYN.txt) | pending | |"),
      [`${M004}/VSTUPY.md`]: register("| IN-901 | 2026-10-25 | súd | [vyzva-sud-SYN.txt](./00_Na_zatriedenie/vyzva-sud-SYN.txt) | pending | |"),
    });
    expect(unfiledInputs(data).map((input) => input.id).sort()).toEqual(["", "IN-901", "IN-901"]);
    // Spracovaný riadok so súborom, ktorý ešte leží v priečinku: rozhoduje riadok.
    const processed = await read({
      ...HRON,
      [`${M004}/VSTUPY.md`]: register("| IN-902 | 2026-10-25 | súd | [vyzva](00_Na_zatriedenie/vyzva-sud-SYN.txt) | processed | M004-E1 |"),
    });
    expect(inputGroups(processed).flatMap((group) => group.rows).map((row) => row.label).sort()).toEqual(["email-klient-SYN.txt", "sken 50%.pdf"]);
  });

  test("prázdny priečinok na nezaradené (len .keep) a súbor mimo neho nič nepridajú", async () => {
    const data = await read({ ...TATRAN, "00_Na_zatriedenie/.keep": "", "Spisy/M001/matter.md": "---\ntitle: M001\n---\n", "Spisy/M001/01_Podklady/a.pdf": "%PDF" });
    expect(buildToday(data, TODAY).inputs).toEqual([]);
  });
});
