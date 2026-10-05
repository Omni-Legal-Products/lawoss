// LAWOSS: OCR je voľba, ktorú advokát výslovne zapne; bez nej sa nič nesťahuje a číta sa len textová vrstva.
import { afterEach, expect, spyOn, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { DocumentPreparation } from "../document-preparation/service.js";
import type { DocumentLayout } from "../document-preparation/structure.js";
import { OcrRuntime } from "../ocr/runtime.js";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { firstUseOcrDownload } from "./ocr-on-demand.js";
import { LawossOcrManager, OCR_DISABLED, OCR_DISABLED_CODE, ocrEnabled } from "./ocr-opt-in.js";

const roots: string[] = [];
const originalDb = process.env.LEGALWORK_RUNTIME_DB;
afterEach(async () => {
  if (originalDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = originalDb;
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function temporary() {
  const root = await mkdtemp(join(tmpdir(), "lawoss-ocr-opt-in-")); roots.push(root); return root;
}
const exists = (path: string) => access(path).then(() => true, () => false);

test("bez zapnutia OCR sa model nesťahuje ani na žiadosť, ani pri štarte, ani pri prvom použití", async () => {
  const ocr = new LawossOcrManager(join(await temporary(), "ocr"));
  const install = spyOn(ocr.runtime, "install").mockResolvedValue();
  const layout = spyOn(ocr.runtime, "installLayout").mockResolvedValue();
  spyOn(ocr.runtime, "available").mockResolvedValue(true);
  expect(await ocrEnabled(ocr.runtime.root)).toBe(false);
  await expect(ocr.install("local-fast")).rejects.toMatchObject({ code: OCR_DISABLED_CODE });
  await expect(ocr.install("local-layout")).rejects.toMatchObject({ code: OCR_DISABLED_CODE });
  await ocr.downloadDefaultIfNeeded();
  const fast = (await ocr.store.read()).engines.find(engine => engine.id === "local-fast");
  if (fast?.kind !== "local") throw new Error("Missing local-fast engine");
  await expect(firstUseOcrDownload(ocr, fast)).rejects.toMatchObject({ code: OCR_DISABLED_CODE });
  expect(install).not.toHaveBeenCalled();
  expect(layout).not.toHaveBeenCalled();
  expect(ocr.runtime.installation).toBeNull();
});

const layoutCalls: number[] = [];
const layout: DocumentLayout = { fingerprint: "test-layout-1", async detect() {
  layoutCalls.push(1);
  return { model: "test-layout", regions: [] };
} };
async function settled(service: DocumentPreparation, root: string, id: string) {
  for (let index = 0; index < 500; index++) {
    const result = await service.status(root, id);
    if (!["queued", "running"].includes(result.status)) return result;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Preparation did not finish");
}

test("vypnuté OCR: príprava číta len textovú vrstvu, sken označí a nič nesťahuje", async () => {
  const root = await temporary();
  const pdf = await PDFDocument.create();
  pdf.addPage([600, 400]).drawText("Zmluva o dielo uzavreta medzi objednavatelom a zhotovitelom podla obchodneho zakonnika, clanok prvy, predmet zmluvy a cena diela.", { x: 20, y: 300, size: 8 });
  pdf.addPage([600, 400]);
  await writeFile(join(root, "zmluva.pdf"), await pdf.save());
  await writeFile(join(root, "scan.png"), await readFile(new URL("../ocr/fixtures/bilingual.png", import.meta.url)));
  const ocr = new LawossOcrManager(join(root, ".ocr"));
  const install = spyOn(OcrRuntime.prototype, "install");
  const installLayout = spyOn(OcrRuntime.prototype, "installLayout");
  const fetched = spyOn(globalThis, "fetch");
  try {
    const service = new DocumentPreparation(ocr, { layout });
    const started = await service.start(root, { files: ["zmluva.pdf", "scan.png"] });
    expect(started).toMatchObject({ notice: OCR_DISABLED, noticeCode: OCR_DISABLED_CODE });
    expect(started.engine).toMatchObject({ id: "lawoss-text-layer", model: "none" });
    const finished = await settled(service, root, started.id);
    expect(finished).toMatchObject({ status: "needs-review", notice: OCR_DISABLED, noticeCode: OCR_DISABLED_CODE });
    const [contract, scan] = finished.documents;
    expect(contract).toMatchObject({ status: "needs-review", error: OCR_DISABLED });
    expect(scan).toMatchObject({ status: "needs-review", error: OCR_DISABLED });
    const prepared = JSON.parse(await readFile(join(root, contract!.preparationPath!), "utf8"));
    expect(prepared.pages[0]).toMatchObject({ status: "complete", ocr: null });
    expect(prepared.pages[0].nativeText).toContain("Zmluva o dielo");
    expect(prepared.pages[1]).toMatchObject({ status: "error", ocr: null, error: OCR_DISABLED });
    expect(layoutCalls).toEqual([]);
    expect(install).not.toHaveBeenCalled();
    expect(installLayout).not.toHaveBeenCalled();
    expect(fetched).not.toHaveBeenCalled();
  } finally { install.mockRestore(); installLayout.mockRestore(); fetched.mockRestore(); }
});

test("HTTP: voľba sa zapína výslovne, stiahnutie a odstránenie modelu len cez ňu", async () => {
  const root = await temporary();
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const workspace = join(root, "workspace"); await mkdir(workspace);
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "token", hostToken: "host-token", configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [],
    workspaces: [{ id: "ws_1", name: "Test", path: workspace, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [workspace], readOnly: false, startedAt: Date.now(),
    tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };
  const install = spyOn(OcrRuntime.prototype, "install").mockResolvedValue();
  const server = await startServer(config);
  try {
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { "x-legalwork-host-token": "host-token", "content-type": "application/json" };
    expect((await fetch(`${base}/lawoss/ocr`)).status).toBe(401);
    const initial = await (await fetch(`${base}/lawoss/ocr`, { headers })).json();
    expect(initial).toMatchObject({ enabled: false, model: { source: "huggingface.co (PaddlePaddle)" } });
    expect(initial.model.textBytes + initial.model.layoutBytes).toBeGreaterThan(150_000_000);
    for (const [path, method] of [["/lawoss/ocr/model", "POST"], ["/ocr/engines/local-fast/install", "POST"], ["/ocr/engines/local-layout/install", "POST"]] as const) {
      const refused = await fetch(`${base}${path}`, { headers, method });
      expect(refused.status).toBe(403);
      expect(await refused.text()).toContain(OCR_DISABLED_CODE);
    }
    expect(install).not.toHaveBeenCalled();
    expect((await fetch(`${base}/lawoss/ocr`, { headers, method: "PUT", body: '{"enabled":"yes"}' })).status).toBe(400);
    const enabled = await (await fetch(`${base}/lawoss/ocr`, { headers, method: "PUT", body: '{"enabled":true}' })).json();
    expect(enabled.enabled).toBe(true);
    expect(install).not.toHaveBeenCalled();
    expect((await fetch(`${base}/lawoss/ocr/model`, { headers, method: "POST" })).status).toBe(200);
    expect(install).toHaveBeenCalledTimes(1);
    expect(install.mock.calls[0]![0]).toMatchObject({ id: "local-fast", model: "pp-ocrv6-small" });
    const ocrRoot = join(root, "ocr");
    await mkdir(join(ocrRoot, "models"), { recursive: true });
    await writeFile(join(ocrRoot, "pp-ocrv6-small.ready"), "1\n");
    expect((await fetch(`${base}/lawoss/ocr/model`, { headers, method: "DELETE" })).status).toBe(200);
    expect(await exists(join(ocrRoot, "models"))).toBe(false);
    expect(await exists(join(ocrRoot, "pp-ocrv6-small.ready"))).toBe(false);
    const disabled = await (await fetch(`${base}/lawoss/ocr`, { headers, method: "PUT", body: '{"enabled":false}' })).json();
    expect(disabled.enabled).toBe(false);
    config.readOnly = true;
    expect((await fetch(`${base}/lawoss/ocr`, { headers, method: "PUT", body: '{"enabled":true}' })).status).toBe(403);
  } finally { await server.stop(); install.mockRestore(); }
}, 20_000);
