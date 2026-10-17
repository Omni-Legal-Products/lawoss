import { describe, expect, test } from "bun:test";

import { LAYER_OF, type RecordType } from "../../../lawoss/okf-pamat/src/schema.ts";
import { serializeRecord, type OkfRecord } from "../../../lawoss/okf-pamat/src/record.ts";
import { buildCockpit } from "../../../lawoss/okf/cockpit";
import { canActOnSource, excludedWorkspaceIds, localMatter, locateInScope, okfScope, okfScopeKey, readScopeMemory, readWorkspaceMemory, type OkfScopeClient } from "../src/lawoss/okf/read-model";
import type { OfficeMemoryRead } from "../src/lawoss/okf/office-memory";
import { buildToday, groupByClient } from "../src/lawoss/lite/today-model";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";

/**
 * N1 (test OKF 16. 10. 2026, rozhodnutie MČ 16. 10.): pri „každý klient zvlášť“ je každý klient
 * samostatný pracovný priečinok a koreň praxe sa neregistruje. Pohľady aj tak ukazujú celú prax.
 */
const TODAY = "2026-10-16";
const ROOT = "/Users/advokat/AK Synteticka/Klienti";

const ws = (id: string, path: string, workspaceType: "local" | "remote" = "local"): RouteWorkspace => ({ id, path, name: id, displayNameResolved: id, workspaceType });
const alfa = ws("alfa", `${ROOT}/ALFA STAV s.r.o.`);
const horak = ws("horak", `${ROOT}/Horák s.r.o.`);
const alfaMatter = ws("alfa-vec", `${ROOT}/ALFA STAV s.r.o./Spisy/2026-03 Spor BETA`);
const outside = ws("iny", "/Users/advokat/Iná prax/Klient");

function rec(type: RecordType, id: string, extra: Partial<OkfRecord> = {}): string {
  return serializeRecord({
    okf: 1, id, type, title: `${type} ${id}`, description: "syntetický záznam", layer: LAYER_OF[type],
    jurisdiction: "sk", status: "active", created: "2026-10-01", updated: "2026-10-01", truth: "Nič.",
    timeline: [{ date: "2026-10-01", text: "založené", kind: "created" }], ...extra,
  });
}

type Tree = Record<string, string>;
/** Falošný server: súbory podľa id pracovného priečinka, pamäť kancelárie zvlášť (ako hostiteľ). */
function fakeServer(trees: Record<string, Tree>, office?: OfficeMemoryRead, log: string[] = []): OkfScopeClient {
  const tree = (id: string): Tree => {
    const files = trees[id];
    if (!files) throw new Error(`404 workspace ${id}`);
    return files;
  };
  return {
    listWorkspaceDirectory: async (id, path) => {
      log.push(`list ${id} ${path}`);
      const prefix = path ? `${path}/` : "";
      const names = new Map<string, "file" | "dir">();
      for (const p of Object.keys(tree(id))) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        names.set(rest.split("/")[0], rest.includes("/") ? "dir" : "file");
      }
      if (names.size === 0) throw new Error(`404 ${path}`);
      return { path, truncated: false, entries: [...names].map(([name, kind]) => ({ name, kind, path: `${prefix}${name}` })) };
    },
    readWorkspaceFile: async (id, path) => {
      const content = tree(id)[path];
      if (content === undefined) throw new Error(`404 ${path}`);
      return { path, content, bytes: content.length, updatedAt: 0 };
    },
    ...(office ? { lawossOfficeMemory: async () => office } : {}),
  };
}

const ALFA_TREE: Tree = {
  "client.md": "---\ntitle: ALFA STAV s.r.o.\nclient_type: po\n---\n",
  "Spisy/2026-03 Spor BETA/matter.md": "---\ntitle: Spor BETA\nspisova_znacka: 18Cb/47/2026\n---\n",
  "Spisy/2026-03 Spor BETA/memory/E-001-replika.md": rec("evidence", "E-001", { title: "Replika", deadlines: ["2026-10-21"] }),
};
const HORAK_TREE: Tree = {
  "client.md": "---\ntitle: Horák s.r.o.\nclient_type: po\n---\n",
  "Spisy/2026-09 Platobný rozkaz/matter.md": "---\ntitle: Platobný rozkaz\n---\n",
  "Spisy/2026-09 Platobný rozkaz/memory/E-001-odpor.md": rec("evidence", "E-001", { title: "Odpor", deadlines: ["2026-10-23"] }),
};
const OFFICE: OfficeMemoryRead = {
  practiceRoot: ROOT,
  directory: "Office",
  files: [{ path: "Office/memory/T-001-poistka.md", content: rec("task", "T-001", { title: "Obnoviť poistku", deadlines: ["2026-10-30"] }) }],
  problems: [],
  truncated: false,
};

