import { expect, test } from "bun:test";
import { EditorState } from "prosemirror-state";
import { schema } from "@eigenpal/docx-editor-core/prosemirror/schema";
import { acceptTemplateRevisions, templateRevisionIds } from "../src/react-app/domains/session/artifacts/docx-template-revisions";

test("clean template replacement preserves adjacent pre-existing revisions and formatting", () => {
  const old = schema.marks.insertion.create({ revisionId: 7, author: "Partner" });
  const removed = schema.marks.deletion.create({ revisionId: 8, author: "LegalWork AI" });
  const inserted = schema.marks.insertion.create({ revisionId: 9, author: "LegalWork AI" });
  const bold = schema.marks.bold.create();
  let state = EditorState.create({ doc: schema.node("doc", null, [schema.node("paragraph", null, [
    schema.text("Pending partner edit ", [old]), schema.text("[DATE]", [removed]), schema.text("11 October 2026", [inserted, bold]),
  ])]) });
  const view = { get state() { return state; }, dispatch: (transaction: Parameters<EditorState["apply"]>[0]) => { state = state.apply(transaction); } };
  expect(acceptTemplateRevisions(view, new Set([7]))).toBe(2);
  expect([...templateRevisionIds(state)]).toEqual([7]);
  expect(state.doc.textContent).toBe("Pending partner edit 11 October 2026");
  expect(state.doc.firstChild?.lastChild?.marks.map(mark => mark.type.name)).toEqual(["bold"]);
});
