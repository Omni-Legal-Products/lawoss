import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import JSZip from "jszip";
import { EditorState } from "prosemirror-state";
import { DocxReviewer } from "@eigenpal/docx-editor-agents";
import { parseDocx } from "@eigenpal/docx-editor-core/docx";
import { schema } from "@eigenpal/docx-editor-core/prosemirror";
import { toProseDoc, fromProseDoc } from "@eigenpal/docx-editor-core/prosemirror/conversion";
import type { Layout } from "@eigenpal/docx-editor-core/layout-engine";
import { resolveWordFields, pageLabels, wordParagraphs, withWordSections } from "../src/react-app/domains/session/artifacts/docx-fields";
import { createSuggestionModePlugin, isSuggestionModeActive, suggestionModeKey } from "@eigenpal/docx-editor-core/prosemirror/plugins";
import { createWordProtectionPlugin, permitsWordEdit } from "../src/react-app/domains/session/artifacts/docx-protection";
import { compareWordDocuments, combineWordDocuments } from "../src/react-app/domains/session/artifacts/docx-comparison";
import { W, children, elements, parseXml, xmlText, emptyWordMetadata, finalizeWordPackage, inspectWordPackage, readWordMetadata, removeWordPrivateData, reviewWordPackage } from "../src/react-app/domains/session/artifacts/docx-word-package";
import { createCleanDocx } from "../src/react-app/domains/session/artifacts/docx-export";

const fixture = async () => new Uint8Array(await readFile(new URL("../scripts/fixtures/legal-word-workflows.docx", import.meta.url))).buffer;
const xml = (zip: JSZip, path: string) => zip.file(path)!.async("string");
const metadata = emptyWordMetadata();

test("numbering follows section restart, Roman front matter and continuation", () => {
  const layout: Layout = { pages: Array.from({ length: 5 }, (_, index) => ({ number: index + 1, sectionIndex: index < 2 ? 0 : index < 4 ? 1 : 2, fragments: [], size: { w: 800, h: 1000 }, margins: { top: 40, bottom: 40, left: 40, right: 40 } })), totalHeight: 5000 };
  assert.deepEqual([...pageLabels(layout, [{ format: "lowerRoman", start: 1 }, { format: "decimal", start: 1 }, { format: "decimal" }]).values()], ["i", "ii", "1", "2", "3"]);
});

test("live numbered references use the actual multilevel marker and report broken targets", async () => {
  const doc = toProseDoc(await parseDocx(await fixture()));
  const values = resolveWordFields(doc, null, metadata);
  let found = false;
  doc.descendants((node, pos) => {
    if (node.type.name === "field" && node.attrs.fieldType === "REF" && /REF Rueckbau\b/.test(node.attrs.instruction)) { assert.equal(values.get(pos), "8"); found = true; }
  });
  assert.ok(found);
  const broken = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.nodes.field.create({ fieldType: "REF", instruction: "REF Missing \\n", displayText: "99" })));
  assert.equal(resolveWordFields(broken, null, metadata).get(1), "Error! Reference source not found.");
  assert.equal(wordParagraphs(doc).find((paragraph) => paragraph.marker === "3.2.3")?.node.attrs.styleId, "Subclause");
});

test("inserting a new main clause renumbers references while retaining their targets", async () => {
  const doc = toProseDoc(await parseDocx(await fixture()));
  const target = wordParagraphs(doc).find((paragraph) => paragraph.bookmark === "Rueckbau")!;
  const state = EditorState.create({ doc });
  const inserted = schema.nodes.paragraph.create({ ...target.node.attrs, bookmarks: null, _originalRunBoundaries: null }, schema.text("Betriebsberichte"));
  const after = state.tr.insert(target.pos, inserted).doc;
  assert.equal(wordParagraphs(after).find((paragraph) => paragraph.bookmark === "Rueckbau")?.marker, "9");
  const resolved = resolveWordFields(after, null, metadata);
  after.descendants((node, pos) => { if (node.attrs.fieldType === "REF" && /REF Rueckbau\b/.test(node.attrs.instruction)) assert.equal(resolved.get(pos), "9"); });
});