describe("okfScope: koho pohľady čítajú", () => {
  test("klient praxe → všetci registrovaní klienti pod koreňom, vnorená vec ani cudzí priečinok nie", () => {
    const scope = okfScope([alfa, horak, alfaMatter, outside], alfa, ROOT);
    expect(scope?.practiceRoot).toBe(ROOT);
    expect(scope?.members.map((m) => [m.workspace.id, m.prefix])).toEqual([["alfa", "ALFA STAV s.r.o."], ["horak", "Horák s.r.o."]]);
    // Aktívna vec (rýchla akcia) patrí do tej istej praxe.
    expect(okfScope([alfa, horak, alfaMatter], alfaMatter, ROOT)?.members.map((m) => m.workspace.id)).toEqual(["alfa", "horak"]);
  });

  test("bez praxe, mimo praxe a pri vzdialenom priečinku ostáva jeden priečinok", () => {
    expect(okfScope([alfa, horak], alfa, null)).toEqual({ anchor: alfa, members: [{ workspace: alfa, prefix: "" }] });
    expect(okfScope([alfa, horak, outside], outside, ROOT)?.members.map((m) => m.workspace.id)).toEqual(["iny"]);
    const remote = ws("r", `${ROOT}/Vzdialený`, "remote");
    expect(okfScope([alfa, remote], remote, ROOT)?.practiceRoot).toBeUndefined();
    expect(okfScope([alfa], null, ROOT)).toBeNull();
  });

  test("prax ako jeden priečinok (R8): registrovaný koreň je jediný člen", () => {
    const root = ws("prax", ROOT);
    expect(okfScope([root, alfa], alfa, ROOT)).toEqual({ anchor: alfa, members: [{ workspace: root, prefix: "" }] });
  });

  test("koreň s lomkou na konci a spätné lomky z Windows dajú tú istú predponu", () => {
    const winRoot = "C:\\AK\\Klienti\\";
    const client = ws("c", "C:\\AK\\Klienti\\Novák Peter");
    expect(okfScope([client], client, winRoot)?.members[0]?.prefix).toBe("Novák Peter");
  });
});

