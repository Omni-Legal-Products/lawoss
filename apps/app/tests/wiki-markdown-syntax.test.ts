import { describe, expect, test } from "bun:test";
import { fromMarkdown, type Extension as MdastExtension } from "mdast-util-from-markdown";
import { toMarkdown, type Options } from "mdast-util-to-markdown";
import type { Extension } from "micromark-util-types";
import { frontmatter } from "micromark-extension-frontmatter";
import { frontmatterFromMarkdown, frontmatterToMarkdown } from "mdast-util-frontmatter";
import remarkGfm from "remark-gfm";
import { wikiEditorLinkTarget, wikiLinkFromMarkdown, wikiLinkSyntax, wikiLinkToMarkdown } from "../src/react-app/domains/wiki/wiki-markdown-syntax";
import { parseViewReference, viewLink } from "../src/react-app/domains/views/view-reference";

function roundTrip(markdown: string) {
  const tree = fromMarkdown(markdown, { extensions: [frontmatter(), wikiLinkSyntax], mdastExtensions: [frontmatterFromMarkdown("yaml"), wikiLinkFromMarkdown] });
  return toMarkdown(tree, { extensions: [frontmatterToMarkdown("yaml"), wikiLinkToMarkdown] });
}

test("wiki links in table cells survive saves without becoming cell separators", () => {
  const data: {
    micromarkExtensions: Extension[];
    fromMarkdownExtensions: MdastExtension[];
    toMarkdownExtensions: Options[];
  } = { micromarkExtensions: [], fromMarkdownExtensions: [], toMarkdownExtensions: [] };
  remarkGfm.call({ data: () => data });
  const parse = (source: string) => fromMarkdown(source, {
    extensions: [...data.micromarkExtensions, wikiLinkSyntax],
    mdastExtensions: [...data.fromMarkdownExtensions, wikiLinkFromMarkdown],
  });
  const original = parse("| Note |\n| --- |\n| Before [[Instructions.md\\|Working in this wiki]] after. |\n");
  expect(original.children[0]).toMatchObject({ type: "table", children: [
    { type: "tableRow", children: [{ type: "tableCell" }] },
    { type: "tableRow", children: [{ type: "tableCell", children: [
      { type: "text", value: "Before " },
      { type: "link", url: "#wiki:Instructions.md", children: [{ type: "text", value: "Working in this wiki" }] },
      { type: "text", value: " after." },
    ] }] },
  ] });
  const saved = toMarkdown(original, { extensions: [...data.toMarkdownExtensions, wikiLinkToMarkdown] });
  expect(saved).toContain("[[Instructions.md\\|Working in this wiki]]");
  const restored = parse(saved);
  expect(restored.children[0]).toMatchObject({ type: "table", children: [
    { children: [{ type: "tableCell" }] },
    { children: [{ children: [{ type: "text" }, { type: "link", url: "#wiki:Instructions.md" }, { type: "text" }] }] },
  ] });
});

