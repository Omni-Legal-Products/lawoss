import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { contentPreparationLimits, preparationBacklog, searchFileContents, whenPreparationIdle } from "./content-search.js";
import { DocumentPreparation } from "./document-preparation/service.js";
import { OcrManager } from "./ocr/manager.js";
import { OcrService } from "./ocr/service.js";
import { extractCorpusText } from "./corpus/extract.js";
import { documentMatches } from "./corpus/passages.js";
import { reviewSourcePage } from "./reviews/source-page.js";
import type { WorkspaceInfo } from "./types.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture(fail = false, layoutAvailable = true) {
  const scratch = fileURLToPath(new URL("../../../.legalwork/scratch/", import.meta.url));
  await mkdir(scratch, { recursive: true });
  const root = await realpath(await mkdtemp(join(scratch, "search-fixture-")));
  let calls = 0;
  const box = { x: .1, y: .2, width: .6, height: .1 };
  const preparation = new DocumentPreparation(new OcrManager(join(root, ".ocr")), {
    layout: { fingerprint: "fixture-layout", async detect() {
      if (!layoutAvailable) throw new Error("Layout unavailable");
      return { model: "fixture-layout", regions: [{ label: "text", box, confidence: .99, order: 0 }] };
    } },
    snapshot: async () => {
    if (fail) throw new Error("OCR unavailable");
    return { fingerprint: "fixture", service: new OcrService([{ info: { id: "fixture", label: "Fixture", execution: "local", model: "fixture", regions: true, languages: null, warnings: [] }, recognize: async () => {
      calls++;
      return { text: "Handwritten amendment: quarterly escrow deposits.", regions: [{ text: "Handwritten amendment: quarterly escrow deposits.", box }], truncated: false };
    } }], "fixture") };
  } });
  cleanups.push(async () => { preparation.stop(); await rm(root, { recursive: true, force: true }); });
  const workspace: WorkspaceInfo = { id: "search-fixture", name: "Fixture", path: root, preset: "starter", workspaceType: "local" };
  return { root, workspace, preparation, box, calls: () => calls, setFailure: (value: boolean) => { fail = value; } };
}
const signal = () => new AbortController().signal;
async function settled(f: Awaited<ReturnType<typeof fixture>>, query: string) {
  for (let index = 0; index < 200; index++) {
    const result = await searchFileContents(f.workspace, query, signal(), f.preparation, "owner");
    if (!result.preparing) return result;
    await Bun.sleep(20);
  }
  throw new Error("Search did not finish preparing");
}

test("shared extraction detects additions on native PDFs and preserves OCR evidence locations", async () => {
  const f = await fixture();
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([500, 400]);
  page.drawText("This native contract contains enough typed text for the old fast path.", { x: 20, y: 330, size: 12 });
  page.drawLine({ start: { x: 20, y: 100 }, end: { x: 130, y: 110 }, thickness: 2 });
  await writeFile(join(f.root, "annotated.pdf"), await pdf.save());
  const shared = await extractCorpusText(f.root, "annotated.pdf", f.preparation, signal());
  expect(shared.complete).toBe(false); expect(shared.extraction).toBe("ocr"); expect(f.calls()).toBe(1);
  expect(shared.pdfCoverage).toEqual([{ page: 1, nativeTextCoverage: "complete", visualReasons: ["drawn-paths"] }]);
  const agentMatches = documentMatches(shared, "annotated.pdf", "quarterly escrow");
  const ui = await settled(f, "quarterly escrow");
  expect(ui.items).toHaveLength(1); expect(ui.items[0].sources).toEqual(agentMatches.sources);
  expect(f.calls()).toBe(1); // UI reuses the same prepared document.
  const ref = ui.items[0].sources?.find(source => source.source === "ocr");
  if (!ref) throw new Error("Missing OCR reference");
  const preview = await reviewSourcePage(f.root, ref.path, { sourceHash: ref.hash, preparationPath: ref.preparationPath, citations: [ref] }, 0, signal());
  expect(preview.page).toBe(1); expect(preview.regions).toEqual([f.box]);
  await writeFile(join(f.root, "annotated.pdf"), "changed");
  await expect(reviewSourcePage(f.root, ref.path, { sourceHash: ref.hash, preparationPath: ref.preparationPath, citations: [ref] }, 0, signal())).rejects.toThrow("changed");
});

test("a clause split across pages returns every contributing passage", () => {
  const pages = [{ page: 1, text: "Upon a transfer of ownership," }, { page: 2, text: "the counterparty may terminate this agreement." }];
  const result = documentMatches({ pages, text: pages.map(page => page.text).join("\n\n"), hash: "hash", complete: true, extraction: "native" }, "split.pdf", "ownership terminate");
  expect(result.sources.map(source => source.page)).toEqual([1, 2]);
  expect(result.sources[1].quote).toContain("terminate");
});

