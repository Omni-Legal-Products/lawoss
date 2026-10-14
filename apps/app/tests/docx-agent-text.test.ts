import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { DocxReviewer } from "@eigenpal/docx-editor-agents";
import { schema } from "@eigenpal/docx-editor-core/prosemirror/schema";
import { findTextInPmParagraph, getVanillaNodeText, getVanillaTextBetween } from "@eigenpal/docx-editor-core/prosemirror/paraText";

test("agent document reads preserve Word breaks and tabs, and distinguish replacement sides sharing an ID", async () => {
  const zip = await JSZip.loadAsync(await readFile(new URL("../scripts/fixtures/legal-review.docx", import.meta.url)));
  const document = await zip.file("word/document.xml")!.async("string");
  zip.file("word/document.xml", document.replace(/(<w:body[^>]*>)[\s\S]*?(<w:sectPr[\s\S]*)/, '$1<w:p><w:r><w:t>First</w:t><w:br/><w:t>Second</w:t><w:tab/><w:t>Third</w:t></w:r></w:p><w:p><w:del w:id="99" w:author="Counsel"><w:r><w:delText>Old wording</w:delText></w:r></w:del><w:ins w:id="99" w:author="Counsel"><w:r><w:t>New wording</w:t></w:r></w:ins></w:p>$2'));
  const reviewer = await DocxReviewer.fromBuffer(await zip.generateAsync({ type: "arraybuffer" }));
  expect(reviewer.getContentAsText()).toContain("First\nSecond\tThird");
  const changes = reviewer.getChanges();
  expect(changes.map(change => ({ type: change.type, text: change.text }))).toEqual([
    { type: "deletion", text: "Old wording" }, { type: "insertion", text: "New wording" },
  ]);
  reviewer.rejectAll();
  const reopened = await DocxReviewer.fromBuffer(await reviewer.toBuffer());
  expect(reopened.getContentAsText()).toContain("Old wording");
  expect(reopened.getContentAsText()).not.toContain("New wording");
});

test("multiline editor search targets the actual range and preserves adjacent text", () => {
  const paragraph = schema.node("paragraph", null, [schema.text("Before one"), schema.node("hardBreak"), schema.text("two"), schema.node("tab"), schema.text("three after")]);
  const doc = schema.node("doc", null, [paragraph]);
  expect(getVanillaNodeText(paragraph)).toBe("Before one\ntwo\tthree after");
  const range = findTextInPmParagraph(doc, 0, paragraph.nodeSize, "one\ntwo\tthree");
  expect(range).not.toBeNull();
  expect(getVanillaTextBetween(doc, range!.from, range!.to)).toBe("one\ntwo\tthree");
  expect(doc.textBetween(1, range!.from)).toBe("Before ");
  expect(doc.textBetween(range!.to, paragraph.nodeSize - 1)).toBe(" after");
});

test("field results are readable without turning field display characters into editable positions", () => {
  const field = schema.node("field", { fieldType: "REF", instruction: "REF Clause2 \\h", displayText: "§ 2 Schlussbestimmungen" });
  const paragraph = schema.node("paragraph", { paraId: "P1" }, [schema.text("Before "), field, schema.text(" after"), schema.text(" proposed", [schema.marks.insertion.create({ revisionId: "1" })])]);
  const doc = schema.node("doc", null, [paragraph]);
  expect(getVanillaNodeText(paragraph)).toBe("Before § 2 Schlussbestimmungen after");
  expect(getVanillaTextBetween(doc, 1, paragraph.nodeSize - 1)).toBe("Before § 2 Schlussbestimmungen after");
  expect(findTextInPmParagraph(doc, 0, paragraph.nodeSize, "Schlussbestimmungen")).toBeNull();
  expect(findTextInPmParagraph(doc, 0, paragraph.nodeSize, "Before  after")).toBeNull();
  const range = findTextInPmParagraph(doc, 0, paragraph.nodeSize, "after")!;
  expect(doc.textBetween(range.from, range.to)).toBe("after");
});

test("ordinary text replacement cannot remove a native bookmark boundary", () => {
  const paragraph = schema.node("paragraph", null, [schema.text("before "), schema.node("bookmarkStart", { id: 1, name: "Clause" }), schema.text("inside"), schema.node("bookmarkEnd", { id: 1 }), schema.text(" after")]);
  const doc = schema.node("doc", null, [paragraph]);
  expect(getVanillaNodeText(paragraph)).toBe("before inside after");
  expect(findTextInPmParagraph(doc, 0, paragraph.nodeSize, "before inside")).toBeNull();
  expect(findTextInPmParagraph(doc, 0, paragraph.nodeSize, "inside after")).toBeNull();
  const range = findTextInPmParagraph(doc, 0, paragraph.nodeSize, "inside")!;
  expect(doc.textBetween(range.from, range.to)).toBe("inside");
});
