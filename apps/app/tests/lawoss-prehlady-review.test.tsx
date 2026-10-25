import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LAYER_OF, type RecordType } from "../../../lawoss/okf-pamat/src/schema.ts";
import { serializeRecord, type OkfRecord } from "../../../lawoss/okf-pamat/src/record.ts";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ClientOverviewFrom } from "../src/lawoss/lite/client-overview";
import { clientNavModel } from "../src/lawoss/lite/client-projects";
import { linkedFoldersKey } from "../src/lawoss/lite/linked-folders-view";
import { groupByClient } from "../src/lawoss/lite/today-model";
import type { OkfConnection } from "../src/lawoss/okf/connection";
import { okfScope, readScopeMemory, type OkfScopeClient } from "../src/lawoss/okf/read-model";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";

// Review VŘ k #246 (6cbb3fb8): Domov klienta počíta len svoje prípady, termíny a vstupy.

const TODAY = "2026-10-16";
const ROOT = "/Users/advokat/AK Synteticka/Klienti";
const ws = (id: string, path: string): RouteWorkspace => ({ id, path, name: id, displayNameResolved: id, workspaceType: "local" });
const alfa = ws("alfa", `${ROOT}/ALFA STAV s.r.o.`);
const horak = ws("horak", `${ROOT}/Horák s.r.o.`);
const nested = ws("vnoreny", `${ROOT}/ALFA STAV s.r.o./C099 SYN Vnoreny`);

const rec = (type: RecordType, id: string, extra: Partial<OkfRecord> = {}): string => serializeRecord({
  okf: 1, id, type, title: `${type} ${id}`, description: "syntetický záznam", layer: LAYER_OF[type],
  jurisdiction: "sk", status: "active", created: "2026-10-01", updated: "2026-10-01", truth: "Nič.",
  timeline: [{ date: "2026-10-01", text: "založené", kind: "created" }], ...extra,
});
const intake = (...rows: string[]) => ["| ID | Prijaté | Zdroj | Originál | Stav | Záznamy |", "|---|---|---|---|---|---|", ...rows].join("\n");

type Tree = Record<string, string>;
/** Falošný server: súbory podľa id pracovného priečinka; `broken` = súbor sa nedá prečítať (práva, placeholder). */
function fakeServer(trees: Record<string, Tree>, broken: readonly string[] = []): OkfScopeClient {
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
      if (broken.includes(`${id}:${path}`)) throw new Error("EACCES");
      const content = tree(id)[path];
      if (content === undefined) throw new Error(`404 ${path}`);
      return { path, content, bytes: content.length, updatedAt: 0 };
    },
  };
}

const ALFA_TREE: Tree = {
  "client.md": "---\ntitle: ALFA STAV s.r.o.\nclient_type: po\n---\n",
  "Spisy/2026-03 Spor BETA/matter.md": "---\ntitle: Spor BETA\n---\n",
  "Spisy/2026-03 Spor BETA/memory/E-001-replika.md": rec("evidence", "E-001", { title: "Replika", deadlines: ["2026-10-21"] }),
};
const HORAK_TREE: Tree = { "client.md": "---\ntitle: Horák s.r.o.\nclient_type: po\n---\n" };

/** Domov klienta tak, ako ho vykreslí panel: rozsah praxe, prehľad, skupiny a model panela z tých istých dát. */
async function home(workspaces: RouteWorkspace[], trees: Record<string, Tree>, workspaceId: string, broken: readonly string[] = []) {
  const scope = okfScope(workspaces, alfa, ROOT);
  if (!scope) throw new Error("no scope");
  const data = await readScopeMemory(fakeServer(trees, broken), scope, TODAY);
  const groups = groupByClient(data.matters, data.inputs, data.clients ?? []);
  const model = clientNavModel(workspaces, ROOT, { status: "ready", scope, groups, matters: data.matters });
  const connection: OkfConnection = { client: null, baseUrl: "http://127.0.0.1:9", token: "t", workspaces, activeWorkspaceId: workspaceId, authGeneration: 1 };
  const queries = new QueryClient();
  queries.setQueryData(linkedFoldersKey(connection, workspaceId), { folders: [], hiddenCount: 0, workspaceRoot: "" });
  const nav = { connection, scope, data, groups, model, excludedWorkspaceIds: [] };
  return { data, model, html: renderToStaticMarkup(
    <QueryClientProvider client={queries}><MemoryRouter><SidebarProvider><ClientOverviewFrom nav={nav} workspaceId={workspaceId} /></SidebarProvider></MemoryRouter></QueryClientProvider>,
  ) };
}

