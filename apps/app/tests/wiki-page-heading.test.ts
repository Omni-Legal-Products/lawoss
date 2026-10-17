import { expect, test } from "bun:test";
import { wikiPageHeading, setWikiPageHeading, preserveWikiPageHeading } from "../src/react-app/domains/wiki/wiki-page-heading";

test("only the leading heading supplies the title", () => {
  expect(wikiPageHeading('---\ntitle: Old\n---\n\n# **Client** Alpha\n\nBody\n', "File").title).toBe("Client Alpha");
  expect(wikiPageHeading('---\ntitle: Metadata title\n---\nBody\n\n# Later heading\n', "File")).toEqual({ title: "Metadata title", heading: null });
  expect(wikiPageHeading("Body without title", "Filename")).toEqual({ title: "Filename", heading: null });
});

test("title edits preserve unknown metadata, comments, line endings and exact body bytes", () => {
  const source = '\uFEFF---\r\ntitle: Before # keep\r\nunknown: {x: [1, 2]}\r\n---\r\n\r\n# Before\r\n\r\nExact  **body**\r\n\r\n# Later\r\n';
  expect(setWikiPageHeading(source, "Before")).toBe(source);
  expect(setWikiPageHeading(source, "After")).toBe(source.replace('title: Before', 'title: "After"').replace('# Before', '# After'));
  expect(setWikiPageHeading(source, "")).toBe(source);
});

test("setext and escaped titles can be renamed without replacing the body", () => {
  const updated = setWikiPageHeading("Original\n========\n\nBody with  spaces\n", "Client [A] *B*");
  expect(updated).toBe("# Client \\[A\\] \\*B\\*\n\nBody with  spaces\n");
  expect(wikiPageHeading(updated, "").title).toBe("Client [A] *B*");
});

test("metadata-only and untitled pages keep their content when renamed", () => {
  const source = '---\ntitle: Before\n---\n\nBody\n';
  expect(setWikiPageHeading(source, "After")).toBe(source.replace('title: Before', 'title: "After"'));
  expect(setWikiPageHeading("\uFEFFBody\n", "New")).toBe("\uFEFF# New\n\nBody\n");
});

test("body edits retain the authored title and metadata without consuming body headings", () => {
  const source = '\uFEFF---\r\ntitle: Client # comment\r\nunknown: {x: [1, 2]}\r\n---\r\n\r\nClient **A**\r\n========\r\n\r\nOriginal body';
  const body = '---\nunknown: changed serialization\n---\n\n# Body heading\n\nNew body';
  expect(preserveWikiPageHeading(source, body)).toBe(source.replace('Original body', '# Body heading\n\nNew body'));
  expect(preserveWikiPageHeading('# Title\n\nBody', '')).toBe('# Title\n\n');
  expect(preserveWikiPageHeading('No title\n', '# New heading\n')).toBe('# New heading\n');
});