describe("readScopeMemory: jeden prehľad praxe", () => {
  const server = fakeServer({ alfa: ALFA_TREE, horak: HORAK_TREE }, OFFICE);
  const read = (anchor: RouteWorkspace) => {
    const scope = okfScope([alfa, horak, alfaMatter], anchor, ROOT);
    if (!scope) throw new Error("no scope");
    return { scope, result: readScopeMemory(server, scope, TODAY) };
  };

  test("lehota iného klienta je v prehľade, aj keď je otvorená ALFA (N1)", async () => {
    const data = await read(alfa).result;
    expect(data.problems).toEqual([]);
    expect(data.upcomingDeadlines.map((d) => [d.date, d.title, d.matter.path])).toEqual([
      ["2026-10-21", "Replika", "ALFA STAV s.r.o./Spisy/2026-03 Spor BETA"],
      ["2026-10-23", "Odpor", "Horák s.r.o./Spisy/2026-09 Platobný rozkaz"],
      ["2026-10-30", "Obnoviť poistku", "ALFA STAV s.r.o./Spisy/2026-03 Spor BETA"],
      ["2026-10-30", "Obnoviť poistku", "Horák s.r.o./Spisy/2026-09 Platobný rozkaz"],
    ]);
    // Po prepnutí na Horáka nezmiznú lehoty ALFY: ten istý výsledok.
    expect((await read(horak).result).upcomingDeadlines).toEqual(data.upcomingDeadlines);
    // Rovnaké ID E-001 u dvoch klientov sú dva záznamy; zdieľaná úloha kancelárie je jedna.
    expect(data.totals).toMatchObject({ matters: 2, deadlinesWithin7Days: 2, openTasks: 1, records: 3 });
    expect(data.clients).toEqual([{ path: "ALFA STAV s.r.o.", title: "ALFA STAV s.r.o." }, { path: "Horák s.r.o.", title: "Horák s.r.o." }]);
  });

  test("pamäť kancelárie praxe je v rozsahu každej veci ako úroveň kancelárie", async () => {
    const data = await read(alfa).result;
    const input = data.inputs.find((i) => i.path.startsWith("Horák"));
    expect(input?.scopePaths).toEqual(["Horák s.r.o./Spisy/2026-09 Platobný rozkaz", "Horák s.r.o.", "Office"]);
    expect(input?.recordFiles).toEqual({
      "E-001": "Horák s.r.o./Spisy/2026-09 Platobný rozkaz/memory/E-001-odpor.md",
      "T-001": "Office/memory/T-001-poistka.md",
    });
  });

  test("ADR 0014 bod 4: tá istá lehota v Dnes, v detaile veci, u klienta aj v bočnom paneli", async () => {
    const data = await read(alfa).result;
    const odpor = "Horák s.r.o./Spisy/2026-09 Platobný rozkaz";
    const today = buildToday(data, TODAY);
    expect(today.deadlines.find((d) => d.title === "Odpor")).toMatchObject({ date: "2026-10-23", matter: { path: odpor, title: "Platobný rozkaz" } });
    expect(today.recent.map((m) => m.path)).toContain(odpor);
    const cockpit = buildCockpit(data, odpor, TODAY);
    expect([...(cockpit?.deadlines.confirmed ?? []), ...(cockpit?.deadlines.candidates ?? [])].map((d) => [d.date, d.title]).sort()).toEqual([["2026-10-23", "Odpor"], ["2026-10-30", "Obnoviť poistku"]]);
    const groups = groupByClient(data.matters, data.inputs, data.clients);
    expect(groups.map((g) => [g.client, g.matters.map((m) => m.path)])).toEqual([
      ["ALFA STAV s.r.o.", ["ALFA STAV s.r.o./Spisy/2026-03 Spor BETA"]],
      ["Horák s.r.o.", [odpor]],
    ]);
  });

  test("chyba jedného klienta nezhodí prehľad, problém nesie cestu v praxi", async () => {
    const broken = fakeServer({ alfa: ALFA_TREE, horak: { ...HORAK_TREE, "Spisy/2026-09 Platobný rozkaz/memory/E-002-zle.md": "bez frontmatteru" } }, OFFICE);
    const scope = okfScope([alfa, horak], alfa, ROOT);
    if (!scope) throw new Error("no scope");
    const data = await readScopeMemory(broken, scope, TODAY);
    expect(data.upcomingDeadlines.map((d) => d.title)).toContain("Replika");
    expect(data.problems.map((p) => p.path)).toEqual(["Horák s.r.o./Spisy/2026-09 Platobný rozkaz/memory/E-002-zle.md"]);
  });

  test("nedostupná pamäť kancelárie je problém kancelárie, klienti sa prečítajú", async () => {
    const failing: OkfScopeClient = { ...fakeServer({ alfa: ALFA_TREE, horak: HORAK_TREE }), lawossOfficeMemory: async () => { throw new Error("401 Invalid host token"); } };
    const scope = okfScope([alfa, horak], alfa, ROOT);
    if (!scope) throw new Error("no scope");
    const data = await readScopeMemory(failing, scope, TODAY);
    expect(data.upcomingDeadlines.map((d) => d.title)).toEqual(["Replika", "Odpor"]);
    expect(data.problems).toEqual([{ path: "Office", message: "401 Invalid host token", scope: "office" }]);
  });

  test("mimo praxe je výsledok zhodný s čítaním jedného priečinka", async () => {
    const single = fakeServer({ alfa: ALFA_TREE });
    const scope = okfScope([alfa], alfa, null);
    if (!scope) throw new Error("no scope");
    const actual = await readScopeMemory(single, scope, TODAY);
    const expected = await readWorkspaceMemory(single, "alfa", TODAY);
    expect(actual.inputs).toEqual(expected.inputs);
    expect(actual.matters).toEqual(expected.matters);
    expect(actual.totals).toEqual(expected.totals);
    expect(actual.clients).toEqual(expected.clients);
    expect(actual.problems).toEqual(expected.problems);
  });
});

