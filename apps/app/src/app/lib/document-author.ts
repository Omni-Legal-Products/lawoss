/**
 * Shared document-author preference helpers.
 *
 * The preference lives in the existing `legalwork.preferences` payload so
 * older installations can adopt it without a migration. Keep this module
 * independent from React: the DOCX editor and the Office task pane both use
 * the same normalization and fallback rules.
 */

export const DOCUMENT_AUTHOR_STORAGE_KEY = "legalwork.preferences";
export const DEFAULT_DOCUMENT_AUTHOR = "LegalWork";
export const MAX_DOCUMENT_AUTHOR_LENGTH = 80;

export function normalizeDocumentAuthor(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_DOCUMENT_AUTHOR;
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, MAX_DOCUMENT_AUTHOR_LENGTH).trim();
  return normalized || DEFAULT_DOCUMENT_AUTHOR;
}

export function documentAuthorFromPreferences(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return DEFAULT_DOCUMENT_AUTHOR;
  return normalizeDocumentAuthor((value as { documentAuthor?: unknown }).documentAuthor);
}

type StorageReader = Pick<Storage, "getItem">;

function browserStorage(): StorageReader | null {
  if (typeof globalThis === "undefined") return null;
  const storage = (globalThis as typeof globalThis & { localStorage?: StorageReader }).localStorage;
  return storage ?? null;
}

/** Read the author for non-React consumers such as the Office task pane. */
export function readStoredDocumentAuthor(storage: StorageReader | null = browserStorage()): string {
  if (!storage) return DEFAULT_DOCUMENT_AUTHOR;
  try {
    const raw = storage.getItem(DOCUMENT_AUTHOR_STORAGE_KEY);
    if (!raw) return DEFAULT_DOCUMENT_AUTHOR;
    return documentAuthorFromPreferences(JSON.parse(raw) as unknown);
  } catch {
    return DEFAULT_DOCUMENT_AUTHOR;
  }
}
