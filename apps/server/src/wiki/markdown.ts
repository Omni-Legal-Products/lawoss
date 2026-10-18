import { posix } from "node:path";
import { parse, stringify } from "yaml";
import { z } from "zod";
import type { WikiLink, WikiPage, WikiValue } from "@legalwork/types/wiki";

export function markdownData(content: string): { data: Record<string, unknown>; body: string; warning?: string } {
  const match = content.match(/^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/);
  if (!match) return { data: {}, body: content };
  try {
    const data: unknown = parse(match[1], { maxAliasCount: 20 });
    const parsed = z.record(z.string(), z.unknown()).safeParse(data ?? {});
    if (!parsed.success) return { data: {}, body: content.slice(match[0].length), warning: "Properties must be a YAML mapping." };
    return { data: parsed.data, body: content.slice(match[0].length) };
  } catch {
    return { data: {}, body: content.slice(match[0].length), warning: "Invalid YAML properties; fix the frontmatter to use these properties." };
  }
}

export function markdownWithData(content: string, updates: Record<string, unknown>): string {
  const parsed = markdownData(content);
  if (parsed.warning) throw new Error(parsed.warning);
  return `---\n${stringify({ ...parsed.data, ...updates }).trimEnd()}\n---\n${parsed.body}`;
}

function value(input: unknown, depth = 0): WikiValue {
  if (depth > 12) return null;
  if (input === null || typeof input === "string" || typeof input === "boolean") return input;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (Array.isArray(input)) return input.map((item: unknown) => value(item, depth + 1));
  if (typeof input === "object" && input) {
    return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, value(item, depth + 1)]));
  }
  return null;
}

function references(content: string, property: string | null): WikiLink[] {
  const links: WikiLink[] = [];
  const prose = content.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "").replace(/`[^`]*`/g, "");
  for (const match of prose.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
    const [target, label] = match[1].replace(/\\\|/g, "|").split("|");
    if (target.trim()) links.push({ target: target.trim().split("#")[0], label: label?.trim() || target.trim(), property, resolved: false });
  }
  for (const match of prose.matchAll(/(?<!!)\[([^\]\n]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    let target = match[2].replace(/^<|>$/g, "").split("#")[0];
    try { target = decodeURIComponent(target); } catch { continue; }
    if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target) || !/\.md$/i.test(target)) continue;
    links.push({ target, label: match[1] || target, property, resolved: false });
  }
  return links;
}

function propertyReferences(input: WikiValue, property: string): WikiLink[] {
  if (typeof input === "string") return references(input, property);
  if (Array.isArray(input)) return input.flatMap((item) => propertyReferences(item, property));
  if (typeof input === "object" && input) return Object.values(input).flatMap((item) => propertyReferences(item, property));
  return [];
}

export function parseWikiPage(path: string, content: string, revision: string, updatedAt: number): { page: WikiPage; warning?: string } {
  const { data, body, warning } = markdownData(content);
  const properties = Object.fromEntries(Object.entries(data).map(([key, item]) => [key, value(item)]));
  const heading = body.match(/^#\s+(.+)$/m)?.[1].trim();
  const page: WikiPage = {
    path,
    title: typeof properties.title === "string" ? properties.title : heading || posix.basename(path, posix.extname(path)),
    type: typeof properties.type === "string" ? properties.type : "page",
    properties,
    links: [...references(body, null), ...Object.entries(properties).flatMap(([key, item]) => propertyReferences(item, key))],
    excerpt: body.replace(/^#+\s+.+$/gm, "").replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, "$2$1").replace(/[\n\r\s]+/g, " ").trim().slice(0, 280),
    revision,
    updatedAt,
  };
  return { page, ...(warning ? { warning } : {}) };
}

export function resolveWikiLinks(pages: WikiPage[]): WikiPage[] {
  const targets = new Map<string, Set<string>>();
  const add = (key: string, path: string) => {
    const normalized = key.toLocaleLowerCase();
    const matches = targets.get(normalized) ?? new Set<string>();
    matches.add(path);
    targets.set(normalized, matches);
  };
  for (const page of pages) {
    add(page.path, page.path);
    add(page.path.replace(/\.md$/i, ""), page.path);
    add(posix.basename(page.path).replace(/\.md$/i, ""), page.path);
    add(page.title, page.path);
    if (typeof page.properties.id === "string") add(page.properties.id, page.path);
    const aliases = page.properties.aliases;
    if (typeof aliases === "string") add(aliases, page.path);
    if (Array.isArray(aliases)) for (const alias of aliases) if (typeof alias === "string") add(alias, page.path);
  }
  const paths = new Set(pages.map((page) => page.path));
  return pages.map((page) => ({
    ...page,
    links: page.links.map((link) => {
      const relative = posix.normalize(posix.join(posix.dirname(page.path), link.target));
      const relativePath = /\.md$/i.test(relative) ? relative : `${relative}.md`;
      if (paths.has(relativePath)) return { ...link, target: relativePath, resolved: true };
      const matches = targets.get(link.target.replace(/^\//, "").toLocaleLowerCase());
      if (matches?.size === 1) return { ...link, target: [...matches][0], resolved: true };
      return link;
    }),
  }));
}