describe("akcie bežia v priečinku klienta veci, nie nad praxou", () => {
  test("cesta z prehľadu sa preloží na priečinok klienta a cestu v ňom", async () => {
    const scope = okfScope([alfa, horak], alfa, ROOT);
    if (!scope) throw new Error("no scope");
    expect(locateInScope(scope, "Horák s.r.o./Spisy/2026-09 Platobný rozkaz/memory/E-001-odpor.md")).toEqual({ workspace: horak, path: "Spisy/2026-09 Platobný rozkaz/memory/E-001-odpor.md" });
    expect(locateInScope(scope, "Horák s.r.o.")).toEqual({ workspace: horak, path: "" });
    // Súbor kancelárie praxe nepatrí žiadnemu klientovi.
    expect(locateInScope(scope, "Office/memory/T-001-poistka.md")).toBeNull();
    // „Horák s.r.o. 2“ nie je v priečinku „Horák s.r.o.“.
    expect(locateInScope(scope, "Horák s.r.o. 2/vec")).toBeNull();

    const data = await readScopeMemory(fakeServer({ alfa: ALFA_TREE, horak: HORAK_TREE }, OFFICE), scope, TODAY);
    const matter = data.matters.find((m) => m.path.startsWith("Horák"));
    if (!matter) throw new Error("no matter");
    const local = localMatter(scope, matter, data.matters);
    expect(local?.workspace.id).toBe("horak");
    expect(local?.selected.path).toBe("Spisy/2026-09 Platobný rozkaz");
    expect(local?.selected.cardPath).toBe("Spisy/2026-09 Platobný rozkaz/matter.md");
    // Rýchla akcia vidí len veci toho istého klienta.
    expect(local?.discovered.map((m) => m.path)).toEqual(["Spisy/2026-09 Platobný rozkaz"]);
    expect(local?.discovered).toContain(local?.selected);
  });
});


describe("practice coverage and identity", () => {
  test("scope identity is independent of anchor and includes paths", () => {
    const a = okfScope([alfa, horak], alfa, ROOT)!;
    const b = okfScope([horak, alfa], horak, ROOT)!;
    expect(okfScopeKey(a)).toBe(okfScopeKey(b));
    expect(okfScopeKey(a)).not.toBe(okfScopeKey({ ...a, members: [{ workspace: { ...alfa, path: `${ROOT}/Moved` }, prefix: "ALFA STAV s.r.o." }] }));
  });
  test("root_read_failure_keeps_last_success_as_stale", async () => {
    const scope = okfScope([alfa, horak], alfa, ROOT)!;
    const previous = await readScopeMemory(fakeServer({ alfa: ALFA_TREE, horak: HORAK_TREE }, OFFICE), scope, TODAY, { now: () => 100 });
    const data = await readScopeMemory(fakeServer({ alfa: ALFA_TREE }, OFFICE), scope, TODAY, { previous, now: () => 200 });
    expect(data.upcomingDeadlines.map(d => d.title)).toContain("Odpor");
    expect(data.coverage.status).toBe("partial");
    expect(data.coverage.sources.find(s => s.workspaceId === "horak")).toMatchObject({ state: "stale", checkedAt: 200, lastSuccessAt: 100 });
  });
  test("all_sources_failed_is_not_empty_success", async () => {
    const scope = okfScope([alfa, horak], alfa, ROOT)!;
    const data = await readScopeMemory(fakeServer({}), scope, TODAY);
    expect(data.coverage.status).toBe("failed");
    expect(data.coverage.sources.every(s => s.state === "unavailable")).toBe(true);
  });
  test("scope change cannot reuse previous clients", async () => {
    const scope = okfScope([alfa, horak], alfa, ROOT)!;
    const previous = await readScopeMemory(fakeServer({ alfa: ALFA_TREE, horak: HORAK_TREE }, OFFICE), scope, TODAY);
    const next = okfScope([alfa], alfa, ROOT)!;
    const data = await readScopeMemory(fakeServer({}, OFFICE), next, TODAY, { previous });
    expect(data.matters).toEqual([]);
  });
  test("traversal and ambiguous aliases cannot route an action", () => {
    const scope = okfScope([alfa, horak], alfa, ROOT)!;
    expect(locateInScope(scope, "ALFA STAV s.r.o./../Horák s.r.o./secret")).toBeNull();
    expect(okfScope([alfa, { ...alfa, id: "alias" }], alfa, ROOT)).toBeNull();
  });
});


