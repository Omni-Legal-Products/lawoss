import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchFileContents } from "../content-search.js";
import { DocumentPreparation } from "../document-preparation/service.js";
import { OcrManager } from "../ocr/manager.js";
import type { WorkspaceInfo } from "../types.js";
import { withSearchSlot } from "./search-admission.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
const deferred = () => { let resolve = () => {}; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; };

test("#465: najviac dve hľadania naraz, ďalšie v poradí; zrušené čakanie z radu odíde", async () => {
  const gates = [deferred(), deferred(), deferred()];
  const started: number[] = [];
  const run = (index: number, signal = new AbortController().signal) =>
    withSearchSlot("test-lane", signal, async () => { started.push(index); await gates[index]?.promise; return index; });
  const first = run(0), second = run(1);
  const cancelled = new AbortController();
  const third = run(2, cancelled.signal);
  const fourth = withSearchSlot("test-lane", new AbortController().signal, async () => { started.push(3); return 3; });
  await Bun.sleep(5);
  expect(started).toEqual([0, 1]);
  cancelled.abort(new Error("query changed"));
  await expect(third).rejects.toThrow("query changed");
  gates[0]?.resolve();
  expect(await first).toBe(0);
  expect(await fourth).toBe(3);
  expect(started).toEqual([0, 1, 3]);
  gates[1]?.resolve();
  expect(await second).toBe(1);
});

test("#465: plný rad odpovie 503 namiesto čakania; chyba hľadania uvoľní miesto", async () => {
  const gate = deferred();
  const signal = new AbortController().signal;
  const busy = withSearchSlot("full-lane", signal, () => gate.promise, { limit: 1, queueLimit: 1 });
  const queued = withSearchSlot("full-lane", signal, async () => "queued", { limit: 1, queueLimit: 1 });
  await expect(withSearchSlot("full-lane", signal, async () => "rejected", { limit: 1, queueLimit: 1 })).rejects.toMatchObject({ status: 503, code: "search_busy" });
  gate.resolve(); await busy;
  expect(await queued).toBe("queued");
  await expect(withSearchSlot("full-lane", signal, async () => { throw new Error("boom"); }, { limit: 1 })).rejects.toThrow("boom");
  expect(await withSearchSlot("full-lane", signal, async () => "free", { limit: 1 })).toBe("free");
});

test("#465: veľké hľadanie v mnohých priestoroch nezablokuje iné požiadavky servera", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-search-starve-")));
  const preparation = new DocumentPreparation(new OcrManager(join(root, ".ocr")));
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  cleanups.push(async () => { server.stop(true); preparation.stop(); await rm(root, { recursive: true, force: true }); });
  const workspaces: WorkspaceInfo[] = [];
  for (let client = 0; client < 8; client++) {
    const path = join(root, `Klient ${client}`);
    for (let dir = 0; dir < 20; dir++) {
      await mkdir(join(path, "Spisy", `Vec ${dir}`), { recursive: true });
      await Promise.all(Array.from({ length: 25 }, (_, file) => writeFile(join(path, "Spisy", `Vec ${dir}`, `dokument-${file}.txt`), "Obsah zmluvy o dielo ".repeat(400))));
    }
    await mkdir(join(path, ".opencode", "cache"), { recursive: true });
    await writeFile(join(path, ".opencode", "cache", "sken-2026-skryty.txt"), "");
    workspaces.push({ id: `w${client}`, name: `Klient ${client}`, path, preset: "starter", workspaceType: "local" });
  }
  await writeFile(join(root, "Klient 7", "Spisy", "Vec 19", "sken-2026-11-13.txt"), "");
  const latencies: number[] = [];
  let searching = true;
  const probe = (async () => {
    while (searching) {
      const started = performance.now();
      await (await fetch(`http://127.0.0.1:${server.port}/`)).text();
      latencies.push(performance.now() - started);
      await Bun.sleep(20);
    }
  })();
  const signal = new AbortController().signal;
  const results = await Promise.all(workspaces.flatMap(workspace => [0, 1].map(() =>
    withSearchSlot("starve-files", signal, () => searchFileContents(workspace, "sken-2026", signal, preparation, "owner")))));
  searching = false;
  await probe;
  const found = results.flatMap(result => result.items.map(item => item.path));
  expect(found).toContain("Spisy/Vec 19/sken-2026-11-13.txt");
  expect(found.some(path => path?.includes(".opencode"))).toBe(false);
  expect(latencies.length).toBeGreaterThan(3);
  expect(Math.max(...latencies)).toBeLessThan(500);
}, 60_000);