// LAWOSS: page layout runs only on an explicit request (lawoss/layout-on-demand.ts), so a missing layout model
// no longer makes automatically prepared OCR evidence incomplete.
test("without a layout request a missing layout model keeps OCR locations searchable and evidence complete", async () => {
  const f = await fixture(false, false);
  await writeFile(join(f.root, "scan.png"), await readFile(new URL("./ocr/fixtures/bilingual.png", import.meta.url)));
  const shared = await extractCorpusText(f.root, "scan.png", f.preparation, signal());
  expect(shared.complete).toBe(true);
  expect(shared.pages.find(page => page.source === "ocr")?.regions?.[0].box).toEqual(f.box);
  const result = await settled(f, "quarterly escrow");
  expect(result.items).toHaveLength(1);
  expect(result.items[0].incomplete).toBeFalsy();
  expect(result.incomplete).toBe(0);
  expect(f.calls()).toBe(1);
});

test("unreadable images are reported, partial native text remains searchable, and external symlinks are excluded", async () => {
  const f = await fixture(true), other = await fixture();
  const png = await readFile(new URL("./ocr/fixtures/bilingual.png", import.meta.url));
  await writeFile(join(f.root, "scan.png"), png);
  const pdf = await PDFDocument.create();
  const page = pdf.addPage(); page.drawText("Native agreement with ownership provision.");
  page.drawLine({ start: { x: 0, y: 0 }, end: { x: 100, y: 100 } });
  await writeFile(join(f.root, "partial.pdf"), await pdf.save());
  await writeFile(join(other.root, "outside.txt"), "ownership");
  await symlink(join(other.root, "outside.txt"), join(f.root, "outside.txt"));
  const result = await settled(f, "ownership");
  expect(result.incomplete).toBe(2); expect(result.retryable).toBe(true);
  expect(result.items.map(item => item.path)).toEqual(["partial.pdf"]);
  expect(result.items[0].incomplete).toBe(true);
  expect(result.issues?.some(issue => issue.path === "scan.png")).toBe(true);
});

test("plain text stays independent of OCR and cache invalidates when the source changes", async () => {
  const f = await fixture(true);
  await writeFile(join(f.root, "terms.txt"), "Quarterly deposits are required.");
  expect((await settled(f, "quarterly")).items).toHaveLength(1);
  await writeFile(join(f.root, "terms.txt"), "Annual deposits replace the prior requirement.");
  expect((await settled(f, "quarterly")).items).toHaveLength(0);
  expect((await settled(f, "annual")).items).toHaveLength(1);
  expect(f.calls()).toBe(0);
});

test("retry recovers every unreadable file across the background concurrency limit", async () => {
  const f = await fixture(true);
  const png = await readFile(new URL("./ocr/fixtures/bilingual.png", import.meta.url));
  for (const name of ["first.png", "second.png", "third.png"]) await writeFile(join(f.root, name), png);
  expect((await settled(f, "escrow")).incomplete).toBe(3);
  f.setFailure(false);
  await searchFileContents(f.workspace, "escrow", signal(), f.preparation, "owner", true);
  const recovered = await settled(f, "escrow");
  expect(recovered.items).toHaveLength(3);
  expect(recovered.incomplete).toBe(0);
  expect(recovered.retryable).toBe(false);
});

test("preparation continues in the background after a single search, without polling (#474)", async () => {
  const f = await fixture(true);
  for (let index = 0; index < 12; index++) await writeFile(join(f.root, `note-${index}.txt`), `Escrow clause number ${index}.`);
  const first = await searchFileContents(f.workspace, "escrow", signal(), f.preparation, "owner");
  expect(first.preparing).toBeGreaterThan(2);
  await whenPreparationIdle(f.preparation);
  const second = await searchFileContents(f.workspace, "escrow", signal(), f.preparation, "owner");
  expect([second.preparing, second.items.length]).toEqual([0, 12]);
});

// 🟡 LAWOSS #525: bounded background queue, no cache thrash, idle and moved roots dropped.
const defaultLimits = { ...contentPreparationLimits };
afterEach(() => { Object.assign(contentPreparationLimits, defaultLimits); });
/** Extraction held until `open()`, recording every started file. */
function gatedExtraction() {
  const started: string[] = [];
  const waiting: Array<() => void> = [];
  let opened = false;
  contentPreparationLimits.extract = async (...args: Parameters<typeof extractCorpusText>) => {
    started.push(join(args[0], args[1]));
    if (!opened) await new Promise<void>((resolve) => waiting.push(resolve));
    return extractCorpusText(...args);
  };
  return { started, open() { opened = true; for (const resolve of waiting.splice(0)) resolve(); } };
}
async function notes(root: string, count: number) {
  for (let index = 0; index < count; index++) await writeFile(join(root, `note-${index}.txt`), `Escrow clause number ${index}.`);
}
const search = (f: Awaited<ReturnType<typeof fixture>>, workspace = f.workspace) =>
  searchFileContents(workspace, "escrow", signal(), f.preparation, "owner");