describe("P2: zaregistrovaný vnorený klient nepatrí na Domov vonkajšieho klienta", () => {
  const trees = {
    alfa: {
      ...ALFA_TREE,
      "C099 SYN Vnoreny/client.md": "---\ntitle: SYN Vnorený\n---\n",
      "C099 SYN Vnoreny/VSTUPY.md": intake("| IN-001 | 2026-10-01 | mail | [a.pdf](./M001 Cudzí spor/01_Podklady/a.pdf) | processed | E-001 |"),
      "C099 SYN Vnoreny/M001 Cudzí spor/matter.md": "---\ntitle: Cudzí spor\n---\n",
      "C099 SYN Vnoreny/M001 Cudzí spor/memory/E-001-lehota.md": rec("evidence", "E-001", { title: "Lehota vnoreného", deadlines: ["2026-10-22"] }),
    },
    horak: HORAK_TREE,
  };

  test("ALFA neukáže prípad, lehotu ani vstupy vnoreného klienta; svoje áno", async () => {
    const { data, model, html } = await home([alfa, horak, nested], trees, "alfa");
    // Predpoklad nálezu: vnorený klient je v prehľade aj s lehotou, panel ho skryje.
    expect(data.upcomingDeadlines.map((d) => d.title)).toContain("Lehota vnoreného");
    expect(model.hidden.has("vnoreny")).toBe(true);
    expect(html).toContain("Spor BETA");
    expect(html).toContain("Replika");
    expect(html).not.toContain("Cudzí spor");
    expect(html).not.toContain("Lehota vnoreného");
    expect(html).toContain('data-lawoss-inputs="unrecorded"');
  });

  test("nezaregistrovaný vnorený klient: prehľad ho vôbec nečíta, ALFA ostáva bez zmeny", async () => {
    const { html } = await home([alfa, horak], trees, "alfa");
    expect(html).toContain("Spor BETA");
    expect(html).not.toContain("Cudzí spor");
  });
});

describe("P3: vstupy klienta na Domove", () => {
  test("klient s VSTUPY.md bez prípadu: počty z registra, nie „neevidované“", async () => {
    const trees = {
      alfa: ALFA_TREE,
      horak: {
        ...HORAK_TREE,
        "VSTUPY.md": intake(
          "| IN-001 | 2026-10-01 | mail | [a.pdf](./00_Na_zatriedenie/a.pdf) | pending | |",
          "| IN-002 | 2026-10-02 | mail | [b.pdf](./00_Na_zatriedenie/b.pdf) | processed | |",
        ),
      },
    };
    const { data, html } = await home([alfa, horak], trees, "horak");
    expect(data.matters.some((m) => m.path.startsWith("Horák"))).toBe(false);
    expect(html).toContain('data-lawoss-inputs="2"');
    expect(html).toContain('<b>1</b> not filed');
    expect(html).not.toContain("Inputs are not recorded.");
  });

  test("klientsky register s prípadmi sa nezráta dvakrát", async () => {
    const trees = { alfa: { ...ALFA_TREE, "VSTUPY.md": intake("| IN-001 | 2026-10-01 | mail | [a.pdf](./Spisy/2026-03 Spor BETA/01_Podklady/a.pdf) | processed | E-001 |") }, horak: HORAK_TREE };
    const { html } = await home([alfa, horak], trees, "alfa");
    expect(html).toContain('data-lawoss-inputs="1"');
  });

  test("nečitateľný VSTUPY.md: „nenačítané“, nie „neevidované“", async () => {
    const trees = { alfa: ALFA_TREE, horak: { ...HORAK_TREE, "VSTUPY.md": intake("| IN-001 | 2026-10-01 | mail | a.pdf | pending | |") } };
    const { data, html } = await home([alfa, horak], trees, "horak", ["horak:VSTUPY.md"]);
    // Jeden problém na súbor, s cestou voči koreňu praxe.
    expect(data.problems.filter((p) => p.path.endsWith("VSTUPY.md")).map((p) => p.path)).toEqual(["Horák s.r.o./VSTUPY.md"]);
    expect(html).toContain('data-lawoss-inputs="not_loaded"');
    expect(html).toContain("The inputs register could not be read");
    expect(html).not.toContain("Inputs are not recorded.");
  });

  test("jeden z registrov sa nedá prečítať: počty z ostatných s upozornením „čiastočné“", async () => {
    const trees = {
      alfa: {
        ...ALFA_TREE,
        "VSTUPY.md": intake("| IN-001 | 2026-10-01 | mail | a.pdf | processed | |"),
        "Spisy/2026-03 Spor BETA/VSTUPY.md": intake("| IN-002 | 2026-10-02 | mail | b.pdf | processed | |"),
      },
      horak: HORAK_TREE,
    };
    const { html } = await home([alfa, horak], trees, "alfa", ["alfa:Spisy/2026-03 Spor BETA/VSTUPY.md"]);
    expect(html).toContain('data-lawoss-inputs="1"');
    expect(html).toContain("data-lawoss-inputs-partial");
    expect(html).toContain("the counts are incomplete");
  });

  test("problém v registri iného klienta Domov tohto klienta neovplyvní", async () => {
    const trees = { alfa: { ...ALFA_TREE, "VSTUPY.md": intake("| IN-001 | 2026-10-01 | mail | a.pdf | processed | |") }, horak: { ...HORAK_TREE, "VSTUPY.md": intake("") } };
    const { html } = await home([alfa, horak], trees, "alfa", ["horak:VSTUPY.md"]);
    expect(html).toContain('data-lawoss-inputs="1"');
    expect(html).not.toContain("data-lawoss-inputs-partial");
  });
});
