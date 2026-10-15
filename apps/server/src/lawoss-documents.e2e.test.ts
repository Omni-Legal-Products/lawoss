import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { LawossDocuments } from "./lawoss/documents/service.js";
import type { WorkspaceInfo } from "./types.js";
import { DocumentPreparation } from "./document-preparation/service.js";
import { OcrService } from "./ocr/service.js";
import type { OcrContent, OcrPage, OcrContext } from "./ocr/types.js";
import { OcrManager } from "./ocr/manager.js";
import { removeSyntheticTestDir } from "./lawoss/test-support/inspect-cleanup.js";

async function pdf(text: string) {
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText(text, { font }); return doc.save();
}
async function fixture(run: (service: LawossDocuments, workspace: WorkspaceInfo, root: string) => Promise<void>, recognize?: (page: OcrPage, context: OcrContext) => Promise<OcrContent>, layoutModelDirectory?: string) {
  const root = await mkdtemp(join(tmpdir(), "lawoss-documents-"));
  const workspace: WorkspaceInfo = { id: "synthetic", name: "Synthetic", path: root, preset: "", workspaceType: "local", appFiles: "outside", appFilesStorageKey: "synthetic-storage" };
  const ocr = new OcrManager(join(root, "runtime"));
  if (layoutModelDirectory) ocr.runtime.local.modelDirectory = layoutModelDirectory;
  const preparation = new DocumentPreparation(ocr, recognize ? { snapshot: async () => ({ fingerprint: "synthetic-provider", service: new OcrService([{ info: { id: "synthetic", label: "Synthetic external OCR", execution: "remote", model: "synthetic", languages: null, regions: false, warnings: [] }, recognize }], "synthetic") }) } : {});
  const service = new LawossDocuments({ configPath: join(root, "config.json") }, preparation);
  try { await run(service, workspace, root); } finally { await service.stop(); preparation.stop(); ocr.stop(); await rm(root, { recursive: true, force: true }); }
}
async function settled(service: LawossDocuments, workspace: WorkspaceInfo) {
  for (let i = 0; i < 200; i++) {
    const records = await service.list(workspace);
    if (records.every(record => !["uploaded", "preparing"].includes(record.status))) return records;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Preparation did not finish");
}

test("text PDF preparation persists readable evidence, source hash and bounded reads", () => fixture(async (service, workspace, root) => {
  await writeFile(join(root, "text.pdf"), await pdf("Synthetic legal evidence"));
  const [started] = await service.prepare(workspace, ["text.pdf"]);
  const [record] = await settled(service, workspace);
  expect(record.status).toBe("readable"); expect(record.hash).toMatch(/^[a-f0-9]{64}$/);
  const read = await service.read(workspace, started.id, 0, 10);
  expect(read.text).toBe("Synthetic "); expect(read.nextOffset).toBe(10); expect(read.pages[0].page).toBe(1);
  const end = await service.read(workspace, started.id, read.nextOffset!);
  expect(end.text).toContain("legal evidence"); expect(end.complete).toBe(true); expect(end.nextOffset).toBeNull();
}));

test("portfolio exposes two attributed embedded PDFs with real page numbers", () => fixture(async (service, workspace, root) => {
  const portfolio = await PDFDocument.load(await pdf("Synthetic portfolio cover"));
  await portfolio.attach(await pdf("First attached evidence"), "first.pdf");
  await portfolio.attach(await pdf("Second attached evidence"), "../../second.pdf");
  await writeFile(join(root, "portfolio.pdf"), await portfolio.save());
  const [started] = await service.prepare(workspace, ["portfolio.pdf"]);
  const records = await settled(service, workspace);
  expect(records).toHaveLength(3); expect(records.every(record => record.complete)).toBe(true);
  const children = records.filter(record => record.provenance.parentId);
  expect(children.map(record => record.provenance.attachmentName)).toEqual(["first.pdf", "../../second.pdf"]);
  for (const child of children) {
    expect(child.provenance.parentId).toBe(started.id); expect(child.provenance.parentHash).toBe(started.hash);
    const read = await service.read(workspace, child.id); expect(read.pages[0].page).toBe(1); expect(read.text).toContain("attached evidence");
  }
}));

test("duplicate starts reuse IDs; UTF-8 form feed stays readable, binary and invalid UTF-8 fail", () => fixture(async (service, workspace, root) => {
  await writeFile(join(root, "pages.txt"), "First page\fSecond page");
  const first = await service.prepare(workspace, ["pages.txt", "pages.txt"]);
  expect(first[0].id).toBe(first[1].id);
  expect((await settled(service, workspace))[0].status).toBe("readable");
  expect((await service.read(workspace, first[0].id)).text).toBe("First page\fSecond page");
  expect((await service.prepare(workspace, ["pages.txt"]))[0].id).toBe(first[0].id);
  await writeFile(join(root, "nul.txt"), "binary\0content"); await writeFile(join(root, "bad.txt"), new Uint8Array([0xc3, 0x28]));
  await service.prepare(workspace, ["nul.txt", "bad.txt"]);
  const records = await settled(service, workspace); expect(records.filter(record => record.status === "failed")).toHaveLength(2);
}));

test("outside paths, symlink escape, stale evidence and storage symlinks are rejected", () => fixture(async (service, workspace, root) => {
  const { symlink, readFile, mkdir } = await import("node:fs/promises");
  const outside = await mkdtemp(join(tmpdir(), "lawoss-outside-"));
  try {
    await writeFile(join(outside, "private.txt"), "synthetic outside");
    await expect(service.prepare(workspace, [join(outside, "private.txt")])).rejects.toThrow("outside");
    await symlink(join(outside, "private.txt"), join(root, "escape.txt"));
    await expect(service.prepare(workspace, ["escape.txt"])).rejects.toThrow("outside");
    await writeFile(join(root, "source.txt"), "version one"); const [record] = await service.prepare(workspace, ["source.txt"]); await settled(service, workspace);
    await writeFile(join(root, "source.txt"), "version two"); await expect(service.read(workspace, record.id)).rejects.toThrow("changed");
    const [updated] = await service.prepare(workspace, ["source.txt"]); await settled(service, workspace); expect(updated.hash).not.toBe(record.hash);
    const inside: WorkspaceInfo = { ...workspace, appFiles: "inside" }; await mkdir(join(root, ".legalwork")); await symlink(outside, join(root, ".legalwork", "lawoss-documents"));
    await expect(service.list(inside)).rejects.toThrow("storage");
    expect(await readFile(join(outside, "private.txt"), "utf8")).toBe("synthetic outside");
  } finally { await rm(outside, { recursive: true, force: true }); }
}));

test("unsupported and too deeply nested portfolio attachments keep original text partial", () => fixture(async (service, workspace, root) => {
  let bytes = await pdf("Deepest synthetic content");
  for (let i = 0; i < 5; i++) { const doc = await PDFDocument.load(await pdf(`Synthetic nesting ${i}`)); await doc.attach(bytes, `level-${i}.pdf`); bytes = await doc.save(); }
  await writeFile(join(root, "deep.pdf"), bytes);
  const doc = await PDFDocument.load(await pdf("Unsupported attachment cover")); await doc.attach(new Uint8Array([1, 2, 3]), "do-not-execute.exe"); await writeFile(join(root, "unsupported.pdf"), await doc.save());
  await service.prepare(workspace, ["deep.pdf", "unsupported.pdf"]); const records = await settled(service, workspace);
  expect(records.filter(record => !record.provenance.parentId).every(record => record.status === "partial" && !record.complete)).toBe(true);
  expect(records.some(record => record.issue?.includes("nesting"))).toBe(true); expect(records.some(record => record.issue?.includes("Unsupported"))).toBe(true);
}));

async function scannedPdf(text = "") {
  const { readFile } = await import("node:fs/promises");
  const doc = await PDFDocument.create(), image = await doc.embedPng(await readFile(new URL("./ocr/fixtures/bilingual.png", import.meta.url)));
  const page = doc.addPage([500, 300]); page.drawImage(image, { x: 0, y: 0, width: 500, height: 130 });
  if (text) page.drawText(text, { x: 20, y: 250, size: 10, maxWidth: 450 }); return doc.save();
}
const recognized: OcrContent = { text: "Synthetic recognized scan evidence", regions: [], truncated: false };

test("real scan rendering reaches configured OCR; OCR failure preserves native text", async () => {
  let called = 0;
  await fixture(async (service, workspace, root) => {
    await writeFile(join(root, "mixed.pdf"), await scannedPdf("Original native readable evidence"));
    const [record] = await service.prepare(workspace, ["mixed.pdf"]); const [done] = await settled(service, workspace);
    expect(done.status).toBe("partial"); expect(done.complete).toBe(false);
    expect((await service.read(workspace, record.id)).text).toContain("Original native readable evidence"); expect(called).toBe(1);
  }, async page => { called++; expect(page.data.length).toBeGreaterThan(100); throw new Error("Synthetic OCR transport failure"); });
  await fixture(async (service, workspace, root) => {
    await writeFile(join(root, "scan.pdf"), await scannedPdf());
    const [record] = await service.prepare(workspace, ["scan.pdf"]); const [done] = await settled(service, workspace);
    expect(done.extraction).toBe("ocr"); expect((await service.read(workspace, record.id)).text).toContain("recognized scan evidence");
    // Real unavailable layout remains honestly partial, even when OCR transport succeeds.
    expect(done.status).toBe("partial");
  }, async page => { expect(page.mimeType).toBe("image/png"); return recognized; });
}, 15000);

test("cancellation is scoped, retryable, and original source changes invalidate extraction", async () => {
  let entered!: () => void; const first = new Promise<void>(resolve => { entered = resolve; }); let block = true;
  await fixture(async (service, workspace, root) => {
    await writeFile(join(root, "scan.pdf"), await scannedPdf()); const [record] = await service.prepare(workspace, ["scan.pdf"]); await first;
    await expect(service.cancel({ ...workspace, id: "other" }, record.id)).rejects.toThrow("not found");
    expect(await service.cancel(workspace, record.id)).toEqual({ id: record.id, cancelled: true });
    expect((await service.list(workspace))[0].complete).toBe(false); block = false;
    expect((await service.prepare(workspace, ["scan.pdf"]))[0].id).toBe(record.id); await settled(service, workspace);
    expect((await service.read(workspace, record.id)).text).toContain("recognized");
  }, async (_page, context) => {
    if (block) { entered(); await new Promise<void>((_resolve, reject) => context.signal.addEventListener("abort", () => reject(new Error("Synthetic cancelled OCR transport")), { once: true })); }
    return recognized;
  });
  let release!: () => void, enteredSecond!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), second = new Promise<void>(resolve => { enteredSecond = resolve; });
  await fixture(async (service, workspace, root) => {
    await writeFile(join(root, "changed.pdf"), await scannedPdf()); const [record] = await service.prepare(workspace, ["changed.pdf"]); await second;
    await writeFile(join(root, "changed.pdf"), await pdf("Changed synthetic source")); release(); const [done] = await settled(service, workspace);
    expect(done.status).toBe("failed"); expect(done.issue).toContain("changed"); expect(done.pageCount).toBe(0);
    await expect(service.read(workspace, record.id)).rejects.toThrow("changed");
  }, async () => { enteredSecond(); await gate; return recognized; });
}, 15000);

