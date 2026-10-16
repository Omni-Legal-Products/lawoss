import { expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { LawossDocuments } from "../../server/src/lawoss/documents/service";
import { DocumentExports } from "../../server/src/lawoss/documents/export";
import { DocumentPreparation } from "../../server/src/document-preparation/service";
import { OcrManager } from "../../server/src/ocr/manager";
import type { WorkspaceInfo } from "../../server/src/types";
import { documentCoverage, freshDocumentSources, generationPrompt } from "../src/react-app/domains/session/panel/document-processing";

const { PDFDocument, StandardFonts } = createRequire(new URL("../../server/package.json", import.meta.url))("pdf-lib");
async function portfolio(version: string): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage().drawText(`Synthetic version ${version}`, { font });
  await document.attach(new TextEncoder().encode(`Synthetic attachment ${version}`), "child.txt");
  return document.save();
}
async function settled(service: LawossDocuments, workspace: WorkspaceInfo) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const records = await service.list(workspace);
    if (records.every(record => !["uploaded", "preparing"].includes(record.status))) return records;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error("Preparation did not settle");
}

for (const fixedClock of [false, true]) test(`restored A-B-A selects the actual original and only its descendants after reload (fixed clock=${fixedClock})`, async () => {
  const root = await mkdtemp(join(tmpdir(), "document-current-version-"));
  const workspace: WorkspaceInfo = { id: "synthetic", name: "Synthetic", path: root, preset: "", workspaceType: "local" };
  const manager = new OcrManager(join(root, "ocr")), preparation = new DocumentPreparation(manager);
  const config = { configPath: join(root, "config.json") };
  let service = new LawossDocuments(config, preparation);
  // A coarse/fixed clock must not collapse independent admission order.
  const clock = fixedClock ? spyOn(Date, "now").mockReturnValue(1000) : undefined;
  try {
    const a = await portfolio("A"), b = await portfolio("B");
    await writeFile(join(root, "source.pdf"), a);
    const [original] = await service.prepare(workspace, ["source.pdf"]);
    const originalTree = await settled(service, workspace);
    expect(originalTree.every(record => record.status === "readable")).toBe(true);
    const extractedAt = originalTree.find(record => record.id === original.id)!.updatedAt;
    // Upgrade fixture: pre-contract records omit admission metadata. Preserve
    // their extraction evidence and let the next real preparation migrate A.
    const storage = join(root, ".legalwork", "lawoss-documents", "records.json");
    const legacyRecords = JSON.parse(await readFile(storage, "utf8"));
    for (const record of legacyRecords) delete record.admittedAt;
    await writeFile(storage, JSON.stringify(legacyRecords));
    await writeFile(join(root, "source.pdf"), b);
    const [replacement] = await service.prepare(workspace, ["source.pdf"]);
    await settled(service, workspace);
    expect(replacement.id).not.toBe(original.id);
    await writeFile(join(root, "source.pdf"), a);
    expect((await service.prepare(workspace, ["source.pdf"]))[0].id).toBe(original.id);
    expect((await service.read(workspace, original.id)).text).toContain("version A");
    await service.stop();
    service = new LawossDocuments(config, preparation);
    for (let retry = 0; retry < 3; retry++) {
      if (retry) expect((await service.prepare(workspace, ["source.pdf"]))[0].id).toBe(original.id);
      const records = await service.list(workspace);
      const fresh = await freshDocumentSources({ readLawossDocument: (_workspace, id, offset, limit) => service.read(workspace, id, offset, limit) }, workspace.id, ["source.pdf"], records);
      expect(fresh.map(record => record.id)).toEqual(originalTree.map(record => record.id));
      expect(fresh.every(record => record.freshness === "current")).toBe(true);
      expect(documentCoverage(fresh, ["source.pdf"]).complete).toBe(true);
      expect(records).toHaveLength(4); // Historical B and its child remain preserved.
      expect(records.find(record => record.id === original.id)!.updatedAt).toBe(extractedAt);
      expect(records.find(record => record.id === original.id)!.admittedAt).toBeGreaterThan(records.find(record => record.id === replacement.id)!.admittedAt!);
      const prompt = generationPrompt("cs", fresh);
      expect(prompt).toContain(original.id); expect(prompt).not.toContain(replacement.id);
      const exports = new DocumentExports(service);
      const path = `selected-${retry}.csv`;
      await exports.export(workspace, { path, kind: "registry", outputLanguage: "cs", documentIds: fresh.filter(record => !record.provenance.parentId).map(record => record.id), entries: [] });
      expect((await exports.validate(workspace, { paths: [path], outputLanguage: "cs", documentIds: [original.id] })).valid).toBe(true);
    }
    expect(await readFile(join(root, "source.pdf"))).toEqual(Buffer.from(a));
    await writeFile(join(root, "source.pdf"), b);
    const stale = await freshDocumentSources({ readLawossDocument: (_workspace, id, offset, limit) => service.read(workspace, id, offset, limit) }, workspace.id, ["source.pdf"], await service.list(workspace));
    expect(stale.every(record => record.freshness === "stale")).toBe(true);
    expect(documentCoverage(stale).complete).toBe(false);
  } finally {
    clock?.mockRestore(); await service.stop(); preparation.stop(); manager.stop(); await rm(root, { recursive: true, force: true });
  }
}, 15000);