test("three_clients_and_empty_client_share_scope_from_every_anchor", async () => {
  const gamma = ws("gamma", `${ROOT}/GAMMA`), empty = ws("empty", `${ROOT}/Empty`);
  const workspaces = [alfa, horak, gamma, empty, alfaMatter, outside];
  const gammaTree = { "client.md": "---\ntitle: GAMMA\n---", "Spisy/2026-10 Task/matter.md": "---\ntitle: Task\n---", "Spisy/2026-10 Task/memory/E-001.md": rec("task", "E-001", { deadlines: ["2026-10-22"] }) };
  const server = fakeServer({ alfa: ALFA_TREE, horak: HORAK_TREE, gamma: gammaTree, empty: { "client.md": "---\ntitle: Empty\n---" } }, OFFICE);
  const keys = new Set<string>();
  for (const anchor of [alfa, horak, gamma, empty, alfaMatter]) {
    const scope = okfScope(workspaces, anchor, ROOT)!;
    keys.add(okfScopeKey(scope));
    const data = await readScopeMemory(server, scope, TODAY);
    expect(data.clients).toHaveLength(4);
    expect(data.matters).toHaveLength(3);
    expect(data.totals).toMatchObject({ records: 4, openTasks: 2 });
    expect(data.coverage.status).toBe("complete");
    expect(excludedWorkspaceIds(workspaces,scope)).toEqual([outside.id]);
  }
  expect(keys.size).toBe(1);
});

test("successful empty replaces stale data and stale source cannot act", async () => {
  const scope = okfScope([alfa,horak],alfa,ROOT)!;
  const previous = await readScopeMemory(fakeServer({ alfa: ALFA_TREE, horak: HORAK_TREE },OFFICE),scope,TODAY,{ now: () => 100 });
  const stale = await readScopeMemory(fakeServer({ alfa: ALFA_TREE },OFFICE),scope,TODAY,{ previous, now: () => 200 });
  expect(canActOnSource(stale,"alfa")).toBe(true);
  expect(canActOnSource(stale,"horak")).toBe(false);
  const restored = await readScopeMemory(fakeServer({ alfa: ALFA_TREE, horak: { "client.md": "---\ntitle: Horak\n---" } },OFFICE),scope,TODAY,{ previous: stale, now: () => 300 });
  expect(restored.coverage.status).toBe("complete");
  expect(restored.matters).toHaveLength(1);
  expect(restored.clients).toHaveLength(2);
});

test("office snapshot remains stale after failed scope-bound read", async () => {
  const scope = okfScope([alfa,horak],alfa,ROOT)!;
  const previous = await readScopeMemory(fakeServer({ alfa: ALFA_TREE, horak: HORAK_TREE },OFFICE),scope,TODAY,{ now: () => 100 });
  const data = await readScopeMemory(fakeServer({ alfa: ALFA_TREE, horak: HORAK_TREE }, { ...OFFICE, practiceRoot: "/foreign" }),scope,TODAY,{ previous, now: () => 200 });
  expect(data.totals.openTasks).toBe(1);
  expect(data.coverage.sources.find(s => s.source === "office")).toMatchObject({ state: "stale", lastSuccessAt: 100, checkedAt: 200 });
});

test("cancelled scope read never publishes even if transport ignores cancellation", async () => {
  const scope = okfScope([alfa],alfa,ROOT)!;
  const controller = new AbortController();
  const server = fakeServer({ alfa: ALFA_TREE },OFFICE);
  const original = server.listWorkspaceDirectory;
  server.listWorkspaceDirectory = async (...args) => { controller.abort(); return original(...args); };
  await expect(readScopeMemory(server,scope,TODAY,{ signal: controller.signal })).rejects.toThrow();
});


test("windows case aliases and UNC roots never duplicate", () => {
  const one = ws("one", "C:\\AK\\Client"), alias = ws("alias", "c:/ak/client");
  expect(okfScope([one,alias],one,"C:/AK")).toBeNull();
  const unc = ws("unc", "\\\\server\\share\\Client");
  expect(okfScope([unc],unc,"\\\\server\\share")?.members[0].prefix).toBe("Client");
});


test("office records without any matter cannot be reported as a complete empty overview", async () => {
  const scope = okfScope([alfa],alfa,ROOT)!;
  const data = await readScopeMemory(fakeServer({ alfa: { "client.md": "---\ntitle: ALFA\n---" } },OFFICE),scope,TODAY);
  expect(data.coverage.status).toBe("partial");
  expect(data.problems.some(p => p.scope === "office")).toBe(true);
});
