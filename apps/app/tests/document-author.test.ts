import { describe, expect, test } from "bun:test";

import {
  DEFAULT_DOCUMENT_AUTHOR,
  resolveDocumentAuthor,
} from "../src/react-app/domains/session/artifacts/document-author";

describe("document author", () => {
  test("uses the configured attorney name after trimming whitespace", () => {
    expect(resolveDocumentAuthor("  Martina Nováková  ")).toBe("Martina Nováková");
  });

  test("falls back to the safe default when no attorney name is configured", () => {
    expect(resolveDocumentAuthor("")).toBe(DEFAULT_DOCUMENT_AUTHOR);
    expect(resolveDocumentAuthor("   ")).toBe(DEFAULT_DOCUMENT_AUTHOR);
    expect(resolveDocumentAuthor(null)).toBe(DEFAULT_DOCUMENT_AUTHOR);
    expect(resolveDocumentAuthor(undefined)).toBe(DEFAULT_DOCUMENT_AUTHOR);
  });
});
