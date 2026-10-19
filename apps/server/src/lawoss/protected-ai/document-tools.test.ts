import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LawossDocuments } from "../documents/service.js";
import { DocumentPreparation } from "../../document-preparation/service.js";
import { OcrManager } from "../../ocr/manager.js";
import type { WorkspaceInfo } from "../../types.js";
import { ProtectedDocumentTools } from "./document-tools.js";

test("protected document tools read only the selected prepared evidence and reject a foreign source and arbitrary execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "protected-document-tools-"));
  const workspace: WorkspaceInfo = { id: "synthetic", name: "Synthetic", path: root, preset: "", workspaceType: "local" };
  const ocr = new OcrManager(join(root, "ocr"));
  const preparation = new DocumentPreparation(ocr);
  const documents = new LawossDocuments({ configPath: join(root, "config.json") }, preparation);
  try {
    await writeFile(join(root, "selected.txt"), "SELECTED-SYNTHETIC-EVIDENCE");
    await writeFile(join(root, "other.txt"), "UNSELECTED-SYNTHETIC-CANARY");
    const [selected, other] = await documents.prepare(workspace, ["selected.txt", "other.txt"]);
    for (let attempt = 0; attempt < 200; attempt++) {
      if ((await documents.list(workspace)).every(record => record.status === "readable")) break;
      await Bun.sleep(10);
    }
    expect((await documents.list(workspace)).every(record => record.status === "readable")).toBe(true);
    const tools = await ProtectedDocumentTools.open({ documents, workspace, sources: [{ id: selected.id, hash: selected.hash }] });
    const signal = new AbortController().signal;
    expect(await tools.invoke("lawoss_documents_list", {}, signal)).toMatchObject({ documents: [{ id: selected.id }], nextOffset: null });
    expect(JSON.stringify(await tools.invoke("lawoss_documents_read", { id: selected.id }, signal))).toContain("SELECTED-SYNTHETIC-EVIDENCE");
    await expect(tools.invoke("lawoss_documents_read", { id: other.id }, signal)).rejects.toMatchObject({ code: "protected_source_denied" });
    await expect(tools.invoke("legalwork_shell", { command: "echo SHOULD-NOT-RUN" }, signal)).rejects.toMatchObject({ code: "protected_tool_denied" });
    const input = { path: "summary.md", kind: "summary", outputLanguage: "cs", documentIds: [selected.id], entries: [{ documentId: selected.id, summary: "Synthetic summary" }] };
    await expect(tools.invoke("lawoss_documents_export", { ...input, documentIds: [other.id] }, signal)).rejects.toMatchObject({ code: "protected_source_denied" });
    expect(await tools.invoke("lawoss_documents_export", input, signal)).toMatchObject({ path: "summary.md", verified: false, legalApproval: false });
    expect(await tools.invoke("lawoss_documents_validate", { paths: ["summary.md"], documentIds: [selected.id], outputLanguage: "cs" }, signal)).toMatchObject({ valid: true });
    await expect(tools.invoke("lawoss_documents_validate", { paths: ["other.txt"], documentIds: [selected.id], outputLanguage: "cs" }, signal)).rejects.toMatchObject({ code: "protected_output_denied" });
    await writeFile(join(root, "selected.txt"), "Changed after selection");
    await expect(tools.invoke("lawoss_documents_read", { id: selected.id }, signal)).rejects.toBeDefined();
  } finally {
    await documents.stop(); preparation.stop(); ocr.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("a selected case cannot admit another case's prepared evidence or export outside its physical directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "protected-document-case-"));
  const workspace: WorkspaceInfo = {id: "synthetic", name: "Synthetic", path: root, preset: "", workspaceType: "local"};
  const ocr = new OcrManager(join(root, "ocr")), preparation = new DocumentPreparation(ocr);
  const documents = new LawossDocuments({configPath: join(root, "config.json")}, preparation);
  try {
    await mkdir(join(root, "case-a")); await mkdir(join(root, "case-b"));
    await writeFile(join(root, "case-a/source.txt"), "SELECTED-CASE-EVIDENCE");
    await writeFile(join(root, "case-b/other.txt"), "FOREIGN-CASE-CANARY");
    await symlink(join(root, "case-b/other.txt"), join(root, "case-a/alias.txt"));
    await symlink(join(root, "case-b"), join(root, "case-a/foreign-directory"), "junction");
    const [selected, foreign, alias] = await documents.prepare(workspace, ["case-a/source.txt", "case-b/other.txt", "case-a/alias.txt"]);
    for (let attempt = 0; attempt < 200; attempt++) {if ((await documents.list(workspace)).every(record => record.status === "readable")) break; await Bun.sleep(10);}
    const directory = join(root, "case-a");
    for (const source of [foreign, alias]) await expect(ProtectedDocumentTools.open({documents, workspace, directory, sources: [{id: source.id, hash: source.hash}]})).rejects.toMatchObject({code: "protected_source_denied"});
    const tools = await ProtectedDocumentTools.open({documents, workspace, directory, sources: [{id: selected.id, hash: selected.hash}]});
    const signal = new AbortController().signal;
    const output = {kind: "summary", outputLanguage: "cs", documentIds: [selected.id], entries: [{documentId: selected.id, summary: "Synthetic selected-case summary"}]};
    await expect(tools.invoke("lawoss_documents_export", {...output, path: "case-b/foreign.md"}, signal)).rejects.toMatchObject({code: "protected_output_denied"});
    await expect(access(join(root, "case-b/foreign.md"))).rejects.toBeDefined();
    await expect(tools.invoke("lawoss_documents_export", {...output, path: "case-a/foreign-directory/aliased.md"}, signal)).rejects.toMatchObject({code: "protected_output_denied"});
    await expect(access(join(root, "case-b/aliased.md"))).rejects.toBeDefined();
    expect(await tools.invoke("lawoss_documents_export", {...output, path: "case-a/summary.md"}, signal)).toMatchObject({path: "case-a/summary.md", legalApproval: false});
    expect(await tools.invoke("lawoss_documents_validate", {paths: ["case-a/summary.md"], documentIds: [selected.id], outputLanguage: "cs"}, signal)).toMatchObject({valid: true});
    await writeFile(join(root, "case-b/copied.md"), await readFile(join(root, "case-a/summary.md")));
    await rm(join(root, "case-a/summary.md"));
    await symlink(join(root, "case-b/copied.md"), join(root, "case-a/summary.md"));
    await expect(tools.invoke("lawoss_documents_validate", {paths: ["case-a/summary.md"], documentIds: [selected.id], outputLanguage: "cs"}, signal)).rejects.toMatchObject({code: "protected_output_denied"});
  } finally {await documents.stop(); preparation.stop(); ocr.stop(); await rm(root, {recursive: true, force: true});}
});

test("credential, application instructions and their innocently named aliases are never admitted as protected evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "protected-document-secrets-"));
  const workspace: WorkspaceInfo = {id: "synthetic", name: "Synthetic", path: root, preset: "", workspaceType: "local"};
  const ocr = new OcrManager(join(root, "ocr")), preparation = new DocumentPreparation(ocr);
  const documents = new LawossDocuments({configPath: join(root, "config.json")}, preparation);
  try {
    await mkdir(join(root, ".git"));
    for (const path of [".env", ".git/config", "AGENTS.md", "CLAUDE.md"]) await writeFile(join(root, path), "SYNTHETIC-CONFIG-CANARY");
    await symlink(join(root, "AGENTS.md"), join(root, "ordinary.txt"));
    const selected = await documents.prepare(workspace, [".env", ".git/config", "AGENTS.md", "CLAUDE.md", "ordinary.txt"]);
    for (let attempt = 0; attempt < 200; attempt++) {if ((await documents.list(workspace)).every(record => !["uploaded", "preparing"].includes(record.status))) break; await Bun.sleep(10);}
    for (const source of selected) await expect(ProtectedDocumentTools.open({documents, workspace, sources: [{id: source.id, hash: source.hash}]})).rejects.toMatchObject({code: "protected_source_denied"});
  } finally {await documents.stop(); preparation.stop(); ocr.stop(); await rm(root, {recursive: true, force: true});}
});
