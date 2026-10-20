import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import type { DocumentSummary } from "./lawoss/documents/types.js";

// A blanket path exclusion, a client-callable approval, missing CAS, or lost
// persisted review must fail this real source -> extraction -> HTTP boundary.
test("host visual review resolves only current decorative PDF pages and survives reload", async () => {
  const { startServer } = await import("./server.js");
  const { engineAgentSession } = await import("./lawoss/test-support/engine-agent.js");
  const root = await mkdtemp(join(tmpdir(), "lawoss-visual-review-")), path = join(root, "workspace");
  await mkdir(path);
  const previousDb = process.env.LEGALWORK_RUNTIME_DB;
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const config: import("./types.js").ServerConfig = {
    host: "127.0.0.1", port: 0, token: "synthetic-client", hostToken: "synthetic-host", configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [], authorizedRoots: [path], readOnly: false,
    workspaces: [{ id: "visual", name: "Synthetic", path, preset: "starter", workspaceType: "local" }],
    startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };
  const pdf = await PDFDocument.create(), page = pdf.addPage();
  page.drawText("Synthetic original searchable evidence with a decorative border.");
  page.drawRectangle({ x: 10, y: 10, width: 500, height: 700, borderWidth: 1 });
  const bytes = await pdf.save(); await writeFile(join(path, "border.pdf"), bytes);
  const portfolio = await PDFDocument.load(bytes);
  await portfolio.attach(new Uint8Array([1, 2, 3]), "unknown.bin");
  await writeFile(join(path, "portfolio.pdf"), await portfolio.save());
  const mixed = await PDFDocument.load(bytes);
  const image = await mixed.embedPng(await readFile(new URL("./ocr/fixtures/bilingual.png", import.meta.url)));
  mixed.getPages()[0].drawImage(image, { x: 10, y: 100, width: 100, height: 80 });
  await writeFile(join(path, "mixed.pdf"), await mixed.save());
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let restoreAgent = () => {};
  try {
    server = await startServer(config);
    let base = `http://127.0.0.1:${server.port}/workspace/visual/lawoss/documents`;
    const headers = { "x-legalwork-host-token": "synthetic-host", "content-type": "application/json" };
    const prepare = async (file: string) => {
      const response = await fetch(`${base}/prepare`, { method: "POST", headers, body: JSON.stringify({ paths: [file] }) });
      expect(response.status).toBe(200);
      const { documents } = await response.json();
      for (let i = 0; i < 300; i++) {
        const all = (await (await fetch(base, { headers })).json()).documents;
        const record = all.find((item: DocumentSummary) => item.id === documents[0].id);
        if (record && !["uploaded", "preparing"].includes(record.status)) return record;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error("Synthetic preparation did not finish");
    };
    const record = await prepare("border.pdf");
    expect(record.status).toBe("partial"); expect(record.complete).toBe(false);
    expect(record.pdfCoverage).toEqual([{ page: 1, nativeTextCoverage: "complete", visualReasons: ["drawn-paths"] }]);
    expect((await (await fetch(`${base}/${record.id}/read`, { headers })).json()).text).toContain("original searchable evidence");
    const input = { expectedHash: record.hash, expectedUpdatedAt: record.updatedAt, pages: [1], confirmation: "decorative-only" };
    const review = (body: unknown, auth: Record<string, string> = headers) => fetch(`${base}/${record.id}/visual-review`, { method: "POST", headers: auth, body: JSON.stringify(body) });
    expect((await review(input, { "content-type": "application/json", Authorization: "Bearer synthetic-client" })).status).toBe(401);
    const agent = await engineAgentSession(config, { sessionID: "ses_visual", directory: path }); restoreAgent = agent.restore;
    expect((await review(input, { ...headers, "x-legalwork-wiki-agent-token": process.env.LEGALWORK_WIKI_AGENT_TOKEN!, "x-legalwork-wiki-agent-session": "ses_visual" })).status).toBe(403);
    expect((await review({ ...input, expectedHash: "0".repeat(64) })).status).toBe(409);
    expect((await review({ ...input, expectedUpdatedAt: record.updatedAt - 1 })).status).toBe(409);
    expect((await review({ ...input, reviewer: "forged-human", reviewedAt: 1 })).status).toBe(400);
    expect((await review({ ...input, pages: [1, 1] })).status).toBe(409);
    config.readOnly = true; expect((await review(input)).status).toBe(403); config.readOnly = false;
    const unknown = await prepare("mixed.pdf");
    expect(unknown.complete).toBe(false);
    expect((await fetch(`${base}/${unknown.id}/visual-review`, { method: "POST", headers, body: JSON.stringify({ ...input, expectedHash: unknown.hash, expectedUpdatedAt: unknown.updatedAt }) })).status).toBe(409);
    const accepted = await review(input); expect(accepted.status).toBe(200);
    const acceptedRecord = (await accepted.json()).document;
    expect(acceptedRecord.status).toBe("readable"); expect(acceptedRecord.complete).toBe(true);
    expect(acceptedRecord.visualReview.sourceHash).toBe(record.hash);
    expect(acceptedRecord.visualReview.reviewer).toBe("authenticated-host");
    expect(acceptedRecord.visualReview.reviewedAt).toBeGreaterThan(record.updatedAt);
    expect(await readFile(join(path, "border.pdf"))).toEqual(Buffer.from(bytes));
    const parent = await prepare("portfolio.pdf");
    const parentResponse = await fetch(`${base}/${parent.id}/visual-review`, { method: "POST", headers, body: JSON.stringify({ ...input, expectedHash: parent.hash, expectedUpdatedAt: parent.updatedAt }) });
    expect(parentResponse.status).toBe(200);
    expect((await parentResponse.json()).document.complete).toBe(false);
    await server.stop(); server = await startServer(config);
    base = `http://127.0.0.1:${server.port}/workspace/visual/lawoss/documents`;
    const reloaded = (await (await fetch(`${base}/${record.id}/read`, { headers })).json());
    expect(reloaded.complete).toBe(true); expect(reloaded.visualReview).toEqual(acceptedRecord.visualReview);
    await writeFile(join(path, "border.pdf"), new Uint8Array([...bytes, 10]));
    expect((await fetch(`${base}/${record.id}/read`, { headers })).status).toBe(409);
    const stale = (await (await fetch(base, { headers })).json()).documents.find((item: DocumentSummary) => item.id === record.id);
    expect(stale.complete).toBe(false); expect(stale.visualReview).toBeUndefined();
    expect((await review(input)).status).toBe(409);
    await server.stop(); server = await startServer(config);
    base = `http://127.0.0.1:${server.port}/workspace/visual/lawoss/documents`;
    const staleReload = (await (await fetch(base, { headers })).json()).documents.find((item: DocumentSummary) => item.id === record.id);
    expect(staleReload.complete).toBe(false); expect(staleReload.visualReview).toBeUndefined();
  } finally {
    restoreAgent(); await server?.stop();
    if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

test("decorative review preserves native and OCR text and resolves parent coverage only after each child", async () => {
  const { DocumentPreparation } = await import("./document-preparation/service.js");
  const { LawossDocuments } = await import("./lawoss/documents/service.js");
  const { OcrManager } = await import("./ocr/manager.js");
  const { OcrService } = await import("./ocr/service.js");
  const root = await mkdtemp(join(tmpdir(), "lawoss-visual-evidence-"));
  const workspace: import("./types.js").WorkspaceInfo = { id: "visual", path: root, name: "Synthetic", preset: "starter", workspaceType: "local" };
  const ocr = new OcrManager(join(root, "runtime"));
  const preparation = new DocumentPreparation(ocr, { snapshot: async () => ({ fingerprint: "synthetic", service: new OcrService([{ info: { id: "synthetic", label: "Synthetic", execution: "local", model: "synthetic", languages: null, regions: false, warnings: [] }, recognize: async () => ({ text: "Synthetic recognized evidence retained verbatim.", regions: [], truncated: false }) }], "synthetic") }) });
  const service = new LawossDocuments({ configPath: join(root, "config.json") }, preparation);
  try {
    const pdf = await PDFDocument.create(); const page = pdf.addPage(); page.drawText("Synthetic native evidence.");
    page.drawLine({ start: { x: 10, y: 10 }, end: { x: 100, y: 10 } });
    const bytes = await pdf.save(); await pdf.attach(bytes, "child.pdf");
    await writeFile(join(root, "portfolio.pdf"), await pdf.save());
    await service.prepare(workspace, ["portfolio.pdf"]);
    let records: DocumentSummary[] = [];
    for (let i = 0; i < 300; i++) {
      records = await service.list(workspace);
      if (records.length === 2 && records.every(record => !["preparing", "uploaded"].includes(record.status))) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(records).toHaveLength(2);
    const parent = records.find(record => !record.provenance.parentId)!, child = records.find(record => record.provenance.parentId)!;
    const before = await service.read(workspace, parent.id);
    expect(before.text).toContain("Synthetic native evidence."); expect(before.text).toContain("Synthetic recognized evidence retained verbatim.");
    const review = (record: DocumentSummary) => service.reviewDecorativePages(workspace, record.id, { expectedHash: record.hash, expectedUpdatedAt: record.updatedAt, pages: [1], confirmation: "decorative-only" });
    expect((await review(parent)).complete).toBe(false);
    expect((await service.read(workspace, parent.id)).text.replace(/\n+$/u, "")).toBe(before.text.replace(/\n+$/u, ""));
    expect((await service.read(workspace, child.id)).complete).toBe(false);
    expect((await review(child)).complete).toBe(true);
    const after = await service.read(workspace, parent.id);
    expect(after.complete).toBe(true); expect(after.pages.filter(page => page.text.trim()).map(page => page.text)).toEqual(before.pages.filter(page => page.text.trim()).map(page => page.text));
    expect(after.pages.some(page => page.source === "ocr" && page.text.includes("recognized evidence"))).toBe(true);
  } finally { await service.stop(); preparation.stop(); ocr.stop(); await rm(root, { recursive: true, force: true }); }
}, 15000);

test("review of a readable child keeps a bodyless email partial when a sibling remains unsupported", async () => {
  const { DocumentPreparation } = await import("./document-preparation/service.js");
  const { LawossDocuments } = await import("./lawoss/documents/service.js");
  const { OcrManager } = await import("./ocr/manager.js");
  const root = await mkdtemp(join(tmpdir(), "lawoss-visual-subtree-"));
  const workspace: import("./types.js").WorkspaceInfo = { id: "visual", path: root, name: "Synthetic", preset: "starter", workspaceType: "local" };
  const ocr = new OcrManager(join(root, "runtime")), preparation = new DocumentPreparation(ocr);
  const service = new LawossDocuments({ configPath: join(root, "config.json") }, preparation);
  try {
    const pdf = await PDFDocument.create(), page = pdf.addPage();
    page.drawText("Synthetic child evidence with decorative border."); page.drawRectangle({ x: 10, y: 10, width: 100, height: 100, borderWidth: 1 });
    await writeFile(join(root, "mail.eml"), ['MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="synthetic"', '', '--synthetic', 'Content-Type: application/pdf', 'Content-Disposition: attachment; filename="evidence.pdf"', 'Content-Transfer-Encoding: base64', '', Buffer.from(await pdf.save()).toString("base64"), '--synthetic', 'Content-Type: application/octet-stream', 'Content-Disposition: attachment; filename="unknown.bin"', 'Content-Transfer-Encoding: base64', '', 'AQID', '--synthetic--', ''].join("\r\n"));
    await service.prepare(workspace, ["mail.eml"]);
    let records: DocumentSummary[] = [];
    for (let i = 0; i < 300; i++) { records = await service.list(workspace); if (records.length === 3 && records.every(record => !["uploaded", "preparing"].includes(record.status))) break; await new Promise(resolve => setTimeout(resolve, 10)); }
    const parent = records.find(record => !record.provenance.parentId)!, child = records.find(record => record.provenance.attachmentName === "evidence.pdf")!, unsupported = records.find(record => record.provenance.attachmentName === "unknown.bin")!;
    expect(parent.status).toBe("partial"); expect(unsupported.status).toBe("failed");
    await service.reviewDecorativePages(workspace, child.id, { expectedHash: child.hash, expectedUpdatedAt: child.updatedAt, pages: [1], confirmation: "decorative-only" });
    const after = await service.read(workspace, parent.id);
    expect(after.status).toBe("partial"); expect(after.complete).toBe(false);
    expect((await service.read(workspace, child.id)).text).toContain("Synthetic child evidence");
    expect((await service.list(workspace)).find(record => record.id === unsupported.id)?.status).toBe("failed");
  } finally { await service.stop(); preparation.stop(); ocr.stop(); await rm(root, { recursive: true, force: true }); }
}, 15000);
