import { fromMarkdown } from "mdast-util-from-markdown";
import type { Nodes } from "mdast";
import { setWikiProperty, wikiFrontmatter, wikiPropertyFields } from "./wiki-properties";

function plainText(node: Nodes): string {
  if ("value" in node) return node.value;
  if ("alt" in node) return node.alt ?? "";
  return "children" in node ? node.children.map(plainText).join("") : "";
}

/** Only a leading H1 is the page title; later headings belong to the body. */
export function wikiPageHeading(content: string, fallback: string) {
  const offset = wikiFrontmatter(content)?.end ?? (content.startsWith("\uFEFF") ? 1 : 0);
  const first = fromMarkdown(content.slice(offset)).children[0];
  const heading = first?.type === "heading" && first.depth === 1 ? first : undefined;
  const title = wikiPropertyFields(content).fields.find(field => field.key === "title");
  return {
    title: heading ? plainText(heading) : typeof title?.value === "string" ? title.value : fallback,
    heading: heading?.position ? { start: offset + heading.position.start.offset!, end: offset + heading.position.end.offset! } : null,
  };
}

/** Rich text edits only the body; retain the exact title and metadata prefix. */
export function preserveWikiPageHeading(previous: string, body: string): string {
  const { heading } = wikiPageHeading(previous, "");
  if (!heading) return body;
  const offset = wikiFrontmatter(body)?.end ?? (body.startsWith("\uFEFF") ? 1 : 0);
  const newline = previous.includes("\r\n") ? "\r\n" : "\n";
  return previous.slice(0, heading.end) + newline + newline + body.slice(offset).trimStart();
}

/** A title edit changes only the title sources, never the remaining document. */
export function setWikiPageHeading(content: string, title: string): string {
  const value = title.trim();
  if (!value || /[\r\n]/.test(value)) return content;
  const current = wikiPageHeading(content, "");
  if (value === current.title) return content;
  const titleField = wikiPropertyFields(content).fields.find(field => field.key === "title");
  const escaped = value.replace(/[\\`*_{}\[\]<>#!]/g, "\\$&");
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  let next = content;
  if (current.heading) next = content.slice(0, current.heading.start) + `# ${escaped}` + content.slice(current.heading.end);
  else if (!titleField) {
    const offset = wikiFrontmatter(content)?.end ?? (content.startsWith("\uFEFF") ? 1 : 0);
    next = content.slice(0, offset) + `# ${escaped}${newline}${newline}` + content.slice(offset);
  }
  if (titleField?.editable && typeof titleField.value === "string") next = setWikiProperty(next, "title", value);
  return next;
}
