import type { EditorState, Transaction } from "prosemirror-state";
import { acceptChangeById } from "@eigenpal/docx-editor-core/prosemirror/commands";

/** Read raw marks, not the review sidebar's coalesced entries. Adjacent old
 * and new revisions can share a card but must never share an accept decision. */
export function templateRevisionIds(state: EditorState) {
  const ids = new Set<number>();
  state.doc.descendants(node => {
    for (const mark of node.marks) {
      if (!["insertion", "deletion"].includes(mark.type.name)) continue;
      const id = mark.attrs.revisionId;
      if (id !== null && id !== undefined && Number.isInteger(Number(id))) ids.add(Number(id));
    }
  });
  return ids;
}

export function acceptTemplateRevisions(view: { state: EditorState; dispatch: (transaction: Transaction) => void }, existing: Set<number>) {
  const added = [...templateRevisionIds(view.state)].filter(id => !existing.has(id));
  let accepted = 0;
  for (const id of added) if (acceptChangeById(id)(view.state, view.dispatch)) accepted++;
  return accepted;
}
