import type { EditorState } from "prosemirror-state";

/** Word line breaks must be nodes. Literal newlines in agent-provided text
 * render an extra line without contributing height to the page layout. */
export function normalizeDocxLineBreaks(state: EditorState) {
  const positions: Array<{ from: number; to: number; marks: typeof state.doc.marks }> = [];
  state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const match of node.text.matchAll(/\r\n|\r|\n/g)) {
      positions.push({ from: pos + match.index, to: pos + match.index + match[0].length, marks: node.marks });
    }
  });
  if (!positions.length) return null;
  const transaction = state.tr;
  for (const position of positions.reverse()) {
    transaction.replaceWith(position.from, position.to, state.schema.nodes.hardBreak.create(null, null, position.marks));
  }
  return transaction;
}
