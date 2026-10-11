import { expect, test } from "bun:test";
import { EditorState } from "prosemirror-state";
import { schema } from "@eigenpal/docx-editor-core/prosemirror/schema";
import { normalizeDocxLineBreaks } from "../src/react-app/domains/session/artifacts/docx-line-breaks";

test("multiline agent text becomes measured breaks without losing adjacent text or styling", () => {
  const mark = schema.marks.bold.create();
  const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("Before "), schema.text("one\ntwo\r\nthree", [mark]), schema.text(" after")])]);
  const state = EditorState.create({ doc });
  const transaction = normalizeDocxLineBreaks(state)!;
  const paragraph = transaction.doc.firstChild!;
  expect(paragraph.textContent).toBe("Before onetwothree after");
  const breaks: number[] = [];
  paragraph.forEach((node, offset) => { if (node.type.name === "hardBreak") { breaks.push(offset); expect(node.marks[0].type.name).toBe("bold"); } });
  expect(breaks).toHaveLength(2);
  expect(normalizeDocxLineBreaks(state.apply(transaction))).toBeNull();
  expect(state.doc.textContent).toContain("one\ntwo");
});