test("polling while a nested portfolio scan prepares preserves pending state", async () => {
  let entered!: () => void, release!: () => void;
  const first = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  await fixture(async (service, workspace, root) => {
    const inner = await PDFDocument.load(await pdf("Inner cover")); await inner.attach(await scannedPdf(), "scan.pdf");
    const outer = await PDFDocument.load(await pdf("Outer cover")); await outer.attach(await inner.save(), "inner.pdf");
    await writeFile(join(root, "nested.pdf"), await outer.save()); const [record] = await service.prepare(workspace, ["nested.pdf"]); await first;
    try {
      const pending = await service.list(workspace); expect(pending).toHaveLength(3);
      expect(pending.every(item => item.status === "preparing")).toBe(true);
      await expect(service.read(workspace, pending[2].id)).rejects.toThrow("finished");
    } finally { release(); }
    await settled(service, workspace); expect((await service.list(workspace)).find(item => item.id === record.id)?.complete).toBe(false);
  }, async () => { entered(); await gate; return recognized; });
}, 15000);

test("corrupted Unicode mapping enters OCR and failed OCR retains readable native passages", async () => {
  let called = false;
  await fixture(async (service, workspace, root) => {
    const { PDFName, PDFDict } = await import("pdf-lib");
    const doc = await PDFDocument.create(), font = await doc.embedFont(StandardFonts.Helvetica);
    const mapping = doc.context.flateStream("/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Synthetic def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <41> <FFFD> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end");
    doc.addPage().drawText("AAAA Original readable passage", { font }); await doc.flush();
    doc.context.lookup(font.ref, PDFDict).set(PDFName.of("ToUnicode"), doc.context.register(mapping));
    await writeFile(join(root, "malformed.pdf"), await doc.save());
    const [record] = await service.prepare(workspace, ["malformed.pdf"]); await settled(service, workspace);
    expect(called).toBe(true); expect((await service.read(workspace, record.id)).text).toContain("Original readable passage");
    expect((await service.list(workspace))[0].status).toBe("partial");
  }, async () => { called = true; throw new Error("Synthetic failed OCR"); });
}, 15000);