test("same-sized sections still restart page numbering when the painter omits section indices", () => {
  const front = schema.nodes.paragraph.create({ sectionBreakType: "nextPage" }, schema.text("Front matter"));
  const doc = schema.nodes.doc.create(null, [front, schema.nodes.paragraph.create(null, schema.text("Contract"))]);
  const layout: Layout = { totalHeight: 2000, pages: [0, front.nodeSize].map((position, index) => ({ number: index + 1, size: { w: 800, h: 1000 }, margins: { top: 40, bottom: 40, left: 40, right: 40 }, fragments: [{ kind: "paragraph", blockId: String(index), pmStart: position, pmEnd: position + 3, x: 40, y: 40, width: 720, height: 20, fromLine: 0, toLine: 1 }] })) };
  assert.deepEqual([...pageLabels(withWordSections(doc, layout), [{ format: "lowerRoman", start: 1 }, { format: "decimal", start: 1 }]).values()], ["i", "1"]);
});

test("sequential captions honor reset/current switches and cached field results", () => {
  const fields = ["SEQ Exhibit", "SEQ Exhibit", "SEQ Exhibit \\r 7", "SEQ Exhibit \\c"].map((instruction) => schema.nodes.field.create({ fieldType: "SEQ", instruction }));
  const doc = schema.nodes.doc.create(null, fields.map((field) => schema.nodes.paragraph.create(null, field)));
  assert.deepEqual([...resolveWordFields(doc, null, metadata).values()], ["1", "2", "7", "7"]);
});

test("section numbering and Word document protection survive a save/reopen", async () => {
  const original = await fixture(); const meta = await readWordMetadata(original);
  meta.protection = { mode: "forms", password: false };
  const reviewer = await DocxReviewer.fromBuffer(original);
  const result = await finalizeWordPackage(await reviewer.toBuffer(), meta);
  const reopened = await readWordMetadata(result);
  assert.deepEqual(reopened.pages, meta.pages);
  assert.deepEqual(reopened.protection, meta.protection);
  const packageXml = await xml(await JSZip.loadAsync(result), "word/document.xml");
  assert.match(packageXml, /TOC \\o/);
  assert.equal((packageXml.match(/footnoteReference/g) ?? []).length, 2);
  const bookmarks = elements(parseXml(packageXml), "bookmarkStart");
  assert.equal(bookmarks.filter((node) => !/^_LW_Toc/.test(node.getAttributeNS(W, "name") ?? "")).length, 18);
});

test("historical section properties do not alter live section numbering", async () => {
  const zip = await JSZip.loadAsync(await comparisonFixture("Clause"));
  zip.file("word/document.xml", `<w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:pPrChange w:id="1"><w:pPr><w:sectPr><w:pgNumType w:fmt="decimal" w:start="99"/></w:sectPr></w:pPr></w:pPrChange><w:sectPr><w:pgNumType w:fmt="lowerRoman" w:start="1"/></w:sectPr></w:pPr></w:p><w:sectPr><w:pgNumType w:fmt="decimal" w:start="1"/></w:sectPr></w:body></w:document>`);
  const buffer = await zip.generateAsync({ type: "arraybuffer" });
  assert.deepEqual((await readWordMetadata(buffer)).pages, [{ format: "lowerRoman", start: 1 }, { format: "decimal", start: 1 }]);
  const rejected = await reviewWordPackage(buffer, "reject");
  assert.equal((await readWordMetadata(rejected)).pages.length, 2);
  assert.equal(elements(parseXml(await xml(await JSZip.loadAsync(rejected), "word/document.xml")), "pPrChange").length, 0);
});

test("forms protection permits filling a control, blocks boilerplate, deletion and formatting", () => {
  const paragraph = schema.nodes.paragraph;
  const control = schema.nodes.sdt.create({ id: 1, tag: "Client" }, schema.text("Client name"));
  const doc = schema.nodes.doc.create(null, [paragraph.create(null, schema.text("Fixed clause")), paragraph.create(null, control)]);
  const protection = { mode: "forms", password: false } satisfies typeof metadata.protection;
  const plugin = createWordProtectionPlugin(() => protection, () => {});
  const state = EditorState.create({ doc, plugins: [plugin] });
  assert.equal(state.applyTransaction(state.tr.insertText("X", 2)).transactions.length, 0);
  const controlPos = doc.child(0).nodeSize + 2;
  assert.equal(state.applyTransaction(state.tr.insertText("New ", controlPos)).transactions.length, 1);
  assert.equal(state.applyTransaction(state.tr.delete(doc.child(0).nodeSize + 1, doc.child(0).nodeSize + control.nodeSize + 1)).transactions.length, 0);
  assert.equal(state.applyTransaction(state.tr.addMark(1, 3, schema.marks.bold.create())).transactions.length, 0);
});

