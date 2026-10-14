import type { Node } from "prosemirror-model";
import { getVanillaTextBetween } from "@eigenpal/docx-editor-core/prosemirror/paraText";

export type WordBookmark = { id: number; name: string; from: number; to: number; scope: "paragraph" | "range"; text: string };
const cache = new WeakMap<Node, WordBookmark[]>();

export function wordBookmarkIdentities(doc: Node) {
  const result = wordBookmarks(doc).map(mark => ({ id: mark.id, name: mark.name }));
  doc.descendants(node => { if (node.type.name === "bookmarkStart" || node.type.name === "bookmarkEnd") result.push({ id: Number(node.attrs.id), name: String(node.attrs.name ?? "") }); });
  return result;
}

function rangeText(doc: Node, from: number, to: number) {
  const parts: string[] = [];
  if (from < to) doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== "paragraph") return;
    parts.push(getVanillaTextBetween(doc, Math.max(from, pos + 1), Math.min(to, pos + node.nodeSize - 1)));
    return false;
  });
  return parts.join("\n");
}

/** Native bookends follow typing, paragraph splits and undo with the content.
 * Legacy paragraph bookmarks remain supported. */
export function wordBookmarks(doc: Node): WordBookmark[] {
  const previous = cache.get(doc); if (previous) return previous;
  const result: WordBookmark[] = [];
  const starts = new Map<number, { name: string; from: number }>();
  doc.descendants((node, pos) => {
    if (node.type.name === "bookmarkStart") starts.set(Number(node.attrs.id), { name: String(node.attrs.name), from: pos + node.nodeSize });
    if (node.type.name === "bookmarkEnd") {
      const id = Number(node.attrs.id), start = starts.get(id);
      if (start) { result.push({ id, ...start, to: pos, scope: "range", text: rangeText(doc, start.from, pos) }); starts.delete(id); }
    }
    const marks: unknown = node.attrs.bookmarks;
    if (node.type.name === "paragraph" && Array.isArray(marks)) for (const mark of marks) {
      if (mark && typeof mark === "object" && "id" in mark && typeof mark.id === "number" && "name" in mark && typeof mark.name === "string") {
        const from = pos + 1, to = pos + node.nodeSize - 1;
        result.push({ id: mark.id, name: mark.name, from, to, scope: "paragraph", text: getVanillaTextBetween(doc, from, to) });
      }
    }
  });
  cache.set(doc, result);
  return result;
}