test("process interruption persists retryable state and restart never reports completed", () => fixture(async (service, workspace, root) => {
  await writeFile(join(root, "restart.txt"), "Synthetic persistent source");
  const moduleUrl = (relative: string) => new URL(relative, import.meta.url).href;
  const code = `import { LawossDocuments } from ${JSON.stringify(moduleUrl("./lawoss/documents/service.ts"))};
import { DocumentPreparation } from ${JSON.stringify(moduleUrl("./document-preparation/service.ts"))};
import { OcrManager } from ${JSON.stringify(moduleUrl("./ocr/manager.ts"))};
const workspace = ${JSON.stringify(workspace)};
const service = new LawossDocuments({ configPath: ${JSON.stringify(join(root, "config.json"))} }, new DocumentPreparation(new OcrManager(${JSON.stringify(join(root, "child-runtime"))})));
await service.prepare(workspace, ["restart.txt"]); process.exit(0);`;
  const child = Bun.spawn([process.execPath, "--eval", code], { stdout: "ignore", stderr: "pipe" });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
  const [interrupted] = await service.list(workspace); expect(interrupted.complete).toBe(false); expect(interrupted.status).toBe("failed"); expect(interrupted.issue).toContain("interrupted");
  const [retry] = await service.prepare(workspace, ["restart.txt"]); expect(retry.id).toBe(interrupted.id);
  expect((await settled(service, workspace))[0].status).toBe("readable");
}));

