import { isMap, isNode, isScalar, isSeq, parseDocument, type CST, type Node } from "yaml";
import { z } from "zod";
import { ApiError } from "../errors.js";

const forbiddenKeys = new Set(["__proto__", "prototype", "constructor", "<<"]);
export const wikiPropertyKeySchema = z.string().min(1).max(200).refine(
  key => Boolean(key.trim()) && !/[\x00-\x1f\x7f]/.test(key) && !forbiddenKeys.has(key),
  "Use a nonempty property name without control characters or reserved keys.",
);
export const wikiPropertyScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const wikiPropertyValueSchema = z.union([wikiPropertyScalarSchema, z.array(wikiPropertyScalarSchema).max(1000)]);
const propertySetSchema = z.preprocess((input, context) => {
  // Zod omits __proto__ record entries before key validation. Reject these names
  // in the original input so a dangerous request cannot become a silent no-op.
  if (input && typeof input === "object" && Object.getOwnPropertyNames(input).some(key => forbiddenKeys.has(key))) {
    context.addIssue({ code: "custom", message: "Reserved property name." });
    return z.NEVER;
  }
  return input;
}, z.record(wikiPropertyKeySchema, wikiPropertyValueSchema));
export const wikiPropertiesPatchSchema = z.object({
  set: propertySetSchema.optional(),
  unset: z.array(wikiPropertyKeySchema).max(200).optional(),
}).strict().superRefine((patch, context) => {
  if (Object.keys(patch.set ?? {}).length > 200) context.addIssue({ code: "custom", message: "Update at most 200 properties at once.", path: ["set"] });
  const unset = new Set<string>();
  for (const key of patch.unset ?? []) {
    if (unset.has(key) || Object.hasOwn(patch.set ?? {}, key)) context.addIssue({ code: "custom", message: "Each property may appear in only one operation.", path: ["unset"] });
    unset.add(key);
  }
});
export type WikiPropertiesPatch = z.infer<typeof wikiPropertiesPatchSchema>;
export type WikiPropertyValue = z.infer<typeof wikiPropertyValueSchema>;
type ScalarValue = z.infer<typeof wikiPropertyScalarSchema>;
type Edit = { start: number; end: number; content: string };
type SourcePair = { key: Node; value: Node | null; srcToken?: CST.CollectionItem };

function invalidSource(): never {
  throw new ApiError(400, "wiki_properties_invalid_source", "Repair the page's YAML properties in Source before updating fields.");
}

function requiresSource(key?: string): never {
  throw new ApiError(400, "wiki_property_requires_source", key
    ? `Property ${JSON.stringify(key)} uses YAML that must be edited in Source to preserve its structure.`
    : "This properties mapping must be edited in Source to preserve its structure.");
}

function scalarValue(value: unknown): value is ScalarValue {
  return value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value);
}

function plainScalar(node: unknown) {
  return isScalar(node) && scalarValue(node.value) && !node.anchor && !node.tag && node.type !== "BLOCK_LITERAL" && node.type !== "BLOCK_FOLDED";
}

function editableValue(node: Node | null, key: string): WikiPropertyValue {
  if (plainScalar(node) && isScalar(node) && scalarValue(node.value)) return node.value;
  if (isSeq(node) && !node.anchor && !node.tag) {
    return node.items.map(item => {
      if (!plainScalar(item) || !isScalar(item) || !scalarValue(item.value)) return requiresSource(key);
      return item.value;
    });
  }
  return requiresSource(key);
}

function hasItemComments(node: Node | null): boolean {
  return isSeq(node) && node.items.some(item => isScalar(item) && (item.comment || item.commentBefore));
}

function scalarEdit(yaml: string, node: Node, value: WikiPropertyValue): Edit {
  if (!node.range) return requiresSource();
  const [start, end] = node.range;
  const before = yaml[start - 1] === ":" || start === end && yaml[start - 1] === "-" ? " " : "";
  const after = start === end && yaml[end] === "#" ? " " : "";
  const newline = isSeq(node) && yaml.slice(start, end).endsWith("\n") ? (yaml[end - 2] === "\r" ? "\r\n" : "\n") : "";
  return { start, end, content: before + JSON.stringify(value) + after + newline };
}