test("native content-control locks are enforced without global forms protection", () => {
  const control = schema.nodes.sdt.create({ id: 1, lock: "sdtContentLocked" }, schema.text("Fixed"));
  const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, control));
  const state = EditorState.create({ doc });
  assert.equal(permitsWordEdit(doc, state.tr.insertText("X", 3).doc, metadata.protection), false);
});

test("requiring tracked edits cannot be bypassed by switching the native editing mode", () => {
  const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, schema.text("Clause")));
  const protection = { mode: "trackedChanges", password: false } satisfies typeof metadata.protection;
  const state = EditorState.create({ doc, plugins: [createSuggestionModePlugin(true, "Counsel"), createWordProtectionPlugin(() => protection, () => {})] });
  const after = state.applyTransaction(state.tr.setMeta(suggestionModeKey, { active: false })).state;
  assert.ok(isSuggestionModeActive(after));
  assert.equal(state.applyTransaction(state.tr.insertText("Untracked", 1).setMeta("suggestionModeBypass", true)).transactions.length, 0);
});

async function comparisonFixture(text: string, header = "Original header") {
  const zip = await JSZip.loadAsync(await fixture());
  zip.file("word/document.xml", `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:p><w:r><w:t>Unchanged signature clause.</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`);
  zip.file("word/header1.xml", `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>${header}</w:t></w:r></w:p></w:hdr>`);
  return zip.generateAsync({ type: "arraybuffer" });
}

test("legal blackline accepts to the revised wording and rejects to the original", async () => {
  const original = await comparisonFixture("Payment is due within 30 days.");
  const revised = await comparisonFixture("Payment is due within 60 days.", "New header");
  const redline = await compareWordDocuments(original, revised, "Other Counsel");
  const accepted = await DocxReviewer.fromBuffer(redline); accepted.acceptAll();
  assert.match(accepted.getContentAsText(), /within 60 days/);
  assert.doesNotMatch(accepted.getContentAsText(), /within 30 days/);
  const rejected = await DocxReviewer.fromBuffer(redline); rejected.rejectAll();
  assert.match(rejected.getContentAsText(), /within 30 days/);
  assert.doesNotMatch(rejected.getContentAsText(), /within 60 days/);
  const zip = await JSZip.loadAsync(redline);
  assert.match(await xml(zip, "word/header1.xml"), /w:del/);
  assert.match(await xml(zip, "word/header1.xml"), /Other Counsel/);
  assert.match(accepted.getContentAsText(), /Unchanged signature clause/);
});

test("combining independent proposals in the same clause preserves both authors", async () => {
  const original = await comparisonFixture("Payment of 100 EUR is due within 30 days.");
  const redline = await combineWordDocuments(original, [
    { buffer: await comparisonFixture("Payment of 200 EUR is due within 30 days."), author: "Counsel A" },
    { buffer: await comparisonFixture("Payment of 100 EUR is due within 60 days."), author: "Counsel B" },
  ]);
  const accepted = await DocxReviewer.fromBuffer(redline); accepted.acceptAll();
  assert.match(accepted.getContentAsText(), /200 EUR is due within 60 days/);
  const rejected = await DocxReviewer.fromBuffer(redline); rejected.rejectAll();
  assert.match(rejected.getContentAsText(), /100 EUR is due within 30 days/);
  const body = await xml(await JSZip.loadAsync(redline), "word/document.xml");
  assert.match(body, /Counsel A/); assert.match(body, /Counsel B/);
  assert.doesNotMatch(body, /Alternative:/);
});

