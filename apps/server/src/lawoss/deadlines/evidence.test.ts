import { expect, test } from "bun:test";
import { readDeadlineEvidence } from "./evidence.js";
import { sha256 } from "./hash.js";
import type { DocumentRead } from "../documents/types.js";
import type { WorkspaceInfo } from "../../types.js";

test("follows every prepared read cursor and checks exact locator, no fuzzy match", async () => {
  const full = "x".repeat(16000) + "15 days";
  const calls: number[] = [];
  const metadata = { id: "decision", workspaceId: "w", path: "decision.txt", hash: sha256(full), status: "readable" as const, complete: true, updatedAt: 1, provenance: { sourcePath: "decision.txt", depth: 0 }, pageCount: 1, readablePages: 1 };
  const port = { read: async (_workspace: WorkspaceInfo, _id: string, offset = 0): Promise<DocumentRead> => { calls.push(offset); return { ...metadata, offset, text: full.slice(offset, offset + 16000), nextOffset: offset === 0 ? 16000 : null, pages: [{ page: null, text: full.slice(offset, offset + 16000), status: "complete" }], untrusted: true }; }, evidence: async () => ({ ...metadata, pages: [{ page: null, status: "complete" as const }] }) };
  const selection = { documentIds: ["decision"], locators: [{ documentId: "decision", locator: { locatorId: "appeal", page: null, start: 16000, end: 16007, quote: "15 days", quoteHash: sha256("15 days"), preparationHash: sha256(full) } }] };
  const refs = await readDeadlineEvidence(port, { id: "w", path: "/not-used" } as WorkspaceInfo, selection);
  expect(calls).toEqual([0, 16000]); expect(refs[0]?.locator.quote).toBe("15 days");
  await expect(readDeadlineEvidence(port, { id: "w" } as WorkspaceInfo, { ...selection, locators: [{ ...selection.locators[0]!, locator: { ...selection.locators[0]!.locator, start: 15999 } }] })).rejects.toThrow("locator");
});
