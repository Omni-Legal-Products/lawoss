import { DEFAULT_DOCUMENT_AUTHOR, normalizeDocumentAuthor } from "@/app/lib/document-author";

/** A fallback editor label is not a lawyer identity or a grant of authority. */
export function lawyerName(documentAuthor: unknown): string | undefined {
  const name = normalizeDocumentAuthor(documentAuthor);
  return name === DEFAULT_DOCUMENT_AUTHOR ? undefined : name;
}
