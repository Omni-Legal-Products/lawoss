// LAWOSS: model rozpoznávania textu sa sťahuje len po zapnutí OCR (tlačidlom alebo pri prvom použití), nikdy pri štarte servera.
import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveServerConfig } from "../config.js";
import { DocumentPreparation } from "../document-preparation/service.js";
import type { DocumentLayout } from "../document-preparation/structure.js";
import { OcrManager } from "../ocr/manager.js";
import { OcrService } from "../ocr/service.js";
import type { OcrEngine } from "../ocr/types.js";
import { startServer } from "../server.js";
import { OCR_DOWNLOAD_FAILED, OCR_DOWNLOAD_NOTICE, firstUseOcrDownload } from "./ocr-on-demand.js";
import { writeOcrEnabled } from "./ocr-opt-in.js";
import { removeTestDir } from "./test-support/remove-test-dir.js";

const roots: string[] = [];
const originalAuto = process.env.LEGALWORK_OCR_AUTO_DOWNLOAD;
const originalDb = process.env.LEGALWORK_RUNTIME_DB;
afterEach(async () => {
  for (const [key, value] of Object.entries({ LEGALWORK_OCR_AUTO_DOWNLOAD: originalAuto, LEGALWORK_RUNTIME_DB: originalDb })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await Promise.all(roots.splice(0).map(root => removeTestDir(root)));
});
async function temporary() {
  const root = await mkdtemp(join(tmpdir(), "lawoss-ocr-on-demand-")); roots.push(root); return root;
}

/** OcrManager so zapnutým OCR a podvrhnutou inštaláciou: `succeed` rozhodne, či po nej bude model pripravený. */
async function manager(succeed = true) {
  const ocr = new OcrManager(join(await temporary(), "ocr"));
  await writeOcrEnabled(ocr.runtime.root, true);
  let ready = false;
  spyOn(ocr.runtime, "available").mockResolvedValue(true);
  spyOn(ocr.runtime, "ready").mockImplementation(async () => ready);
  const install = spyOn(ocr.runtime, "install").mockImplementation(async engine => {
    await new Promise(resolve => setTimeout(resolve, 20));
    ready = succeed; ocr.runtime.installation = { engineId: engine.id, stage: succeed ? "complete" : "failed" };
  });
  const fast = (await ocr.store.read()).engines.find(engine => engine.id === "local-fast");
  if (fast?.kind !== "local") throw new Error("Missing local-fast engine");
  return { ocr, install, fast };
}

test("štart servera s predvolenou konfiguráciou nespúšťa sťahovanie modelu OCR", async () => {
  const root = await temporary();
  delete process.env.LEGALWORK_OCR_AUTO_DOWNLOAD;
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  await writeFile(join(root, "server.json"), "{}");
  const automatic = spyOn(OcrManager.prototype, "downloadDefaultIfNeeded").mockResolvedValue();
  try {
    const config = await resolveServerConfig({ configPath: join(root, "server.json"), workspaces: [], port: 0 });
    expect(config.autoDownloadOcr).toBe(false);
    const server = await startServer(config);
    expect((await fetch(`http://127.0.0.1:${server.port}/health`)).ok).toBe(true);
    await server.stop();
    expect(automatic).not.toHaveBeenCalled();
  } finally { automatic.mockRestore(); }
});

test("prvé použitie stiahne rýchly model raz, aj keď naň čaká viac príprav", async () => {
  const { ocr, install, fast } = await manager();
  const download = await firstUseOcrDownload(ocr, fast);
  expect(download.notice).toBe(OCR_DOWNLOAD_NOTICE);
  expect(download.notice).toContain("huggingface.co");
  expect(download.notice).toMatch(/about \d+ MB for text recognition and \d+ MB for document layout/);
  await Promise.all([download.wait(new AbortController().signal), download.wait(new AbortController().signal)]);
  expect(install).toHaveBeenCalledTimes(1);
  expect(install.mock.calls[0]![0]).toMatchObject({ id: "local-fast", model: "pp-ocrv6-small" });
});

test("neúspešné sťahovanie vráti zrozumiteľnú chybu a ďalšie použitie skúsi znova", async () => {
  const { ocr, install, fast } = await manager(false);
  const download = await firstUseOcrDownload(ocr, fast);
  await expect(download.wait(new AbortController().signal)).rejects.toThrow(OCR_DOWNLOAD_FAILED);
  expect(install).toHaveBeenCalledTimes(1);
  await expect((await firstUseOcrDownload(ocr, fast)).wait(new AbortController().signal)).rejects.toThrow(OCR_DOWNLOAD_FAILED);
  expect(install).toHaveBeenCalledTimes(2);
});

test("kvalitný model ani chýbajúci runtime sa sami nesťahujú", async () => {
  const { ocr, install, fast } = await manager();
  await expect(firstUseOcrDownload(ocr, { ...fast, id: "local-quality", model: "paddleocr-vl-1.6" })).rejects.toMatchObject({ code: "ocr_not_ready" });
  spyOn(ocr.runtime, "available").mockResolvedValue(false);
  await expect(firstUseOcrDownload(ocr, fast)).rejects.toMatchObject({ code: "ocr_not_ready" });
  expect(install).not.toHaveBeenCalled();
});

test("zrušenie prípravy prestane čakať, začaté sťahovanie dobehne", async () => {
  const { ocr, install, fast } = await manager();
  const controller = new AbortController();
  const waiting = (await firstUseOcrDownload(ocr, fast)).wait(controller.signal);
  controller.abort();
  await expect(waiting).rejects.toBeDefined();
  await (await firstUseOcrDownload(ocr, fast)).wait(new AbortController().signal);
  expect(install).toHaveBeenCalledTimes(1);
  expect(await ocr.runtime.ready("pp-ocrv6-small")).toBe(true);
});

const layout: DocumentLayout = { fingerprint: "test-layout-1", async detect() {
  return { model: "test-layout", regions: [{ label: "text", box: { x: 0, y: 0, width: 1, height: 1 }, confidence: 1, order: 0 }] };
} };
const info: OcrEngine["info"] = { id: "test", label: "Test OCR", execution: "local", model: "multilingual", languages: null, regions: true, warnings: [] };
const content = { text: "Scanned page", regions: [{ text: "Scanned page", box: { x: 0.1, y: 0.2, width: 0.7, height: 0.1 } }], truncated: false };
async function settled(service: DocumentPreparation, root: string, id: string) {
  for (let index = 0; index < 500; index++) {
    const result = await service.status(root, id);
    if (!["queued", "running"].includes(result.status)) return result;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Preparation did not finish");
}

test("príprava dokumentu čaká na model, ukazuje oznam a potom číta strany", async () => {
  const root = await temporary();
  await writeFile(join(root, "scan.png"), await readFile(new URL("../ocr/fixtures/bilingual.png", import.meta.url)));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: number[] = [];
  const service = new DocumentPreparation(new OcrManager(join(root, "ocr")), { layout, snapshot: async () => ({
    fingerprint: "first-use", download: { notice: OCR_DOWNLOAD_NOTICE, wait: () => gate },
    service: new OcrService([{ info, async recognize(page) { calls.push(page.pageNumber); return content; } }], "test"),
  }) });
  const started = await service.start(root, { files: ["scan.png"] });
  expect(started).toMatchObject({ notice: OCR_DOWNLOAD_NOTICE });
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(calls).toEqual([]);
  expect(await service.status(root, started.id)).toMatchObject({ status: "running", notice: OCR_DOWNLOAD_NOTICE });
  release();
  const finished = await settled(service, root, started.id);
  expect(calls).toEqual([1]);
  expect(finished.documents[0]!.status).not.toBe("error");
  expect(finished).not.toHaveProperty("notice");
});

test("zlyhané sťahovanie označí dokumenty chybou bez čítania strán", async () => {
  const root = await temporary();
  await writeFile(join(root, "scan.png"), await readFile(new URL("../ocr/fixtures/bilingual.png", import.meta.url)));
  const calls: number[] = [];
  const service = new DocumentPreparation(new OcrManager(join(root, "ocr")), { layout, snapshot: async () => ({
    fingerprint: "first-use-failed", download: { notice: OCR_DOWNLOAD_NOTICE, wait: async () => { throw new Error("offline"); } },
    service: new OcrService([{ info, async recognize(page) { calls.push(page.pageNumber); return content; } }], "test"),
  }) });
  const finished = await settled(service, root, (await service.start(root, { files: ["scan.png"] })).id);
  expect(finished.status).toBe("needs-review");
  expect(finished.documents[0]).toMatchObject({ status: "error", error: OCR_DOWNLOAD_FAILED });
  expect(calls).toEqual([]);
});