describe("wiki links in the shared Markdown editor", () => {
  test("dashboard and report links retain their destinations through editor import, tab routing and saving", () => {
    for (const kind of ["wiki", "workspace"] satisfies ("wiki" | "workspace")[]) {
      const reference = { owner: { kind, id: "firm / Über" }, viewId: "11111111-1111-4111-8111-111111111111" };
      const href = viewLink(reference);
      const source = `[Open in its own tab](${href})\n`;
      const tree = fromMarkdown(source, { extensions: [wikiLinkSyntax], mdastExtensions: [wikiLinkFromMarkdown] });
      const paragraph = tree.children[0];
      if (paragraph.type !== "paragraph" || paragraph.children[0].type !== "link") throw new Error("Expected a link");
      const url = paragraph.children[0].url;
      expect(url).toStartWith("#wiki-path:");
      expect(parseViewReference(wikiEditorLinkTarget(url))).toEqual(reference);
      expect(toMarkdown(tree, { extensions: [wikiLinkToMarkdown] })).toBe(source);
      expect(roundTrip(`[**Open report**](${href} "Report")\n`)).toBe(`[**Open report**](${href} "Report")\n`);
    }
  });
  test("unsupported schemes never receive a safe editor fragment", () => {
    for (const href of ["javascript:alert(1)", "file:///etc/passwd", "legalwork-view://wiki/firm/invalid"]) {
      const tree = fromMarkdown(`[Link](<${href}>)`, { mdastExtensions: [wikiLinkFromMarkdown] });
      const paragraph = tree.children[0];
      if (paragraph.type !== "paragraph" || paragraph.children[0].type !== "link") throw new Error("Expected a link");
      const url = paragraph.children[0].url;
      expect(url).toBe(href);
    }
  });
  test("preserves page paths, aliases, Unicode and heading destinations after body edits", () => {
    const input = '[[Clients/Acme.md]] and [[Research/Überblick#Sources|Evidence]]\n';
    expect(roundTrip(input)).toBe(input);
    expect(roundTrip(input + '\nNew **body**.\n')).toContain(input);
  });
  test("uses a safe fragment URL in the editor and restores wiki syntax on save", () => {
    const tree = fromMarkdown("[[Clients/Überblick.md#Sources|Evidence]]", { extensions: [wikiLinkSyntax], mdastExtensions: [wikiLinkFromMarkdown] });
    expect(tree.children[0]).toMatchObject({ type: "paragraph", children: [{ type: "link", url: "#wiki:Clients%2F%C3%9Cberblick.md%23Sources" }] });
    expect(toMarkdown(tree, { extensions: [wikiLinkToMarkdown] })).toBe("[[Clients/Überblick.md#Sources|Evidence]]\n");
    expect(roundTrip("[Acme](#wiki:Clients%2FAcme.md)\n")).toBe("[[Clients/Acme.md|Acme]]\n");
  });
  test("preserves links to documents, images and saved dashboards", () => {
    for (const target of ["Templates/Engagement letter.docx", "Evidence/Contract.pdf", "Assets/Logo.png", "Reports/Firm.view.json"]) {
      expect(roundTrip(`[[${target}|Open file]]\n`)).toBe(`[[${target}|Open file]]\n`);
    }
  });
  test("keeps nested YAML definitions unchanged while editing the body", () => {
    const yaml = '---\ntype: page\naliases: [One, Two]\nviews:\n  - name: Deals\n    filter:\n      type: deal\n    columns: [title, status]\nsummary: |\n  Keep this multiline text.\n---\n';
    expect(roundTrip(yaml + '\n# Views\n\n[[Client]]\n')).toStartWith(yaml);
  });
  test("leaves ordinary Markdown links and bracket literals as their original kinds", () => {
    const input = '[Web](https://example.com) and [Page](../Other.md#Sources)\n\n`[[Code]]`\n\n```md\n[[Fenced code]]\n```\n\n\\[\\[Literal]]\n';
    const output = roundTrip(input);
    expect(output).toContain('[Web](https://example.com)');
    expect(output).toContain('[Page](../Other.md#Sources)');
    expect(output).toContain('`[[Code]]`');
    expect(output).toContain('```md\n[[Fenced code]]\n```');
    const tree = fromMarkdown(output, { extensions: [wikiLinkSyntax], mdastExtensions: [wikiLinkFromMarkdown] });
    expect(tree.children.at(-1)).toMatchObject({ type: 'paragraph', children: [{ type: 'text', value: '[[Literal]]' }] });
  });
  test("converts links authored through the standard Create Link dialog", () => {
    expect(roundTrip('[Acme]([[Clients/Acme.md]])\n')).toBe('[[Clients/Acme.md|Acme]]\n');
    expect(roundTrip('[Acme](wiki:Clients%2FAcme.md)\n')).toBe('[[Clients/Acme.md|Acme]]\n');
    expect(toMarkdown({ type: 'root', children: [{ type: 'paragraph', children: [{ type: 'link', url: '[[Clients/Acme.md]]', children: [{ type: 'text', value: '[[Clients/Acme.md]]' }] }] }] }, { extensions: [wikiLinkToMarkdown] })).toBe('[[Clients/Acme.md]]\n');
  });
  test("preserves formatting and hover titles in Markdown links", () => {
    expect(roundTrip('[**Client**](../Client.md "Details")\n')).toBe('[**Client**](../Client.md "Details")\n');
  });
  test("treats incomplete or empty wiki links as text", () => {
    for (const source of ['[[', '[[]]', '[[|Alias]]', '[[One\nTwo]]']) {
      const tree = fromMarkdown(source, { extensions: [wikiLinkSyntax], mdastExtensions: [wikiLinkFromMarkdown] });
      expect(JSON.stringify(tree)).not.toContain('"type":"link"');
    }
  });
});


test("relative attachment links retain their original destination in the editor and on save", () => {
  const source = '[Edit](Attachments/Editable.txt "Original")\n';
  const tree = fromMarkdown(source, { extensions: [wikiLinkSyntax], mdastExtensions: [wikiLinkFromMarkdown] });
  expect(tree.children[0]).toMatchObject({ type: "paragraph", children: [{ type: "link", url: "#wiki-path:Attachments%2FEditable.txt", title: "Original" }] });
  expect(roundTrip(source)).toBe(source);
});
