import { afterEach, expect, test } from "bun:test";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { strToU8, zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import { searchFileContents } from "../content-search.js";
import { DocumentPreparation } from "../document-preparation/service.js";
import { OcrManager } from "../ocr/manager.js";
import type { WorkspaceInfo } from "../types.js";
import { withSearchSlot } from "./search-admission.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

/** Binárne podklady ako v kancelárii: skenované PDF (veľké obrázky), DOCX, obrázok, TIFF a balíky Pages/ZEP. */
async function binaryOffice(root: string, clients: number) {
  const canvas = createCanvas(1700, 2400), context = canvas.getContext("2d");
  for (let index = 0; index < 4000; index++) {
    context.fillStyle = `rgb(${index % 255},${(index * 7) % 255},${(index * 13) % 255})`;
    context.fillRect((index * 37) % 1700, (index * 91) % 2400, 40, 12);
  }
  const jpeg = await canvas.encode("jpeg", 85), png = await canvas.encode("png");
  const scan = await PDFDocument.create(), jpegImage = await scan.embedJpg(jpeg), pngImage = await scan.embedPng(png);
  for (let page = 0; page < 12; page++) scan.addPage([595, 842]).drawImage(page % 2 ? jpegImage : pngImage, { x: 0, y: 0, width: 595, height: 842 });
  const scanBytes = await scan.save();
  const docx = zipSync({ "[Content_Types].xml": strToU8("<Types/>"), "word/document.xml": strToU8(`<w:document><w:body>${"<w:p><w:r><w:t>Zmluva o dielo, článok</w:t></w:r></w:p>".repeat(20000)}</w:body></w:document>`) });
  const pages = zipSync({ "Index/Document.iwa": new Uint8Array(512 * 1024), "preview.jpg": jpeg });
  const workspaces: WorkspaceInfo[] = [];
  for (let client = 0; client < clients; client++) {
    const path = join(root, `Klient ${client}`), folder = join(path, "Spisy", "Vec 1");
    await mkdir(folder, { recursive: true });
    for (let index = 0; index < 3; index++) await writeFile(join(folder, `sken-${index}.pdf`), scanBytes);
    for (let index = 0; index < 2; index++) await writeFile(join(folder, `dielo-${index}.docx`), docx);
    await writeFile(join(folder, "fotka.png"), png);
    await writeFile(join(folder, "faktura.tiff"), png);
    await writeFile(join(folder, "poznamky.pages"), pages);
    await writeFile(join(folder, "podanie.zep"), pages);
    workspaces.push({ id: `w${client}`, name: `Klient ${client}`, path, preset: "starter", workspaceType: "local" });
  }
  await writeFile(join(root, `Klient ${clients - 1}`, "Spisy", "Vec 1", "zmluva-2026-11-13.pdf"), scanBytes);
  return workspaces;
}

test("#465: hľadanie v skenoch a binárnych dokumentoch neblokuje slučku udalostí ani iné trasy", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-search-binary-")));
  const preparation = new DocumentPreparation(new OcrManager(join(root, ".ocr")));
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  cleanups.push(async () => { server.stop(true); preparation.stop(); await rm(root, { recursive: true, force: true }); });
  const workspaces = await binaryOffice(root, 4);
  const delay = monitorEventLoopDelay({ resolution: 10 });
  const latencies: number[] = [];
  let searching = true;
  const probe = (async () => {
    while (searching) {
      const started = performance.now();
      await (await fetch(`http://127.0.0.1:${server.port}/`)).text();
      latencies.push(performance.now() - started);
      await Bun.sleep(25);
    }
  })();
  delay.enable();
  const signal = new AbortController().signal;
  let found: Array<string | undefined> = [];
  // Ako okno Hľadať: opakuje, kým sa obsah pripravuje.
  for (let poll = 0; poll < 30; poll++) {
    const results = await Promise.all(workspaces.map(workspace =>
      withSearchSlot("binary-files", signal, () => searchFileContents(workspace, "zmluva", signal, preparation, "owner"))));
    found = results.flatMap(result => result.items.map(item => item.path));
    if (results.every(result => !result.preparing)) break;
    await Bun.sleep(200);
  }
  delay.disable();
  searching = false;
  await probe;
  expect(found).toContain("Spisy/Vec 1/zmluva-2026-11-13.pdf");
  expect(found).toContain("Spisy/Vec 1/dielo-0.docx");
  expect(delay.percentile(99) / 1e6).toBeLessThan(100);
  expect(Math.max(...latencies)).toBeLessThan(500);
}, 120_000);
