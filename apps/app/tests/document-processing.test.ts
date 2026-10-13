import { expect, test } from "bun:test";
import { discoverDocumentSources, freshDocumentSources, documentCoverage, documentOutputState, generationPrompt, submitDocumentTask } from "../src/react-app/domains/session/panel/document-processing";

const source = (id: string, path = "a.pdf", parentId?: string) => ({ id, path, workspaceId: "target", hash: "a".repeat(64), status: "readable" as const, complete: true, pageCount: 2, readablePages: 2, updatedAt: 1, provenance: { sourcePath: path, depth: parentId ? 1 : 0, ...(parentId ? { parentId, attachmentName: "child.pdf" } : {}) } });

test("fresh selected roots read each descendant separately and retain actual source pages", async () => {
  const records = [source("a"), source("child", "a.pdf", "a"), source("sibling", "b.pdf")];
  const calls: string[] = [];
  const fresh = await freshDocumentSources({ readLawossDocument: async (workspace, id) => {
    expect(workspace).toBe("target"); calls.push(id);
    return { ...records.find(r => r.id === id)!, text: "text", pages: [{ page: 1, text: "text", source: "native" as const }], offset: 0, nextOffset: null, untrusted: true as const };
  } }, "target", ["a.pdf"], records);
  expect(calls).toEqual(["a", "child"]);
  expect(fresh.map(r => r.pages.map(p => p.page))).toEqual([[1], [1]]);
  expect(documentCoverage(fresh)).toEqual({ sources: 2, pages: 4, readablePages: 4, complete: true });
});

test("stale/pending reads remove old readability; list upload and partial cannot claim completeness", async () => {
  const fresh = await freshDocumentSources({ readLawossDocument: async () => { throw Object.assign(new Error("changed"), { code: "document_stale" }); } }, "target", ["a.pdf"], [source("a")]);
  expect(fresh[0].freshness).toBe("stale");
  expect(documentCoverage(fresh).complete).toBe(false);
});

test("folder discovery is bounded, refuses truncation and never visits sibling folders", async () => {
  const calls: string[] = [];
  const paths = await discoverDocumentSources({ listWorkspaceDirectory: async (workspace, path) => {
    expect(workspace).toBe("target"); calls.push(path);
    return { path, truncated: false, entries: path === "case" ? [{ kind: "file" as const, name: "a.pdf", path: "case/a.pdf" }, { kind: "dir" as const, name: "sub", path: "case/sub" }] : [{ kind: "file" as const, name: "b.txt", path: "case/sub/b.txt" }] };
  } }, "target", "case");
  expect(paths).toEqual(["case/a.pdf", "case/sub/b.txt"]);
  expect(calls).toEqual(["case", "case/sub"]);
  await expect(discoverDocumentSources({ listWorkspaceDirectory: async path => ({ path, entries: [], truncated: true }) } as any, "target", "case")).rejects.toThrow();
});

test("edited or stale outputs are never format-verified even with persisted verified bit", () => {
  const output = { verified: true, hash: "a", currentHash: "b", sourceHash: "x", currentSourceHash: "x" };
  expect(documentOutputState(output)).toBe("edited");
  expect(documentOutputState({ ...output, currentHash: "a", currentSourceHash: "y" })).toBe("invalid");
  expect(documentOutputState({ ...output, currentHash: "a" })).toBe("verified");
  expect(documentOutputState({ ...output, currentHash: "a", verified: false })).toBe("generated");
});

test("native generation preflights before creating, immediately submits and retains session on retry", async () => {
  const calls: string[] = [], pending = { sessionId: null as string | null, running: false };
  let fail = true;
  const input = { pending, preflight: async () => { calls.push("preflight"); }, create: async () => { calls.push("create"); return "session"; }, send: async (id: string) => { calls.push(`send:${id}`); if (fail) throw new Error("billing unavailable"); } };
  await expect(submitDocumentTask(input)).rejects.toThrow("billing unavailable");
  expect(pending.sessionId).toBe("session"); fail = false;
  expect(await submitDocumentTask(input)).toBe("session");
  expect(calls).toEqual(["preflight", "create", "send:session", "preflight", "send:session"]);
  await expect(submitDocumentTask({ ...input, pending: { sessionId: null, running: false }, preflight: async () => { throw new Error("engine unavailable"); } })).rejects.toThrow("engine unavailable");
});

