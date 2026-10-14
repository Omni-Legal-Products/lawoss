import { z } from "zod";
export const documentPageSchema = z.object({ page: z.number().int().positive().nullable(), text: z.string().max(2_000_000), source: z.enum(["native", "ocr"]).optional(), status: z.enum(["complete", "needs-review", "error"]).optional() });
export const documentRecordSchema = z.object({
  id: z.string().uuid(), workspaceId: z.string(), path: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["uploaded", "preparing", "readable", "partial", "failed"]),
  extraction: z.enum(["native", "ocr"]).optional(), pages: z.array(documentPageSchema).max(2001),
  complete: z.boolean(), issue: z.string().optional(), updatedAt: z.number(), admittedAt: z.number().int().nonnegative().optional(),
  provenance: z.object({ sourcePath: z.string(), parentId: z.string().uuid().optional(), parentHash: z.string().optional(), attachmentName: z.string().optional(), depth: z.number().int().nonnegative() }),
});
export type DocumentRecord = z.infer<typeof documentRecordSchema>;
export type DocumentSummary = Omit<DocumentRecord, "pages"> & { pageCount: number; readablePages: number };
export type DocumentEvidence = DocumentSummary & { pages: Array<Omit<DocumentRecord["pages"][number], "text">> };
export type DocumentRead = DocumentSummary & { text: string; pages: DocumentRecord["pages"]; offset: number; nextOffset: number | null; untrusted: true };
export const DOCUMENT_LIMITS = { sources: 20, records: 500, active: 100, bytes: 64 * 1024 * 1024, attachmentBytes: 64 * 1024 * 1024, queuedBytes: 128 * 1024 * 1024, attachments: 32, depth: 3, text: 2_000_000, read: 16_000 };
