import { z } from "zod";
import { ApiError } from "../../errors.js";
import type { LawossDocuments } from "../documents/service.js";
import type { WorkspaceInfo } from "../../types.js";
import { fingerprint, sha256 } from "./hash.js";
import { evidenceSchema, locatorSchema } from "./schema.js";
import type { EvidenceRef } from "./types.js";
export const evidenceSelectionSchema = z.strictObject({ documentIds: z.array(z.string().min(1)).min(1).max(2), locators: z.array(z.strictObject({ documentId: z.string().min(1), locator: locatorSchema })).min(1).max(20) });
export type EvidenceSelection = z.infer<typeof evidenceSelectionSchema>;
export type DocumentEvidencePort = Pick<LawossDocuments, "read" | "evidence">;
/** Extracted text is evidence, never executable model instructions. */
export async function readDeadlineEvidence(documents: DocumentEvidencePort, workspace: WorkspaceInfo, value: EvidenceSelection): Promise<readonly EvidenceRef[]> {
  const selection = evidenceSelectionSchema.parse(value), refs: EvidenceRef[] = [];
  if (new Set(selection.documentIds).size !== selection.documentIds.length || selection.locators.some(ref => !selection.documentIds.includes(ref.documentId)) || selection.documentIds.some(id => !selection.locators.some(ref => ref.documentId === id))) throw new ApiError(400, "deadline_selection", "Every selected document needs an exact locator.");
  for (const documentId of selection.documentIds) {
    let offset: number | null = 0, text = "", firstHash: string | null = null;
    const seen = new Set<number>(), pageRanges: Array<{ page: number | null; start: number; end: number }> = [];
    while (offset !== null) {
      if (seen.has(offset) || text.length > 2_000_000) throw new ApiError(409, "deadline_evidence_limit", "Prepared text cursor is incomplete or exceeds the bound.");
      seen.add(offset);
      const chunk = await documents.read(workspace, documentId, offset, 16000);
      if (chunk.workspaceId !== workspace.id || chunk.offset !== offset || (firstHash && chunk.hash !== firstHash)) throw new ApiError(409, "deadline_stale", "Document changed while reading.");
      firstHash = chunk.hash;
      let pageStart = 0;
      for (const page of chunk.pages) { const at = chunk.text.indexOf(page.text, pageStart); if (at >= 0) { pageRanges.push({ page: page.page, start: offset + at, end: offset + at + page.text.length }); pageStart = at + page.text.length; } }
      text += chunk.text;
      if (chunk.nextOffset !== null && chunk.nextOffset !== text.length) throw new ApiError(409, "deadline_cursor", "Prepared text cursor skipped evidence.");
      offset = chunk.nextOffset;
    }
    const evidence = await documents.evidence(workspace, documentId);
    if (evidence.hash !== firstHash || evidence.workspaceId !== workspace.id) throw new ApiError(409, "deadline_stale", "Prepared evidence changed.");
    const parentChainHashes: string[] = [], lineage: string[] = [evidence.provenance.attachmentName ?? ""];
    let original = evidence;
    const parentIds = new Set([evidence.id]);
    while (original.provenance.parentId) {
      if (parentIds.has(original.provenance.parentId) || parentIds.size > 4) throw new ApiError(409, "deadline_parent", "Document provenance is cyclic.");
      parentIds.add(original.provenance.parentId);
      const parent = await documents.evidence(workspace, original.provenance.parentId);
      if (parent.hash !== original.provenance.parentHash) throw new ApiError(409, "deadline_parent", "Parent evidence changed.");
      parentChainHashes.push(parent.hash); lineage.unshift(parent.provenance.attachmentName ?? ""); original = parent;
    }
    for (const selected of selection.locators.filter(ref => ref.documentId === documentId)) {
      const locator = selected.locator;
      if (text.slice(locator.start, locator.end) !== locator.quote || sha256(locator.quote) !== locator.quoteHash || (locator.preparationHash !== null && sha256(text) !== locator.preparationHash) || (locator.page !== null && !pageRanges.some(range => range.page === locator.page && range.start <= locator.start && range.end >= locator.end))) throw new ApiError(409, "deadline_locator", "The exact source locator does not match current extracted text.");
      refs.push(evidenceSchema.parse({ sourceLineageId: fingerprint({ sourcePath: original.provenance.sourcePath, lineage }), documentId, originalId: original.id, relativePath: original.provenance.sourcePath, sha256: evidence.hash, parentChainHashes, locator: { ...locator, preparationHash: sha256(text) }, retrievedAt: new Date().toISOString(), completeness: evidence.complete && evidence.status === "readable" && evidence.pages.every(page => page.status === undefined || page.status === "complete") ? "complete" : evidence.status === "failed" ? "failed" : "partial" }));
    }
  }
  return refs;
}