test("redlines inside real inline template controls survive import, live conversion and review", async () => {
  const original = await fixture();
  const zip = await JSZip.loadAsync(original);
  zip.file("word/document.xml", (await xml(zip, "word/document.xml")).replaceAll("48.000", "60.000"));
  const redline = await compareWordDocuments(original, await zip.generateAsync({ type: "arraybuffer" }), "Other Counsel");
  const model = await parseDocx(redline);
  const pm = toProseDoc(model);
  let oldRent = false; let newRent = false;
  pm.descendants((node) => {
    if (node.marks.some((mark) => mark.type.name === "deletion") && node.textContent === "48") oldRent = true;
    if (node.marks.some((mark) => mark.type.name === "insertion") && node.textContent === "60") newRent = true;
  });
  assert.ok(oldRent, "the old rent must survive as a tracked deletion");
  assert.ok(newRent, "the revised rent must survive as a tracked insertion");
  let tracked = false;
  pm.descendants((node) => { if (node.marks.some((mark) => mark.type.name === "insertion") && node.textContent.includes("60")) tracked = true; });
  assert.ok(tracked, "the new rent must be visible as a native tracked insertion");
  const saved = await new DocxReviewer(fromProseDoc(pm, model), "Counsel", redline).toBuffer();
  const accepted = await DocxReviewer.fromBuffer(saved); accepted.acceptAll();
  const acceptedModel = toProseDoc(await parseDocx(await accepted.toBuffer()));
  assert.ok(acceptedModel.textContent.includes("60.000"), "accepting must retain the revised rent"); assert.ok(!acceptedModel.textContent.includes("48.000"), "accepting must remove the old rent");
  const rejected = await DocxReviewer.fromBuffer(saved); rejected.rejectAll();
  const rejectedModel = toProseDoc(await parseDocx(await rejected.toBuffer()));
  assert.ok(rejectedModel.textContent.includes("48.000"), "rejecting must restore the original rent"); assert.ok(!rejectedModel.textContent.includes("60.000"), "rejecting must remove the revised rent");
  assert.ok((await DocxReviewer.fromBuffer(original)).getContentAsText().includes("48.000"), "agent reads must also include the template values");
  const countControls = (document: typeof pm) => { let count = 0; document.descendants((node) => { if (node.type.name === "sdt") count++; }); return count; };
  assert.equal(countControls(pm), countControls(toProseDoc(await parseDocx(original))), "comparison must preserve the original controls' identities");
});

test("comparison against an editor-saved baseline avoids duplicate unchanged contract wording", async () => {
  const original = await fixture(); const model = await parseDocx(original);
  const baseline = await new DocxReviewer(fromProseDoc(toProseDoc(model), model), "Counsel", original).toBuffer();
  const changed = await JSZip.loadAsync(original);
  changed.file("word/document.xml", (await xml(changed, "word/document.xml")).replaceAll("48.000", "60.000"));
  const revised = await changed.generateAsync({ type: "arraybuffer" });
  const redline = await compareWordDocuments(baseline, revised, "Other Counsel");
  const comparison = await parseDocx(redline);
  const saved = await new DocxReviewer(fromProseDoc(toProseDoc(comparison), comparison), "Counsel", redline).toBuffer();
  const accepted = toProseDoc(await parseDocx(await reviewWordPackage(saved, "accept")));
  const expected = toProseDoc(await parseDocx(await reviewWordPackage(revised, "accept")));
  assert.equal(accepted.textContent, expected.textContent);
});

test("saving unchanged Word content does not create a false redline", async () => {
  const original = await fixture(); const model = await parseDocx(original);
  const saved = await finalizeWordPackage(await new DocxReviewer(fromProseDoc(toProseDoc(model), model), "Counsel", original).toBuffer(), await readWordMetadata(original));
  const redline = await compareWordDocuments(saved, original, "Other Counsel");
  const doc = parseXml(await xml(await JSZip.loadAsync(redline), "word/document.xml"));
  assert.ok(!(await inspectWordPackage(redline)).some((finding) => finding.kind === "revisions"), elements(doc, "pPrChange").map((node) => xmlText(node.parentNode!)).join("\n"));
  assert.deepEqual((await readWordMetadata(redline)).pages, (await readWordMetadata(saved)).pages);
});

