import { extractCorpusText } from "../corpus/extract.js";
import type { DocumentPreparation } from "../document-preparation/service.js";

/** Reuse the server's document readers, independently of agent shell settings or UI. */
export async function storageDocumentText(
  workspace: string, path: string, preparation: DocumentPreparation,
  page: { offset: number; maxChars: number }, signal: AbortSignal,
) {
  const result = await extractCorpusText(workspace, path, preparation, signal);
  const text = result.pages.map(item => item.page === null ? item.text : `[Page ${item.page}]\n${item.text}`).join("\n\n");
  const end = page.offset + page.maxChars;
  return {
    text: text.slice(page.offset, end), total_chars: text.length,
    ...(end < text.length ? { next_offset: end } : {}),
    complete: result.complete, extraction: result.extraction, source_hash: result.hash,
    ...(result.issue ? { issue: result.issue } : {}),
  };
}
