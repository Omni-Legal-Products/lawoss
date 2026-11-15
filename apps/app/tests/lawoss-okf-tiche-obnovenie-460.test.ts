// #460: tichá obnova prehľadu OKF nad nezmeneným stromom nevypisuje priečinky ani nečíta súbory; zmena mimo appky
// (úprava na mieste, nový súbor) sa ukáže pri ďalšej obnove. Disk je syntetický v pamäti, `stat` ako na serveri.
import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { okfOverviewQueryOptions, okfScope, readScopeMemory, OKF_FULL_READ_MS, type OkfReadResult, type OkfScopeClient } from "../src/lawoss/okf/read-model";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";

const OLD = 1_700_000_000_000;
const DAY = "2026-11-15";
type Node = { kind: "dir"; mtime: number } | { kind: "file"; content: string; mtime: number };
const parent = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

function fakeDisk() {
  const disks = new Map<string, Map<string, Node>>();
  const calls = { list: 0, content: 0, token: 0 };
  const disk = (ws: string) => { let d = disks.get(ws); if (!d) { d = new Map([["", { kind: "dir", mtime: OLD }]]); disks.set(ws, d); } return d; };
  /** Nový súbor zmení čas zmeny priečinka (a nového priečinka v rodičovi), úprava na mieste nie (ako na disku). */
  const write = (ws: string, path: string, content: string, mtime = OLD) => {
    const d = disk(ws);
    if (!d.has(path)) {
      for (let dir = parent(path); ; dir = parent(dir)) {
        const existed = d.has(dir);
        d.set(dir, { kind: "dir", mtime });
        if (existed || dir === "") break;
      }
    }
    d.set(path, { kind: "file", content, mtime });
  };
  const client: OkfScopeClient = {
    listWorkspaceDirectory: async (ws, path) => {
      calls.list++;
      const d = disk(ws);
      if (d.get(path)?.kind !== "dir") throw new Error(`404 ${path}`);
      const entries = [...d].filter(([p]) => p !== path && parent(p) === path).map(([p, node]) => ({ name: p.slice(p.lastIndexOf("/") + 1), path: p, kind: node.kind,
        ...(node.kind === "file" ? { size: node.content.length, updatedAt: node.mtime } : {}) }));
      return { path, truncated: false, entries };
    },
    readWorkspaceFile: async (ws, path) => {
      calls.content++;
      const node = disk(ws).get(path);
      if (node?.kind !== "file") throw new Error(`404 ${path}`);
      return { path, content: node.content, bytes: node.content.length, updatedAt: node.mtime };
    },
    lawossOfficeMemory: async (expected) => ({ practiceRoot: expected, directory: null, files: [], problems: [], truncated: false }),
    lawossOkfChangeToken: async (ws, paths) => {
      calls.token++;
      const d = disk(ws);
      const states = paths.map((p) => { const node = d.get(p); return node ? node.kind === "file" ? ["file", node.content.length, node.mtime] : ["dir", node.mtime] : ["missing"]; });
      return { token: JSON.stringify(states), newest: Math.max(0, ...paths.map((p) => d.get(p)?.mtime ?? 0)) };
    },
  };
  return { client, calls, write, disk };
}

const card = (title: string) => `---\ntitle: ${title}\nmatter_kind: advisory\n---\n`;
function practice(clients: number) {
  const fake = fakeDisk();
  const workspaces: RouteWorkspace[] = [];
  for (let i = 1; i <= clients; i++) {
    const id = `C${String(i).padStart(3, "0")}`;
    workspaces.push({ id, path: `/practice/Klienti/${id}`, name: id, workspaceType: "local" });
    fake.write(id, "client.md", `---\ntitle: SYN klient ${id}\n---\n`);
    for (let m = 1; m <= 3; m++) fake.write(id, `Spisy/M${m}/matter.md`, card(`SYN vec ${id}-${m}`));
  }
  const scope = okfScope(workspaces, workspaces[0]!, "/practice")!;
  return { ...fake, scope };
}
const titles = (result: OkfReadResult) => result.inputs.map((input) => String(input.cardFrontmatter?.title));
const reset = (calls: { list: number; content: number; token: number }) => { calls.list = 0; calls.content = 0; calls.token = 0; };

test("tichá obnova nad nezmeneným stromom 24 klientov: žiadny výpis priečinka ani čítanie súboru", async () => {
  const { client, calls, scope } = practice(24);
  let clock = OLD + 3_600_000;
  const now = () => clock;
  const first = await readScopeMemory(client, scope, DAY, { now });
  expect(first.coverage.status).toBe("complete");
  expect(first.inputs).toHaveLength(72);
  const full = { ...calls };
  reset(calls);
  clock += 15_000;
  const idle = await readScopeMemory(client, scope, DAY, { now, previous: first });
  console.log(`#460 úplné čítanie: list=${full.list} content=${full.content} token=${full.token}; tichá obnova: list=${calls.list} content=${calls.content} token=${calls.token}`);
  expect({ list: calls.list, content: calls.content, token: calls.token }).toEqual({ list: 0, content: 0, token: 24 });
  expect(titles(idle)).toEqual(titles(first));
  expect(idle.coverage.status).toBe("complete");
  expect(idle.coverage.sources.every((source) => source.checkedAt === clock && source.lastSuccessAt === clock)).toBe(true);
});