test("outside storage survives workspace relocation without authorizing historical paths", () => fixture(async (service, workspace, root) => {
  const { mkdir, rename } = await import("node:fs/promises");
  const oldPath = join(root, "old"), newPath = join(root, "new"); await mkdir(oldPath);
  const oldWorkspace = { ...workspace, path: oldPath }; await writeFile(join(oldPath, "move.txt"), "Synthetic moved evidence");
  const [record] = await service.prepare(oldWorkspace, ["move.txt"]); await settled(service, oldWorkspace); await rename(oldPath, newPath);
  const moved = { ...oldWorkspace, path: newPath, previousPaths: [oldPath] };
  expect((await service.list(moved))[0].id).toBe(record.id); expect((await service.read(moved, record.id)).text).toBe("Synthetic moved evidence");
  await mkdir(oldPath); await writeFile(join(oldPath, "other.txt"), "Synthetic historical root");
  await expect(service.prepare(moved, [join(oldPath, "other.txt")])).rejects.toThrow("outside");
}));

test("attachment count and byte limits preserve cover with incomplete coverage", () => fixture(async (service, workspace, root) => {
  const doc = await PDFDocument.load(await pdf("Synthetic limited cover"));
  for (let i = 0; i < 33; i++) await doc.attach(new Uint8Array([1]), `item-${i}.txt`);
  await writeFile(join(root, "count.pdf"), await doc.save());
  const oversize = await PDFDocument.load(await pdf("Synthetic oversize cover"));
  await oversize.attach(new Uint8Array(64 * 1024 * 1024 + 1), "huge.bin"); await writeFile(join(root, "bytes.pdf"), await oversize.save());
  await service.prepare(workspace, ["count.pdf", "bytes.pdf"]); const records = await settled(service, workspace);
  expect(records).toHaveLength(2); expect(records.every(record => record.status === "partial")).toBe(true);
  expect(records[0].issue).toContain("count"); expect(records[1].issue).toContain("bytes");
}), 15000);

test("encrypted PDF is failed without claiming readable coverage", () => fixture(async (service, workspace, root) => {
  const { PDFHexString } = await import("pdf-lib");
  const doc = await PDFDocument.load(await pdf("Synthetic encrypted content"));
  doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: "Standard", V: 1, R: 2, O: PDFHexString.of("00".repeat(32)), U: PDFHexString.of("00".repeat(32)), P: -4, Length: 40 }));
  await writeFile(join(root, "encrypted.pdf"), await doc.save({ useObjectStreams: false }));
  await service.prepare(workspace, ["encrypted.pdf"]); const [record] = await settled(service, workspace);
  expect(record.status).toBe("failed"); expect(record.complete).toBe(false); expect(record.pageCount).toBe(0);
}));