test("combining clauses added at different positions preserves structural review", async () => {
  const original = await comparisonFixture("Original clause");
  const a = await JSZip.loadAsync(original); const b = await JSZip.loadAsync(original);
  const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  a.file("word/document.xml", (await xml(a, "word/document.xml")).replace("<w:body>", `<w:body>${paragraph("First addition")}`));
  b.file("word/document.xml", (await xml(b, "word/document.xml")).replace("<w:sectPr/>", `${paragraph("Last addition")}<w:sectPr/>`));
  const redline = await combineWordDocuments(original, [{ buffer: await a.generateAsync({ type: "arraybuffer" }), author: "A" }, { buffer: await b.generateAsync({ type: "arraybuffer" }), author: "B" }]);
  const accepted = await DocxReviewer.fromBuffer(await reviewWordPackage(redline, "accept"));
  const rejected = await DocxReviewer.fromBuffer(await reviewWordPackage(redline, "reject"));
  assert.match(accepted.getContentAsText(), /First addition[\s\S]*Original clause[\s\S]*Last addition/);
  assert.equal(rejected.getContentAsText(), (await DocxReviewer.fromBuffer(original)).getContentAsText());
});

test("combining conflicting wording reports the conflict instead of merging amounts", async () => {
  await assert.rejects(combineWordDocuments(await comparisonFixture("Payment of 100 EUR."), [
    { buffer: await comparisonFixture("Payment of 200 EUR."), author: "A" },
    { buffer: await comparisonFixture("Payment of 300 EUR."), author: "B" },
  ]), /same wording/);
});

test("comments from returned drafts retain distinct identities and valid anchors", async () => {
  const original = await comparisonFixture("Original clause");
  const a = await JSZip.loadAsync(original); const b = await JSZip.loadAsync(original);
  for (const [zip, author] of [[a, "Counsel A"], [b, "Counsel B"]] satisfies [JSZip, string][]) {
    zip.file("word/comments.xml", `<w:comments xmlns:w="${W}"><w:comment w:id="12" w:author="${author}"><w:p><w:r><w:t>${author} question</w:t></w:r></w:p></w:comment></w:comments>`);
    zip.file("word/document.xml", (await xml(zip, "word/document.xml")).replace("<w:r><w:t>Original", '<w:commentRangeStart w:id="12"/><w:commentRangeEnd w:id="12"/><w:r><w:commentReference w:id="12"/></w:r><w:r><w:t>Original'));
  }
  const result = await JSZip.loadAsync(await combineWordDocuments(original, [{ buffer: await a.generateAsync({ type: "arraybuffer" }), author: "A" }, { buffer: await b.generateAsync({ type: "arraybuffer" }), author: "B" }]));
  const comments = elements(parseXml(await xml(result, "word/comments.xml")), "comment");
  const ids = comments.map((node) => node.getAttributeNS(W, "id"));
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(comments.some((node) => node.textContent?.includes("Counsel A question")));
  assert.ok(comments.some((node) => node.textContent?.includes("Counsel B question")));
  for (const reference of elements(parseXml(await xml(result, "word/document.xml")), "commentReference")) assert.ok(ids.includes(reference.getAttributeNS(W, "id")));
});

test("inspection detects inherited hidden text while honoring explicit visible formatting", async () => {
  const zip = await JSZip.loadAsync(await comparisonFixture("Public text"));
  zip.file("word/styles.xml", `<w:styles xmlns:w="${W}"><w:style w:type="character" w:styleId="Hidden"><w:rPr><w:vanish/></w:rPr></w:style></w:styles>`);
  zip.file("word/header1.xml", `<w:hdr xmlns:w="${W}"><w:p><w:r><w:rPr><w:rStyle w:val="Hidden"/></w:rPr><w:t>Private</w:t></w:r><w:r><w:rPr><w:rStyle w:val="Hidden"/><w:vanish w:val="0"/></w:rPr><w:t>Public</w:t></w:r></w:p></w:hdr>`);
  const result = await removeWordPrivateData(await zip.generateAsync({ type: "arraybuffer" }), ["hiddenText"]);
  assert.match(await xml(await JSZip.loadAsync(result), "word/header1.xml"), /Public/);
  assert.doesNotMatch(await xml(await JSZip.loadAsync(result), "word/header1.xml"), /Private/);
});