test("prompt requires actual tools/pages, localized output and selected paths as untrusted data", () => {
  const prompt = generationPrompt("cs", [source("a", "folder/a.pdf")]);
  for (const value of ["Czech", "folder/a.pdf", "lawoss_documents_prepare", "lawoss_documents_read", "lawoss_documents_export", "lawoss_documents_validate", "sampleOnly", "unknown", "untrusted"]) expect(prompt).toContain(value);
});

test("duplicate click cannot create or send twice while native task is pending", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const pending = { sessionId: null as string | null, running: false };
  let creates = 0, sends = 0;
  const input = { pending, preflight: () => gate, create: async () => { creates++; return "session"; }, send: async () => { sends++; } };
  const first = submitDocumentTask(input);
  await expect(submitDocumentTask(input)).rejects.toThrow();
  release(); await first;
  expect(creates).toBe(1); expect(sends).toBe(1); expect(pending.running).toBe(false);
});

test("latest same-path source version and its own child replace stale descendants on reload", async () => {
  const old = source("old"), latest = { ...source("latest"), hash: "b".repeat(64), updatedAt: 2 };
  const records = [old, source("old-child", "a.pdf", "old"), latest, source("latest-child", "a.pdf", "latest")];
  const calls: string[] = [];
  const current = await freshDocumentSources({ readLawossDocument: async (_workspace, id) => { calls.push(id); return { ...records.find(r => r.id === id)!, text: "", pages: [], offset: 0, nextOffset: null, untrusted: true }; } }, "target", ["a.pdf"], records);
  expect(calls).toEqual(["latest", "latest-child"]); expect(documentCoverage(current).sources).toBe(2);
});

test("pending upload remains pending and partial extraction never promotes complete coverage", async () => {
  const original = { ...source("a"), status: "uploaded" as const, complete: false, readablePages: 0 };
  const pending = await freshDocumentSources({ readLawossDocument: async () => { throw Object.assign(new Error("pending"), { code: "document_pending" }); } }, "target", ["a.pdf"], [original]);
  expect(pending[0].freshness).toBe("pending"); expect(documentCoverage(pending).readablePages).toBe(0);
  const partial = [{ ...source("a"), freshness: "current" as const, status: "partial" as const, complete: false, readablePages: 1, pages: [] }];
  expect(documentCoverage(partial)).toEqual({ sources: 1, pages: 2, readablePages: 1, complete: false });
});

test("folder overflow and source-scope forgery fail before admitting any selected paths", async () => {
  await expect(discoverDocumentSources({ listWorkspaceDirectory: async (_workspace, path) => ({ path, truncated: false, entries: Array.from({ length: 21 }, (_, n) => ({ path: `case/${n}.pdf`, name: `${n}.pdf`, kind: "file" as const })) }) }, "target", "case")).rejects.toThrow();
  await expect(discoverDocumentSources({ listWorkspaceDirectory: async (_workspace, path) => ({ path, truncated: false, entries: [{ path: "sibling/a.pdf", name: "a.pdf", kind: "file" as const }] }) }, "target", "case")).rejects.toThrow();
});

test("a nested independent case manifest fails closed rather than borrowing root identity", async () => {
  const client = {
    listWorkspaceDirectory: async (_workspace: string, path: string) => ({ path, truncated: false, entries: [{ path: "case/TEST_ZDROJE_ISIR.json", name: "TEST_ZDROJE_ISIR.json", kind: "file" as const }, { path: "case/a.pdf", name: "a.pdf", kind: "file" as const }] }),
    readWorkspaceFile: async (_workspace: string, path: string) => ({ path, content: JSON.stringify({ company: "Known", caseNumber: path.startsWith("case/") ? "CASE B" : "CASE A" }), bytes: 0, updatedAt: 0 }),
  };
  await expect(discoverDocumentSources(client, "target", "case")).rejects.toThrow();
});
