export const DEFAULT_DOCUMENT_AUTHOR = "Legal Cowork";

export function resolveDocumentAuthor(author: string | null | undefined): string {
  return author?.trim() || DEFAULT_DOCUMENT_AUTHOR;
}
