import { isMap, isScalar, isSeq, parseDocument } from "yaml";

export type WikiPropertyScalar = string | number | boolean | null;
export type WikiPropertyValue = WikiPropertyScalar | WikiPropertyScalar[];
export type WikiPropertyField = { key: string; value: WikiPropertyValue; editable: boolean; source: string };
export type WikiPropertyType = "text" | "number" | "boolean" | "date" | "list" | "page" | "pages";

export function wikiPageReference(value: unknown): value is string {
  return typeof value === "string" && /^\[\[[^\r\n]*\]\]$/.test(value);
}

export function wikiPageRelations(value: WikiPropertyValue): value is string | string[] {
  return wikiPageReference(value) || Array.isArray(value) && value.every(wikiPageReference);
}

export function wikiPropertyType(value: WikiPropertyValue): WikiPropertyType {
  if (Array.isArray(value)) return value.length && wikiPageRelations(value) ? "pages" : "list";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (wikiPageReference(value)) return "page";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value) return "date";
  }
  return "text";
}

export function wikiFrontmatter(content: string) {
  const match = /^(\uFEFF?---\r?\n)([\s\S]*?)^((?:---|\.\.\.)(?:\r?\n|$))/m.exec(content);
  if (!match || match.index !== 0) return null;
  return { opening: match[1], yaml: match[2], closing: match[3], end: match[0].length };
}

function scalar(value: unknown): value is WikiPropertyScalar {
  return value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value);
}

function editableValue(node: unknown): WikiPropertyValue | undefined {
  if (isScalar(node) && scalar(node.value) && !node.anchor && !node.tag && node.type !== "BLOCK_LITERAL" && node.type !== "BLOCK_FOLDED") return node.value;
  if (isSeq(node) && !node.anchor && !node.tag) {
    const values: WikiPropertyScalar[] = [];
    for (const item of node.items) {
      const value = editableValue(item);
      if (!scalar(value)) return undefined;
      values.push(value);
    }
    return values;
  }
  return undefined;
}

export function wikiPropertyFields(content: string): { fields: WikiPropertyField[]; error: boolean } {
  const header = wikiFrontmatter(content);
  if (!header) return { fields: [], error: /^\uFEFF?---\r?\n/.test(content) };
  const document = parseDocument(header.yaml, { keepSourceTokens: true });
  if (document.errors.length || document.contents && !isMap(document.contents) || isMap(document.contents) && (document.contents.flow || document.contents.anchor || document.contents.tag)) return { fields: [], error: true };
  if (!isMap(document.contents)) return { fields: [], error: false };
  const fields: WikiPropertyField[] = [];
  for (const pair of document.contents.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string") continue;
    const node = pair.value;
    const value = editableValue(node);
    fields.push({ key: pair.key.value, value: value ?? null, editable: value !== undefined, source: node?.range ? header.yaml.slice(node.range[0], node.range[1]) : "" });
  }
  return { fields, error: false };
}

/** Replace only the selected value's source range, preserving comments and unknown YAML. */
export function setWikiProperty(content: string, key: string, value: WikiPropertyValue): string {
  if (!key.trim() || /[\x00-\x1f\x7f]/.test(key) || ["__proto__", "prototype", "constructor", "<<"].includes(key) || !scalar(value) && !(Array.isArray(value) && value.every(scalar))) throw new Error("Invalid property.");
  const header = wikiFrontmatter(content);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const encoded = JSON.stringify(value);
  const property = `${JSON.stringify(key)}: ${encoded}${newline}`;
  if (!header) {
    if (/^\uFEFF?---\r?\n/.test(content)) throw new Error("Repair the frontmatter in Source before editing properties.");
    const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
    return `${bom}---${newline}${property}---${newline}${newline}${content.slice(bom.length)}`;
  }
  const document = parseDocument(header.yaml, { keepSourceTokens: true });
  if (document.errors.length || document.contents && !isMap(document.contents) || isMap(document.contents) && (document.contents.flow || document.contents.anchor || document.contents.tag)) throw new Error("Repair the frontmatter in Source before editing properties.");
  const pair = isMap(document.contents) ? document.contents.items.find(pair => isScalar(pair.key) && pair.key.value === key) : undefined;
  let yaml: string;
  if (pair) {
    const node = pair.value;
    const current = editableValue(node);
    if (current === undefined || !node?.range) throw new Error("Edit this complex property in Source.");
    if (Array.isArray(current) && !Array.isArray(value)) throw new Error("Edit this list in Source to change its property type.");
    if (JSON.stringify(current) === JSON.stringify(value)) return content;
    if (isSeq(node) && Array.isArray(value) && node.items.length === value.length) {
      yaml = header.yaml;
      for (let index = value.length - 1; index >= 0; index--) {
        const item = node.items[index];
        if (!isScalar(item) || !item.range) throw new Error("Edit this complex property in Source.");
        if (item.value !== value[index]) yaml = yaml.slice(0, item.range[0]) + JSON.stringify(value[index]) + yaml.slice(item.range[1]);
      }
      return header.opening + yaml + header.closing + content.slice(header.end);
    }
    if (isSeq(node) && node.items.some(item => isScalar(item) && (item.comment || item.commentBefore))) throw new Error("Edit this commented list in Source to preserve its comments.");
    const [start, end] = node.range;
    const spacer = start > 0 && header.yaml[start - 1] === ":" ? " " : "";
    const after = start === end && header.yaml[end] === "#" ? " " : "";
    const suffix = isSeq(node) && header.yaml.slice(start, end).endsWith("\n") ? newline : "";
    yaml = header.yaml.slice(0, start) + spacer + encoded + after + suffix + header.yaml.slice(end);
  } else yaml = header.yaml + (header.yaml && !header.yaml.endsWith("\n") ? newline : "") + property;
  return header.opening + yaml + header.closing + content.slice(header.end);
}