test("actual HTTP and registered agent document tools enforce authorization, pagination and read-only", async () => {
  const { mkdir } = await import("node:fs/promises"), { startServer } = await import("./server.js"), { LegalWorkProjectTools } = await import("./opencode-plugins/legalwork-project-tools.js");
  const root = await mkdtemp(join(tmpdir(), "lawoss-documents-http-")), path = join(root, "workspace"); await mkdir(path);
  const old = { db: process.env.LEGALWORK_RUNTIME_DB, url: process.env.LEGALWORK_SERVER_URL, token: process.env.LEGALWORK_SERVER_TOKEN };
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const config: import("./types.js").ServerConfig = {
    host: "127.0.0.1", port: 0, token: "synthetic-token", hostToken: "synthetic-host", configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [],
    workspaces: [{ id: "synthetic-http", name: "Synthetic", path, preset: "starter", workspaceType: "local", appFiles: "outside", appFilesStorageKey: "synthetic-http" }],
    authorizedRoots: [path], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };
  const server = await startServer(config);
  try {
    const base = `http://127.0.0.1:${server.port}`, endpoint = `${base}/workspace/synthetic-http/lawoss/documents`, headers = { Authorization: "Bearer synthetic-token", "content-type": "application/json" };
    await writeFile(join(path, "source.txt"), "Synthetic HTTP evidence");
    expect((await fetch(endpoint)).status).toBe(401); expect((await fetch(`${endpoint}/prepare`, { method: "POST", body: '{"paths":["source.txt"]}' })).status).toBe(401);
    process.env.LEGALWORK_SERVER_URL = base; process.env.LEGALWORK_SERVER_TOKEN = "synthetic-token";
    const plugin = await LegalWorkProjectTools(), context = { directory: path };
    const started = JSON.parse(await plugin.tool.lawoss_documents_prepare.execute({ paths: ["source.txt"] }, context));
    const id = started.documents[0].id;
    for (let i = 0; i < 200; i++) { const list = JSON.parse(await plugin.tool.lawoss_documents_list.execute({ limit: 1 }, context)); if (list.documents[0].status === "readable") break; await new Promise(resolve => setTimeout(resolve, 10)); }
    const read = JSON.parse(await plugin.tool.lawoss_documents_read.execute({ id, limit: 10 }, context)); expect(read.text).toBe("Synthetic "); expect(read.nextOffset).toBe(10); expect(read.untrusted).toBe(true);
    const { createHash } = await import("node:crypto");
    await writeFile(join(path,"TEST_ZDROJE_ISIR.json"),JSON.stringify({source:"ISIR",company:"Synthetic",caseNumber:"SYN 2/2026",sourceUrl:"https://isir.justice.cz/isir/synthetic",sampleOnly:true,documents:[{file:"source.txt",documentId:"D2",url:"https://isir.justice.cz/isir/document/D2",sha256:createHash("sha256").update("Synthetic HTTP evidence").digest("hex")}] }));
    const exportBody={path:"registry.csv",kind:"registry",outputLanguage:"cs",documentIds:[id],entries:[{documentId:id,summary:"Synthetic summary"}]};
    expect((await fetch(`${endpoint}/export`,{method:"POST",body:JSON.stringify(exportBody)})).status).toBe(401);
    const exported=JSON.parse(await plugin.tool.lawoss_documents_export.execute(exportBody,context)); expect(exported.verified).toBe(false); expect(exported.path).toBe("registry.csv");
    const checked=JSON.parse(await plugin.tool.lawoss_documents_validate.execute({paths:["registry.csv"],documentIds:[id],outputLanguage:"cs"},context)); expect(checked.valid).toBe(true); expect(checked.legalApproval).toBe(false);
    const saved=await (await fetch(`${endpoint}/outputs?limit=1`,{headers})).json(); expect(saved.outputs[0].verified).toBe(true); expect(saved.outputs[0].currentHash).toBe(exported.hash); expect(saved.nextOffset).toBeNull();
    // Only the model-tool boundary recognizes literal empty as create-only;
    // direct HTTP retains its strict hash schema and all real ownership guards.
    for (const expectedHash of ["", null, "wrong"]) expect((await fetch(`${endpoint}/export`, { headers, method: "POST", body: JSON.stringify({ ...exportBody, path: "http-invalid.csv", expectedHash }) })).status).toBe(400);
    const emptyCreated = JSON.parse(await plugin.tool.lawoss_documents_export.execute({ ...exportBody, path: "empty-created.csv", expectedHash: "" }, context));
    expect(emptyCreated.path).toBe("empty-created.csv"); expect(emptyCreated.hash).toMatch(/^[a-f0-9]{64}$/);
    const before = await readFile(join(path, "registry.csv"), "utf8");
    for (const extra of [{}, { expectedHash: "" }, { expectedHash: "0".repeat(64) }]) {
      const conflict = JSON.parse(await plugin.tool.lawoss_documents_export.execute({ ...exportBody, ...extra }, context));
      expect(conflict.error).toContain("409");
      expect(await readFile(join(path, "registry.csv"), "utf8")).toBe(before);
    }
    expect((await fetch(`${endpoint}/export`, { headers, method: "POST", body: JSON.stringify(exportBody) })).status).toBe(409);
    await writeFile(join(path, "ordinary.csv"), "Ordinary user bytes");
    const ordinaryHash = createHash("sha256").update("Ordinary user bytes").digest("hex");
    for (const extra of [{}, { expectedHash: "" }, { expectedHash: ordinaryHash }]) {
      const conflict = JSON.parse(await plugin.tool.lawoss_documents_export.execute({ ...exportBody, path: "ordinary.csv", ...extra }, context));
      expect(conflict.error).toContain("409");
      expect(await readFile(join(path, "ordinary.csv"), "utf8")).toBe("Ordinary user bytes");
    }
    const repaired = JSON.parse(await plugin.tool.lawoss_documents_export.execute({ ...exportBody, expectedHash: exported.hash, entries: [{ documentId: id, summary: "Synthetic owned repair" }] }, context));
    expect(repaired.path).toBe("registry.csv"); expect(repaired.hash).not.toBe(exported.hash);
    expect(await readFile(join(path, "registry.csv"), "utf8")).toContain("Synthetic owned repair");
    const staleRepair = JSON.parse(await plugin.tool.lawoss_documents_export.execute({ ...exportBody, expectedHash: exported.hash }, context));
    expect(staleRepair.error).toContain("409");
    expect((await fetch(`${endpoint}/export`,{headers,method:"POST",body:JSON.stringify({...exportBody,outputLanguage:"de"})})).status).toBe(400);
    expect((await fetch(`${endpoint}/${id}/read`)).status).toBe(401);
    expect((await fetch(`${endpoint}/prepare`, { headers, method: "POST", body: '{"paths":["../server.json"]}' })).status).toBe(403);
    expect((await fetch(`${endpoint}/prepare`, { headers, method: "POST", body: '{"paths":[]}' })).status).toBe(400);
    expect((await fetch(`${endpoint}/${id}/read?limit=16001`, { headers })).status).toBe(400);
    const issued = await fetch(`${base}/tokens`, { method: "POST", headers: { "x-legalwork-host-token": "synthetic-host", "content-type": "application/json" }, body: '{"scope":"viewer","label":"synthetic-viewer"}' });
    expect(issued.status).toBe(201); const viewer = await issued.json();
    const viewerHeaders = { Authorization: `Bearer ${viewer.token}`, "content-type": "application/json" };
    expect((await fetch(`${endpoint}/prepare`, { headers: viewerHeaders, method: "POST", body: '{"paths":["source.txt"]}' })).status).toBe(403);
    expect((await fetch(`${endpoint}/${id}`, { headers: viewerHeaders, method: "DELETE" })).status).toBe(403);
    expect((await fetch(`${endpoint}/${id}/read`, { headers: viewerHeaders })).status).toBe(200);
    expect((await fetch(`${endpoint}/export`,{headers:viewerHeaders,method:"POST",body:JSON.stringify(exportBody)})).status).toBe(403);
    expect((await fetch(`${endpoint}/validate`,{headers:viewerHeaders,method:"POST",body:JSON.stringify({paths:["registry.csv"],documentIds:[id],outputLanguage:"cs"})})).status).toBe(403);
    expect((await fetch(`${endpoint}/outputs`,{headers:viewerHeaders})).status).toBe(200);
    config.readOnly = true;
    expect((await fetch(`${endpoint}/export`,{headers,method:"POST",body:JSON.stringify(exportBody)})).status).toBe(403);
    expect((await fetch(`${endpoint}/validate`,{headers,method:"POST",body:JSON.stringify({paths:["registry.csv"],documentIds:[id],outputLanguage:"cs"})})).status).toBe(403);
    expect((await fetch(`${endpoint}/outputs`,{headers})).status).toBe(200);
    expect((await fetch(`${endpoint}/prepare`, { headers, method: "POST", body: '{"paths":["source.txt"]}' })).status).toBe(403);
    expect((await fetch(`${endpoint}/${id}`, { headers, method: "DELETE" })).status).toBe(403);
    expect((await fetch(`${endpoint}/${id}/read`, { headers })).status).toBe(200);
    const output: { system: string[] } = { system: [] }; await plugin["experimental.chat.system.transform"]({}, output); expect(output.system.join(" ")).toContain("prefer lawoss_documents_prepare");
  } finally {
    await server.stop();
    if (old.db === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = old.db;
    if (old.url === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = old.url;
    if (old.token === undefined) delete process.env.LEGALWORK_SERVER_TOKEN; else process.env.LEGALWORK_SERVER_TOKEN = old.token;
    await removeSyntheticTestDir(root);
  }
}, 20000);

test("source/text limits reject oversized inputs without silent truncation", () => fixture(async (service, workspace, root) => {
  const { open } = await import("node:fs/promises");
  const file = await open(join(root, "oversized.txt"), "w"); await file.truncate(64 * 1024 * 1024 + 1); await file.close();
  await expect(service.prepare(workspace, ["oversized.txt"])).rejects.toThrow("64 MiB");
  await writeFile(join(root, "too-long.txt"), "x".repeat(2_000_001));
  await service.prepare(workspace, ["too-long.txt"]); const [record] = await settled(service, workspace);
  expect(record.status).toBe("failed"); expect(record.issue).toContain("2 million"); expect(record.pageCount).toBe(0);
}));

test("OCR-off visual additions stay partial despite a long native text layer", () => fixture(async (service, workspace, root) => {
  const native = "Original readable synthetic evidence remains present in this document and the drawn visual addition requires recognition. ";
  await writeFile(join(root, "long-visual.pdf"), await scannedPdf(native.repeat(2)));
  const [record] = await service.prepare(workspace, ["long-visual.pdf"]); const [done] = await settled(service, workspace);
  expect(done.status).toBe("partial"); expect(done.complete).toBe(false);
  expect((await service.read(workspace, record.id)).text).toContain("Original readable");
}));

const testWithRealLayout = process.env.LAWOSS_TEST_LAYOUT_MODEL_DIR ? test : test.skip;
testWithRealLayout("opt-in real pinned layout plus usable configured OCR makes a scan readable", async () => {
  const { layoutModelReady } = await import("./ocr/models.js");
  const directory = process.env.LAWOSS_TEST_LAYOUT_MODEL_DIR!;
  expect(await layoutModelReady(directory)).toBe(true);
  let calls = 0;
  await fixture(async (service, workspace, root) => {
    await writeFile(join(root, "usable-scan.pdf"), await scannedPdf());
    const [record] = await service.prepare(workspace, ["usable-scan.pdf"]); const [done] = await settled(service, workspace);
    expect(calls).toBe(1); expect(done.status).toBe("readable"); expect(done.complete).toBe(true); expect(done.pageCount).toBe(1);
    const read = await service.read(workspace, record.id); expect(read.text).toContain("Synthetic recognized scan evidence"); expect(read.pages.some(page => page.page === 1 && page.source === "ocr")).toBe(true);
  }, async page => { calls++; expect(page.blocks?.length).toBeGreaterThan(0); return recognized; }, directory);
}, 30000);

test("portfolio text budget marks over-limit child failed with its actual issue", () => fixture(async (service, workspace, root) => {
  const doc = await PDFDocument.load(await pdf("Synthetic text budget cover"));
  for (const name of ["first.txt", "second.txt"]) await doc.attach(new TextEncoder().encode("x".repeat(1_100_000)), name);
  await writeFile(join(root, "text-budget.pdf"), await doc.save()); await service.prepare(workspace, ["text-budget.pdf"]);
  const records = await settled(service, workspace), failed = records.find(record => record.provenance.attachmentName === "second.txt");
  expect(records[0].status).toBe("partial"); expect(failed?.status).toBe("failed"); expect(failed?.issue).toContain("2 million");
}));

test("nested siblings cannot exceed the tree-wide 32 attachment budget", () => fixture(async (service, workspace, root) => {
  const inner = await PDFDocument.load(await pdf("Synthetic inner count cover"));
  for (let i = 0; i < 31; i++) await inner.attach(new TextEncoder().encode("Synthetic child"), `child-${i}.txt`);
  const outer = await PDFDocument.load(await pdf("Synthetic outer count cover"));
  await outer.attach(await inner.save(), "a-inner.pdf"); await outer.attach(new TextEncoder().encode("Synthetic last sibling"), "z-last.txt");
  await writeFile(join(root, "nested-count.pdf"), await outer.save()); await service.prepare(workspace, ["nested-count.pdf"]);
  const records = await settled(service, workspace);
  expect(records[0].status).toBe("partial"); expect(records[0].complete).toBe(false);
  expect(records.filter(record => record.provenance.parentId).length).toBeLessThanOrEqual(32);
  expect(records.some(record => record.issue?.includes("count"))).toBe(true);
}));

test("nested siblings cannot exceed the tree-wide decoded attachment byte budget", () => fixture(async (service, workspace, root) => {
  const inner = await PDFDocument.load(await pdf("Synthetic inner byte cover"));
  await inner.attach(new Uint8Array(40 * 1024 * 1024), "nested.bin");
  const outer = await PDFDocument.load(await pdf("Synthetic outer byte cover"));
  await outer.attach(await inner.save(), "a-inner.pdf"); await outer.attach(new Uint8Array(25 * 1024 * 1024), "z-last.bin");
  await writeFile(join(root, "nested-bytes.pdf"), await outer.save()); await service.prepare(workspace, ["nested-bytes.pdf"]);
  const records = await settled(service, workspace);
  // Both .bin payloads are unsupported, but admission must fail the tree byte budget too.
  expect(records.some(record => record.issue?.includes("bytes"))).toBe(true);
  expect(records[0].complete).toBe(false);
}));

test("capacity permits deduplicated readable reuse, failed retry and retry-descendant admission planning", () => fixture(async (service, workspace, root) => {
  // Reach the public 500-record limit through real preparation, not fabricated storage.
  for (let offset = 0; offset < 497; offset += 20) {
    const paths = Array.from({ length: Math.min(20, 497 - offset) }, (_, i) => `capacity-${offset + i}.txt`);
    await Promise.all(paths.map(path => writeFile(join(root, path), "Synthetic capacity evidence")));
    await service.prepare(workspace, paths); await settled(service, workspace);
  }
  await writeFile(join(root, "failed-at-capacity.txt"), "Synthetic\0binary");
  const portfolio = await PDFDocument.load(await pdf("Synthetic capacity portfolio")); await portfolio.attach(new Uint8Array([1]), "unsupported.bin");
  await writeFile(join(root, "retry-at-capacity.pdf"), await portfolio.save());
  const initial = await service.prepare(workspace, ["failed-at-capacity.txt", "retry-at-capacity.pdf"]);
  const full = await settled(service, workspace); expect(full).toHaveLength(500);
  const readable = full.find(record => record.path === "capacity-0.txt")!;
  const reused = await service.prepare(workspace, ["capacity-0.txt", "capacity-0.txt"]);
  expect(reused.map(record => record.id)).toEqual([readable.id, readable.id]); expect((await service.list(workspace))).toHaveLength(500);
  expect((await service.prepare(workspace, ["failed-at-capacity.txt"]))[0].id).toBe(initial[0].id); await settled(service, workspace);
  await writeFile(join(root, "new-at-capacity.txt"), "Synthetic new capacity source");
  // A retry removes one old attachment, making room even when the new input comes first.
  const admitted = await service.prepare(workspace, ["new-at-capacity.txt", "retry-at-capacity.pdf"]);
  expect(admitted[1].id).toBe(initial[1].id);
  const end = await settled(service, workspace); expect(end).toHaveLength(500);
  expect(end.find(record => record.id === admitted[0].id)?.status).toBe("readable");
  expect(end.find(record => record.id === admitted[1].id)?.complete).toBe(false);
  expect(end.some(record => record.issue?.includes("record limit"))).toBe(true);
  await writeFile(join(root, "rejected.txt"), "Synthetic rejected source");
  await expect(service.prepare(workspace, ["rejected.txt"])).rejects.toThrow("record limit");
  expect((await service.list(workspace))).toHaveLength(500);
}), 30000);

test("an interrupted original at 500 records remains retryable after real process restart", () => fixture(async (service, workspace, root) => {
  for (let offset = 0; offset < 499; offset += 20) {
    const paths = Array.from({ length: Math.min(20, 499 - offset) }, (_, i) => `restart-capacity-${offset + i}.txt`);
    await Promise.all(paths.map(path => writeFile(join(root, path), "Synthetic restart capacity")));
    await service.prepare(workspace, paths); await settled(service, workspace);
  }
  await writeFile(join(root, "interrupted-capacity.txt"), "Synthetic interrupted capacity source");
  const moduleUrl = (relative: string) => new URL(relative, import.meta.url).href;
  const code = `import { LawossDocuments } from ${JSON.stringify(moduleUrl("./lawoss/documents/service.ts"))};
import { DocumentPreparation } from ${JSON.stringify(moduleUrl("./document-preparation/service.ts"))};
import { OcrManager } from ${JSON.stringify(moduleUrl("./ocr/manager.ts"))};
const workspace = ${JSON.stringify(workspace)};
const service = new LawossDocuments({ configPath: ${JSON.stringify(join(root, "config.json"))} }, new DocumentPreparation(new OcrManager(${JSON.stringify(join(root, "child-runtime"))})));
await service.prepare(workspace, ["interrupted-capacity.txt"]); process.exit(0);`;
  const child = Bun.spawn([process.execPath, "--eval", code], { stdout: "ignore", stderr: "pipe" }); const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
  const before = await service.list(workspace); expect(before).toHaveLength(500);
  const interrupted = before.find(record => record.path === "interrupted-capacity.txt")!; expect(interrupted.status).toBe("failed"); expect(interrupted.issue).toContain("interrupted");
  const [retry] = await service.prepare(workspace, ["interrupted-capacity.txt", "interrupted-capacity.txt"]); expect(retry.id).toBe(interrupted.id);
  const end = await settled(service, workspace); expect(end).toHaveLength(500); expect(end.find(record => record.id === retry.id)?.status).toBe("readable");
}), 30000);

test("exactly 32 nested attachments remain readable within the shared count budget", () => fixture(async (service, workspace, root) => {
  const inner = await PDFDocument.load(await pdf("Synthetic valid inner count cover"));
  for (let i = 0; i < 30; i++) await inner.attach(new TextEncoder().encode("Synthetic permitted child"), `child-${i}.txt`);
  const outer = await PDFDocument.load(await pdf("Synthetic valid outer count cover"));
  await outer.attach(await inner.save(), "a-inner.pdf"); await outer.attach(new TextEncoder().encode("Synthetic permitted sibling"), "z-last.txt");
  await writeFile(join(root, "valid-nested-count.pdf"), await outer.save()); await service.prepare(workspace, ["valid-nested-count.pdf"]);
  const records = await settled(service, workspace); expect(records).toHaveLength(33); expect(records.every(record => record.complete && record.status === "readable")).toBe(true);
}));