test("the background queue admits only what the cache holds and repeated searches do not re-prepare (#525)", async () => {
  Object.assign(contentPreparationLimits, { queue: 3, cacheEntries: 6 });
  const f = await fixture(true);
  await notes(f.root, 12);
  const gate = gatedExtraction();
  const first = await search(f);
  // Two start at once, three wait (queue limit), the rest are refused instead of reported as preparing.
  expect([gate.started.length, first.preparing, first.limited]).toEqual([2, 5, true]);
  expect(preparationBacklog(f.preparation)).toMatchObject({ running: 2, queued: 3 });
  // Searching again while they wait queues nothing twice.
  const again = await search(f);
  expect([gate.started.length, again.preparing, preparationBacklog(f.preparation).queued]).toEqual([2, 5, 3]);
  gate.open();
  await whenPreparationIdle(f.preparation);
  expect(gate.started.length).toBe(5);
  await search(f);
  await whenPreparationIdle(f.preparation);
  // One more fits; then the cache is full of files this office just searched and nothing is evicted.
  expect(gate.started.length).toBe(6);
  for (let round = 0; round < 3; round++) {
    const settled = await search(f);
    await whenPreparationIdle(f.preparation);
    expect([settled.items.length, settled.preparing, settled.limited]).toEqual([6, 0, true]);
  }
  expect(gate.started.length).toBe(6);
  expect(new Set(gate.started).size).toBe(6);
  expect(preparationBacklog(f.preparation).cached).toBe(6);
});

test("queued files of a root nobody searched for a while are dropped (#525)", async () => {
  const f = await fixture(true);
  await notes(f.root, 8);
  const gate = gatedExtraction();
  const now = Date.now();
  contentPreparationLimits.now = () => now;
  await search(f);
  expect(preparationBacklog(f.preparation)).toMatchObject({ running: 2, queued: 6 });
  contentPreparationLimits.now = () => now + contentPreparationLimits.idleMs;
  gate.open();
  await whenPreparationIdle(f.preparation);
  expect(gate.started.length).toBe(2);
  expect(preparationBacklog(f.preparation).queued).toBe(0);
  // A new search resumes the remaining files.
  await search(f);
  await whenPreparationIdle(f.preparation);
  expect(gate.started.length).toBe(8);
  expect((await search(f)).items).toHaveLength(8);
});

test("concurrent searches of two workspaces keep each other's queue (#525)", async () => {
  const f = await fixture(true);
  const scratch = fileURLToPath(new URL("../../../.legalwork/scratch/", import.meta.url));
  const other = await realpath(await mkdtemp(join(scratch, "search-fixture-other-")));
  cleanups.push(() => rm(other, { recursive: true, force: true }));
  const second: WorkspaceInfo = { ...f.workspace, id: "search-fixture-other", path: other };
  await notes(f.root, 5);
  await notes(other, 5);
  const gate = gatedExtraction();
  await Promise.all([search(f), search(f, second)]);
  gate.open();
  await whenPreparationIdle(f.preparation);
  expect(gate.started.length).toBe(10);
  const [first, next] = await Promise.all([search(f), search(f, second)]);
  expect([first.items.length, first.preparing, next.items.length, next.preparing]).toEqual([5, 0, 5, 0]);
});

test("an office larger than the cache does not re-prepare when the palette searches every client (#525)", async () => {
  Object.assign(contentPreparationLimits, { cacheEntries: 6 });
  const f = await fixture(true);
  const scratch = fileURLToPath(new URL("../../../.legalwork/scratch/", import.meta.url));
  const other = await realpath(await mkdtemp(join(scratch, "search-fixture-other-")));
  cleanups.push(() => rm(other, { recursive: true, force: true }));
  const second: WorkspaceInfo = { ...f.workspace, id: "search-fixture-other", path: other };
  await notes(f.root, 5);
  await notes(other, 5);
  const gate = gatedExtraction();
  gate.open();
  const counts: number[] = [];
  for (let round = 0; round < 4; round++) {
    await Promise.all([search(f), search(f, second)]);
    await whenPreparationIdle(f.preparation);
    counts.push(gate.started.length);
  }
  expect(counts.every((count) => count === counts[0])).toBe(true);
  expect(new Set(gate.started).size).toBe(gate.started.length);
  expect(preparationBacklog(f.preparation).cached).toBeLessThanOrEqual(6);
});

test("a workspace whose root changed drops the old root's queue (#525)", async () => {
  const f = await fixture(true);
  const scratch = fileURLToPath(new URL("../../../.legalwork/scratch/", import.meta.url));
  const moved = await realpath(await mkdtemp(join(scratch, "search-fixture-moved-")));
  cleanups.push(() => rm(moved, { recursive: true, force: true }));
  await notes(f.root, 6);
  await notes(moved, 3);
  const gate = gatedExtraction();
  await search(f);
  expect(preparationBacklog(f.preparation).queued).toBe(4);
  await search(f, { ...f.workspace, path: moved });
  gate.open();
  await whenPreparationIdle(f.preparation);
  expect(gate.started.filter((path) => path.startsWith(f.root + "/")).length).toBe(2);
  expect(gate.started.filter((path) => path.startsWith(moved + "/")).length).toBe(3);
});