test("property revisions survive the live editor and accept/reject restores Word formatting", async () => {
  const original = await comparisonFixture("Payment clause");
  const zip = await JSZip.loadAsync(original);
  zip.file("word/document.xml", (await xml(zip, "word/document.xml")).replace("<w:r><w:t>Payment", "<w:r><w:rPr><w:b/></w:rPr><w:t>Payment"));
  const redline = await compareWordDocuments(original, await zip.generateAsync({ type: "arraybuffer" }), "Counsel");
  const model = await parseDocx(redline);
  const saved = await new DocxReviewer(fromProseDoc(toProseDoc(model), model), "Counsel", redline).toBuffer();
  assert.ok((await xml(await JSZip.loadAsync(saved), "word/document.xml")).includes("rPrChange"), "format revisions must survive an editor save");
  const accepted = parseXml(await xml(await JSZip.loadAsync(await reviewWordPackage(saved, "accept")), "word/document.xml"));
  const rejected = parseXml(await xml(await JSZip.loadAsync(await reviewWordPackage(saved, "reject")), "word/document.xml"));
  assert.ok(elements(accepted, "b").length > 0);
  assert.equal(elements(rejected, "b").length, 0);
  assert.equal(elements(accepted, "rPrChange").length, 0);
  assert.equal(elements(rejected, "rPrChange").length, 0);
});

test("comparison preserves inserted paragraphs and table rows with reversible review", async () => {
  const original = await comparisonFixture("Original clause");
  const base = await JSZip.loadAsync(original);
  const row = (text: string) => `<w:tr><w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr>`;
  base.file("word/document.xml", (await xml(base, "word/document.xml")).replace("<w:sectPr/>", `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>${row("A")}${row("B")}</w:tbl><w:sectPr/>`));
  const revised = await JSZip.loadAsync(await base.generateAsync({ type: "arraybuffer" }));
  revised.file("word/document.xml", (await xml(revised, "word/document.xml")).replace("<w:p><w:r><w:t>Unchanged", "<w:p><w:r><w:t>Additional obligation.</w:t></w:r></w:p><w:p><w:r><w:t>Unchanged").replace(row("B"), row("C") + row("B")));
  const redline = await compareWordDocuments(await base.generateAsync({ type: "arraybuffer" }), await revised.generateAsync({ type: "arraybuffer" }), "Counsel");
  const accepted = parseXml(await xml(await JSZip.loadAsync(await reviewWordPackage(redline, "accept")), "word/document.xml"));
  const rejected = parseXml(await xml(await JSZip.loadAsync(await reviewWordPackage(redline, "reject")), "word/document.xml"));
  assert.equal(elements(accepted, "tr").length, 3);
  assert.equal(elements(rejected, "tr").length, 2);
  assert.ok(elements(accepted, "t").some((node) => node.textContent?.includes("Additional")));
  assert.ok(!elements(rejected, "t").some((node) => node.textContent?.includes("Additional")));
  assert.equal(children(elements(rejected, "body")[0]).filter((node) => node.localName === "p" && elements(node, "t").some((text) => text.textContent)).length, 2);
});

test("inspection removes selected private data from all stories without changing the source", async () => {
  const original = await fixture(); const zip = await JSZip.loadAsync(original);
  zip.file("word/header1.xml", `<w:hdr xmlns:w="${W}"><w:p><w:r><w:rPr><w:vanish/></w:rPr><w:t>Private negotiation note</w:t></w:r><w:r><w:t>Public header</w:t></w:r></w:p></w:hdr>`);
  zip.file("customXml/item1.xml", "<client><name>Private client</name></client>");
  const source = await zip.generateAsync({ type: "arraybuffer" });
  const findings = await inspectWordPackage(source);
  assert.ok(findings.some((finding) => finding.kind === "properties"));
  assert.ok(findings.some((finding) => finding.kind === "hiddenText"));
  assert.ok(findings.some((finding) => finding.kind === "customXml"));
  const clean = await removeWordPrivateData(source, ["properties", "hiddenText", "customXml"]);
  assert.ok((await inspectWordPackage(clean)).every((finding) => !["properties", "hiddenText", "customXml"].includes(finding.kind)));
  const result = await JSZip.loadAsync(clean);
  assert.match(await xml(result, "word/header1.xml"), /Public header/);
  assert.doesNotMatch(await xml(result, "word/header1.xml"), /Private negotiation/);
  assert.match(await xml(await JSZip.loadAsync(source), "word/header1.xml"), /Private negotiation/);
});