test("úprava karty na mieste (čas priečinka sa nezmení) sa ukáže pri ďalšej obnove; číta sa len zmenený klient", async () => {
  const { client, calls, scope, write, disk } = practice(3);
  let clock = OLD + 3_600_000;
  const now = () => clock;
  const first = await readScopeMemory(client, scope, DAY, { now });
  const dirMtime = disk("C002").get("Spisy/M1");
  write("C002", "Spisy/M1/matter.md", card("SYN zmenená mimo appky"), OLD + 60_000);
  expect(disk("C002").get("Spisy/M1")).toEqual(dirMtime);
  reset(calls);
  clock += 15_000;
  const next = await readScopeMemory(client, scope, DAY, { now, previous: first });
  expect(titles(next)).toContain("SYN zmenená mimo appky");
  expect(calls.token).toBe(3 + 1);
  expect(calls.list).toBeGreaterThan(0);
  const listsForOneClient = calls.list;
  reset(calls);
  clock += 15_000;
  const after = await readScopeMemory(client, scope, DAY, { now, previous: next });
  expect(titles(after)).toEqual(titles(next));
  expect(calls.list).toBe(0);
  expect(listsForOneClient).toBeLessThan(3 * 6);
});

test("nový spis vložený vo Finderi sa ukáže pri ďalšej obnove", async () => {
  const { client, scope, write } = practice(2);
  let clock = OLD + 3_600_000;
  const now = () => clock;
  const first = await readScopeMemory(client, scope, DAY, { now });
  write("C001", "Spisy/M4/matter.md", card("SYN nový spis"), OLD + 60_000);
  clock += 15_000;
  const next = await readScopeMemory(client, scope, DAY, { now, previous: first });
  expect(titles(next)).toContain("SYN nový spis");
});

test("zmena počas úplného čítania: odtlačok sa nepoužije a ďalšia obnova číta celý strom", async () => {
  const { client, calls, scope } = practice(2);
  let clock = OLD + 3_600_000;
  const now = () => clock;
  const first = await readScopeMemory({ ...client, lawossOkfChangeToken: async (ws, paths) => ({ ...(await client.lawossOkfChangeToken!(ws, paths)), newest: clock }) }, scope, DAY, { now });
  reset(calls);
  clock += 15_000;
  await readScopeMemory(client, scope, DAY, { now, previous: first });
  expect(calls.list).toBeGreaterThan(0);
});

test("záloha: po OKF_FULL_READ_MS sa číta celý strom aj pri rovnakom odtlačku (disk bez spoľahlivého času zmeny)", async () => {
  const { client, calls, scope } = practice(2);
  let clock = OLD + 3_600_000;
  const now = () => clock;
  let result = await readScopeMemory(client, scope, DAY, { now });
  for (clock += 15_000; clock < OLD + 3_600_000 + OKF_FULL_READ_MS; clock += 15_000) {
    reset(calls);
    result = await readScopeMemory(client, scope, DAY, { now, previous: result });
    expect(calls.list).toBe(0);
  }
  reset(calls);
  result = await readScopeMemory(client, scope, DAY, { now, previous: result });
  expect(calls.list).toBeGreaterThan(0);
});

test("iný deň, vynútené čítanie a server bez odtlačku čítajú celý strom", async () => {
  const { client, calls, scope } = practice(2);
  const now = () => OLD + 3_600_000;
  const first = await readScopeMemory(client, scope, DAY, { now });
  for (const run of [
    () => readScopeMemory(client, scope, "2026-11-16", { now, previous: first }),
    () => readScopeMemory(client, scope, DAY, { now, previous: first, fullRead: true }),
    () => readScopeMemory({ ...client, lawossOkfChangeToken: undefined }, scope, DAY, { now, previous: first }),
  ]) {
    reset(calls);
    await run();
    expect(calls.list).toBeGreaterThan(0);
  }
});

test("prehľad cez query: interval obnovy nečíta strom, invalidácia (vlastná akcia appky) áno; klienti ostávajú ten istý objekt", async () => {
  const { client, calls, scope } = practice(3);
  const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const connection = { client, baseUrl: "http://synthetic", token: "synthetic", authGeneration: 1 };
  const options = okfOverviewQueryOptions(connection, scope, DAY, queries);
  try {
    await queries.fetchQuery({ ...options, staleTime: 0 });
    const first = queries.getQueryData<OkfReadResult>(options.queryKey)!;
    reset(calls);
    await queries.fetchQuery({ ...options, staleTime: 0 });
    expect(calls.list).toBe(0);
    // Štrukturálne zdieľanie: `useRootCards` v bočnom paneli číta karty znova len pri zmene klientov.
    expect(queries.getQueryData<OkfReadResult>(options.queryKey)!.clients).toBe(first.clients);
    await queries.invalidateQueries({ queryKey: options.queryKey });
    reset(calls);
    await queries.fetchQuery({ ...options, staleTime: 0 });
    expect(calls.list).toBeGreaterThan(0);
  } finally { queries.clear(); }
});
