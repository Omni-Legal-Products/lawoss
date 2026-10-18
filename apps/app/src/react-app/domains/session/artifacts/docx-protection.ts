import { Plugin } from "prosemirror-state";
import type { Node } from "prosemirror-model";
import type { Protection } from "./docx-word-package";
import { isSuggestionModeActive, suggestionModeKey } from "@eigenpal/docx-editor-core/prosemirror/plugins";

function controls(doc: Node) {
  const result = new Map<string, Node>();
  let index = 0;
  doc.descendants((node) => {
    if (node.type.name === "sdt" || node.type.name === "blockSdt") result.set(String(node.attrs.id ?? `${node.attrs.tag ?? "control"}:${index++}`), node);
  });
  return result;
}

function formSkeleton(node: Node): string {
  const editable = (node.type.name === "sdt" || node.type.name === "blockSdt") && !["contentLocked", "sdtContentLocked"].includes(node.attrs.lock) && !node.attrs.dataBinding;
  if (editable) return JSON.stringify({ type: node.type.name, id: node.attrs.id, tag: node.attrs.tag, lock: node.attrs.lock });
  const content: string[] = [];
  node.forEach((child) => content.push(formSkeleton(child)));
  return JSON.stringify({ type: node.type.name, attrs: node.attrs, text: node.text, marks: node.marks.map((mark) => mark.toJSON()), content });
}

export function permitsWordEdit(before: Node, after: Node, protection: Protection): boolean {
  const oldControls = controls(before);
  const newControls = controls(after);
  for (const [id, node] of oldControls) {
    if (!node.attrs.lock) continue;
    const replacement = newControls.get(id);
    if (!replacement && ["sdtLocked", "sdtContentLocked"].includes(node.attrs.lock)) return false;
    if (["contentLocked", "sdtContentLocked"].includes(node.attrs.lock) && (!replacement || !node.content.eq(replacement.content))) return false;
  }
  if (protection.mode === "readOnly" || protection.mode === "comments") return before.eq(after);
  if (protection.mode === "forms") return formSkeleton(before) === formSkeleton(after);
  return true;
}

export function createWordProtectionPlugin(getProtection: () => Protection, onBlocked: () => void) {
  return new Plugin({ appendTransaction(_transactions, _before, after) {
    if (getProtection().mode === "trackedChanges" && suggestionModeKey.getState(after) && !isSuggestionModeActive(after)) return after.tr.setMeta(suggestionModeKey, { active: true }).setMeta("addToHistory", false);
    return null;
  }, filterTransaction(transaction, state) {
    if (!transaction.docChanged || transaction.getMeta("wordFieldUpdate")) return true;
    if (getProtection().mode === "trackedChanges" && transaction.getMeta("suggestionModeBypass")) { onBlocked(); return false; }
    const permitted = permitsWordEdit(state.doc, transaction.doc, getProtection());
    if (!permitted) onBlocked();
    return permitted;
  } });
}