test("clean outgoing copy accepts header changes and removes selected review markup", async () => {
  const redline = await compareWordDocuments(await comparisonFixture("Original clause", "Old header"), await comparisonFixture("Revised clause", "New header"), "Counsel");
  const result = await createCleanDocx(redline);
  const zip = await JSZip.loadAsync(result);
  const header = await xml(zip, "word/header1.xml");
  assert.match(header, /New/); assert.doesNotMatch(header, /Old|w:ins\b|w:del\b/);
  assert.ok((await inspectWordPackage(result)).every((finding) => finding.kind !== "comments" && finding.kind !== "revisions"));
});

test("clean outgoing copies preserve Roman page numbering, protection, bookmarks and fields", async () => {
  const original = await fixture();
  const result = await createCleanDocx(original);
  assert.deepEqual(await readWordMetadata(result), await readWordMetadata(original));
  const before = parseXml(await xml(await JSZip.loadAsync(original), "word/document.xml"));
  const after = parseXml(await xml(await JSZip.loadAsync(result), "word/document.xml"));
  for (const name of ["instrText", "footnoteReference", "sdt"]) assert.equal(elements(after, name).length, elements(before, name).length);
  for (const bookmark of elements(before, "bookmarkStart")) assert.ok(elements(after, "bookmarkStart").some((node) => node.getAttributeNS(W, "name") === bookmark.getAttributeNS(W, "name")));
});

test("Word TOC refresh can remove its own bookmarks without breaking contract references", async () => {
  const original = await fixture();
  const result = await finalizeWordPackage(original, await readWordMetadata(original));
  const zip = await JSZip.loadAsync(result); const doc = parseXml(await xml(zip, "word/document.xml"));
  const toc = elements(doc, "p").filter((node) => elements(node, "pStyle")[0]?.getAttributeNS(W, "val") === "TOC1");
  const targets = new Set(toc.flatMap((paragraph) => elements(paragraph, "hyperlink").map((node) => node.getAttributeNS(W, "anchor"))));
  assert.equal(targets.size, 13);
  assert.ok([...targets].every((name) => name?.startsWith("_LW_Toc")));
  const removedIds = new Set<string | null>();
  for (const node of elements(doc, "bookmarkStart")) if (targets.has(node.getAttributeNS(W, "name"))) { removedIds.add(node.getAttributeNS(W, "id")); node.parentNode!.removeChild(node); }
  for (const node of elements(doc, "bookmarkEnd")) if (removedIds.has(node.getAttributeNS(W, "id"))) node.parentNode!.removeChild(node);
  const retained = new Set(elements(doc, "bookmarkStart").map((node) => node.getAttributeNS(W, "name")));
  for (const instruction of elements(doc, "instrText")) { const target = instruction.textContent?.match(/^\s*REF\s+([^\s\\]+)/)?.[1]; if (target) assert.ok(retained.has(target), target); }
  const numbering = parseXml(await xml(zip, "word/numbering.xml"));
  assert.deepEqual(children(numbering.documentElement!).map((node) => node.localName), ["abstractNum", "abstractNum", "num", "num"]);
});

if (process.env.DOCX_WORD_QA_OUTPUT) {
  const output = process.env.DOCX_WORD_QA_OUTPUT;
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/Original.docx`, new Uint8Array(await comparisonFixture("Payment of 100 EUR is due within 30 days.")));
  await writeFile(`${output}/Counsel A.docx`, new Uint8Array(await comparisonFixture("Payment of 200 EUR is due within 30 days.")));
  await writeFile(`${output}/Counsel B.docx`, new Uint8Array(await comparisonFixture("Payment of 100 EUR is due within 60 days.")));
  const complex = await JSZip.loadAsync(await fixture());
  complex.file("word/document.xml", (await xml(complex, "word/document.xml")).replaceAll("48.000", "60.000"));
  await writeFile(`${output}/Counsel complex.docx`, new Uint8Array(await complex.generateAsync({ type: "arraybuffer" })));
}
