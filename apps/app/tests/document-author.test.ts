import { describe, expect, test } from "bun:test";

import {
  DEFAULT_DOCUMENT_AUTHOR,
  MAX_DOCUMENT_AUTHOR_LENGTH,
  documentAuthorFromPreferences,
  normalizeDocumentAuthor,
} from "../src/app/lib/document-author";

describe("document author preference", () => {
  test("uses the backwards-compatible default when no name is configured", () => {
    expect(documentAuthorFromPreferences({})).toBe(DEFAULT_DOCUMENT_AUTHOR);
    expect(normalizeDocumentAuthor(null)).toBe(DEFAULT_DOCUMENT_AUTHOR);
  });

  test("trims and collapses surrounding whitespace", () => {
    expect(normalizeDocumentAuthor("  Martin   Friedrich  ")).toBe("Martin Friedrich");
  });

  test("limits the author name to a safe bounded length", () => {
    const value = "x".repeat(MAX_DOCUMENT_AUTHOR_LENGTH + 20);
    expect(normalizeDocumentAuthor(value)).toHaveLength(MAX_DOCUMENT_AUTHOR_LENGTH);
  });

  test("ignores malformed preference payloads", () => {
    expect(documentAuthorFromPreferences(null)).toBe(DEFAULT_DOCUMENT_AUTHOR);
    expect(documentAuthorFromPreferences({ documentAuthor: 42 })).toBe(DEFAULT_DOCUMENT_AUTHOR);
    expect(documentAuthorFromPreferences("not an object")).toBe(DEFAULT_DOCUMENT_AUTHOR);
  });

  test("reads a legacy payload without requiring a migration", () => {
    expect(documentAuthorFromPreferences({ showThinking: true, documentAuthor: " Jana Nováková " })).toBe(
      "Jana Nováková",
    );
  });
});