/** Apply typed field changes without serializing the YAML mapping or Markdown body. */
export function patchWikiProperties(content: string, input: WikiPropertiesPatch): string {
  const result = wikiPropertiesPatchSchema.safeParse(input);
  if (!result.success) throw new ApiError(400, "invalid_wiki_properties", "Provide scalar or scalar-array values and distinct, safe property names.");
  const patch = result.data;
  const additions = Object.entries(patch.set ?? {});
  const unset = patch.unset ?? [];
  if (!additions.length && !unset.length) return content;

  const header = /^(\uFEFF?---\r?\n)([\s\S]*?)^((?:---|\.\.\.)(?:\r?\n|$))/m.exec(content);
  const newline = (header?.index === 0 ? header[1].endsWith("\r\n") : content.includes("\r\n")) ? "\r\n" : "\n";
  if (!header || header.index !== 0) {
    if (/^\uFEFF?---\r?\n/.test(content)) return invalidSource();
    if (!additions.length) return content;
    const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
    const fields = additions.map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}${newline}`).join("");
    return `${bom}---${newline}${fields}---${newline}${newline}${content.slice(bom.length)}`;
  }

  const yaml = header[2];
  const document = parseDocument(yaml, { keepSourceTokens: true });
  if (document.errors.length || document.contents && !isMap(document.contents)) return invalidSource();
  const pairs = new Map<string, SourcePair>();
  let indentation = "";
  if (isMap(document.contents)) {
    if (document.contents.flow || document.contents.anchor || document.contents.tag) return requiresSource();
    if (document.contents.srcToken?.type === "block-map") indentation = " ".repeat(document.contents.srcToken.indent);
    for (const pair of document.contents.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string" || pairs.has(pair.key.value)) return invalidSource();
      if (pair.value !== null && !isNode(pair.value)) return invalidSource();
      pairs.set(pair.key.value, { key: pair.key, value: pair.value, srcToken: pair.srcToken });
    }
  }

  const edits: Edit[] = [];
  let appended = "";
  for (const [key, value] of additions) {
    const pair = pairs.get(key);
    if (!pair) { appended += `${indentation}${JSON.stringify(key)}: ${JSON.stringify(value)}${newline}`; continue; }
    if (!isScalar(pair.key) || pair.key.anchor || pair.key.tag || pair.srcToken?.start.some(token => token.type === "explicit-key-ind")) return requiresSource(key);
    const current = editableValue(pair.value, key);
    if (JSON.stringify(current) === JSON.stringify(value)) continue;
    const node = pair.value;
    if (!node || !node.range) return requiresSource(key);
    if (isSeq(node) && Array.isArray(value) && node.items.length === value.length) {
      for (let index = 0; index < value.length; index++) {
        const item = node.items[index];
        if (!isScalar(item)) return requiresSource(key);
        if (item.value !== value[index]) edits.push(scalarEdit(yaml, item, value[index]));
      }
    } else {
      if (hasItemComments(node)) return requiresSource(key);
      edits.push(scalarEdit(yaml, node, value));
    }
  }
  for (const key of unset) {
    const pair = pairs.get(key);
    if (!pair) continue;
    if (!isScalar(pair.key) || pair.key.anchor || pair.key.tag || pair.srcToken?.start.some(token => token.type === "explicit-key-ind") || !pair.key.range) return requiresSource(key);
    editableValue(pair.value, key);
    const node = pair.value;
    if (!node?.range || hasItemComments(node) || node.commentBefore) return requiresSource(key);
    // Keep trailing inline comments and preceding standalone comments intact.
    if (pair.srcToken?.sep?.some(token => token.type === "comment")) {
      // An empty scalar's comment is outside its zero-length value range.
      if (node.range[0] !== node.range[1]) return requiresSource(key);
    }
    const lineStart = yaml.lastIndexOf("\n", pair.key.range[0] - 1) + 1;
    const start = yaml.slice(lineStart, pair.key.range[0]).trim() ? pair.key.range[0] : lineStart;
    edits.push({ start, end: node.range[1], content: "" });
  }
  if (!edits.length && !appended) return content;
  let next = yaml;
  for (const edit of edits.sort((left, right) => right.start - left.start)) next = next.slice(0, edit.start) + edit.content + next.slice(edit.end);
  if (appended) next += (next && !next.endsWith("\n") ? newline : "") + appended;
  const updated = parseDocument(next);
  if (updated.errors.length || updated.contents && !isMap(updated.contents)) return requiresSource();
  return header[1] + next + header[3] + content.slice(header[0].length);
}
