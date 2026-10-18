import { Fragment, type Node } from "prosemirror-model";
import { type EditorView } from "prosemirror-view";
import { toFlowBlocks } from "@eigenpal/docx-editor-core/layout-bridge";
import type { FlowBlock, Layout, Page } from "@eigenpal/docx-editor-core/layout-engine";
import type { DocxEditorRef } from "@eigenpal/docx-editor-react";
import type { PageNumberRule, WordMetadata } from "./docx-word-package";
import { wordBookmarkIdentities, wordBookmarks } from "./docx-bookmarks";

export function formatPageNumber(number: number, format: string): string {
  if (/^(upper|lower)Roman$/.test(format) && number > 0) {
    let remaining = number;
    let result = "";
    for (const [value, symbol] of [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"]] satisfies [number, string][]) {
      while (remaining >= value) { result += symbol; remaining -= value; }
    }
    result += "I".repeat(remaining);
    return format === "lowerRoman" ? result.toLowerCase() : result;
  }
  if (/^(upper|lower)Letter$/.test(format) && number > 0) {
    let result = "";
    for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
    return format === "lowerLetter" ? result.toLowerCase() : result;
  }
  return format === "decimalZero" ? String(number).padStart(2, "0") : String(number);
}

export function pageLabels(layout: Layout | null, rules: PageNumberRule[]) {
  const labels = new Map<number, string>();
  let section = -1;
  let number = 0;
  for (const page of layout?.pages ?? []) {
    const index = page.sectionIndex ?? 0;
    if (index !== section && rules[index]?.start !== undefined) number = rules[index].start! - 1;
    section = index;
    labels.set(page.number, formatPageNumber(++number, rules[index]?.format ?? "decimal"));
  }
  return labels;
}

/** The pinned painter omits section indices on same-size pages. Recover them
 * from live section boundaries rather than assuming every page is section zero. */
export function withWordSections(doc: Node, layout: Layout | null): Layout | null {
  if (!layout) return null;
  const boundaries: number[] = [];
  doc.descendants((node, pos) => { if (node.attrs.sectionBreakType && node.attrs.sectionBreakType !== "continuous") boundaries.push(pos + node.nodeSize); });
  return { ...layout, pages: layout.pages.map((page) => {
    const positions = page.fragments.flatMap((fragment) => fragment.pmStart !== undefined ? [fragment.pmStart] : []);
    const start = positions.length ? Math.min(...positions) : 0;
    return { ...page, sectionIndex: page.sectionIndex ?? boundaries.filter((position) => position <= start).length };
  }) };
}

type Paragraph = { node: Node; pos: number; marker: string; level?: number; bookmark?: string };
const paragraphCache = new WeakMap<Node, Paragraph[]>();
export function wordParagraphs(doc: Node): Paragraph[] {
  const cached = paragraphCache.get(doc);
  if (cached) return cached;
  const markers = new Map<number, string>();
  const walk = (blocks: FlowBlock[]) => {
    for (const block of blocks) {
      if (block.kind === "paragraph" && block.pmStart !== undefined) markers.set(block.pmStart, block.attrs?.listMarker ?? "");
      if (block.kind === "table") for (const row of block.rows) for (const cell of row.cells) walk(cell.blocks);
      if (block.kind === "textBox") walk(block.content);
    }
  };
  walk(toFlowBlocks(doc));
  const result: Paragraph[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "paragraph") return;
    const style = String(node.attrs.styleId ?? "");
    const outline = node.attrs.outlineLevel;
    const level = typeof outline === "number" ? outline + 1 : /^Heading[1-9]$/.test(style) ? Number(style.slice(7)) : undefined;
    const bookmarks: unknown = node.attrs.bookmarks;
    let bookmark = Array.isArray(bookmarks) ? bookmarks.find((mark) => mark && typeof mark.name === "string")?.name : undefined;
    node.descendants(child => { if (!bookmark && child.type.name === "bookmarkStart") bookmark = String(child.attrs.name); });
    result.push({ node, pos, marker: markers.get(pos) ?? "", level, bookmark });
  });
  paragraphCache.set(doc, result);
  return result;
}

export function pageAtPosition(layout: Layout | null, pos: number): Page | undefined {
  return layout?.pages.find((page) => page.fragments.some((fragment) => pos >= (fragment.pmStart ?? -1) && pos < (fragment.pmEnd ?? -1)));
}

export function fieldTarget(instruction: string): string | undefined {
  return instruction.match(/^\s*(?:REF|PAGEREF|NOTEREF)\s+(?:"([^"]+)"|([^\s\\]+))/i)?.slice(1).find(Boolean);
}

export function headerFooterId(editor: DocxEditorRef, page: Page, layout: Layout, story: "header" | "footer") {
  const first = !layout.pages.some((candidate) => candidate.number < page.number && candidate.sectionIndex === page.sectionIndex);
  const sections = editor.getDocument()?.package?.document.sections;
  const section = sections?.[page.sectionIndex ?? 0]?.properties;
  const type = first && section?.titlePg ? "first" : page.number % 2 === 0 && section?.evenAndOddHeaders ? "even" : "default";
  for (let index = page.sectionIndex ?? 0; index >= 0; index--) {
    const properties = sections?.[index]?.properties;
    const refs = story === "header" ? properties?.headerReferences : properties?.footerReferences;
    const rid = refs?.find((ref) => ref.type === type)?.rId ?? refs?.find((ref) => ref.type === "default")?.rId;
    if (rid) return rid;
  }
  return story === "header" ? page.headerFooterRefs?.headerDefault : page.headerFooterRefs?.footerDefault;
}

export function resolveWordFields(doc: Node, layout: Layout | null, metadata: WordMetadata, contextPage?: Page, bodyDoc = doc): Map<number, string> {
  layout = withWordSections(bodyDoc, layout);
  const values = new Map<number, string>();
  const paragraphs = wordParagraphs(bodyDoc);
  const bookmarks = new Map(wordBookmarks(bodyDoc).map(mark => [mark.name, { ...mark, paragraph: paragraphs.find(item => mark.from >= item.pos && mark.from < item.pos + item.node.nodeSize) }]));
  const labels = pageLabels(layout, metadata.pages);
  const sequences = new Map<string, number>();
  doc.descendants((node, pos) => {
    if (node.type.name !== "field" || node.attrs.fldLock) return;
    const instruction = String(node.attrs.instruction ?? "").trim();
    const type = String(node.attrs.fieldType ?? instruction.split(/\s/)[0]).toUpperCase();
    const target = bookmarks.get(fieldTarget(instruction) ?? "");
    const page = contextPage ?? pageAtPosition(layout, pos);
    let text: string | undefined;
    if (type === "PAGE" && page) text = labels.get(page.number);
    if (type === "NUMPAGES" && layout) text = String(layout.pages.length);
    if (type === "SECTIONPAGES" && page && layout) text = String(layout.pages.filter((p) => p.sectionIndex === page.sectionIndex).length);
    if (type === "SECTION" && page) text = String((page.sectionIndex ?? 0) + 1);
    if (type === "PAGEREF") {
      const targetPage = target && pageAtPosition(layout, target.from);
      if (targetPage) text = labels.get(targetPage.number);
      else if (!target) text = "Error! Reference source not found.";
    }
    if (type === "REF") text = target ? /\\[nrw]\b/.test(instruction) ? target.paragraph?.marker || target.text : target.text : "Error! Reference source not found.";
    if (type === "STYLEREF") {
      const style = instruction.match(/^STYLEREF\s+(?:"([^"]+)"|([^\s\\]+))/i)?.slice(1).find(Boolean);
      const firstPos = page?.fragments.find((fragment) => fragment.pmStart !== undefined)?.pmStart ?? pos;
      const candidates = paragraphs.filter((paragraph) => paragraph.node.attrs.styleId === style || paragraph.level !== undefined && String(paragraph.level) === style);
      const match = candidates.filter((paragraph) => paragraph.pos <= firstPos).at(-1) ?? candidates[0];
      if (match) text = /\\[nrw]\b/.test(instruction) ? match.marker : match.node.textContent;
    }
    if (type === "SEQ") {
      const identifier = instruction.match(/^SEQ\s+(?:"([^"]+)"|([^\s\\]+))/i)?.slice(1).find(Boolean);
      if (identifier) {
        const reset = instruction.match(/\\r\s+(\d+)/i);
        const number = reset ? Number(reset[1]) : (sequences.get(identifier) ?? 0) + (/\\c\b/.test(instruction) ? 0 : 1);
        sequences.set(identifier, number);
        const format = instruction.match(/\\\*\s+(ROMAN|roman|ALPHABETIC|alphabetic)/)?.[1];
        text = formatPageNumber(number, format === "ROMAN" ? "upperRoman" : format === "roman" ? "lowerRoman" : format === "ALPHABETIC" ? "upperLetter" : format === "alphabetic" ? "lowerLetter" : "decimal");
      }
    }
    if (text !== undefined) values.set(pos, text);
  });
  return values;
}

export function updateFieldValues(view: EditorView, layout: Layout | null, metadata: WordMetadata, page?: Page, bodyDoc?: Node): number {
  let tr = view.state.tr;
  let count = 0;
  for (const [pos, displayText] of resolveWordFields(view.state.doc, layout, metadata, page, bodyDoc)) {
    const node = tr.doc.nodeAt(pos);
    if (node && node.attrs.displayText !== displayText) { tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, displayText, dirty: false }); count++; }
  }
  if (count) view.dispatch(tr.setMeta("wordFieldUpdate", true).setMeta("suggestionModeBypass", true).setMeta("addToHistory", true));
  return count;
}

export function updateContents(view: EditorView, layout: Layout | null, metadata: WordMetadata): boolean {
  layout = withWordSections(view.state.doc, layout);
  const paragraphs = wordParagraphs(view.state.doc);
  const entries = paragraphs.filter((paragraph) => /^TOC\d+$/i.test(String(paragraph.node.attrs.styleId ?? "")));
  if (!entries.length) return false;
  const schema = view.state.schema;
  let tr = view.state.tr;
  const allBookmarks = wordBookmarks(view.state.doc);
  let nextBookmark = Math.max(0, ...wordBookmarkIdentities(view.state.doc).map(bookmark => bookmark.id)) + 1;
  const headings = paragraphs.filter((paragraph) => paragraph.level !== undefined && paragraph.level >= metadata.tocLevels[0] && paragraph.level <= metadata.tocLevels[1]);
  const labels = pageLabels(layout, metadata.pages);
  const generated = headings.map((paragraph) => {
    const bookmarks: { id: number; name: string }[] = paragraph.node.attrs.bookmarks ?? [];
    const existing = allBookmarks.find(mark => mark.from >= paragraph.pos && mark.from < paragraph.pos + paragraph.node.nodeSize && /^_(?:Toc|LW_Toc)/i.test(mark.name));
    const bookmark = existing?.name ?? `_LW_Toc${nextBookmark}`;
    if (!existing) tr = tr.setNodeMarkup(paragraph.pos, undefined, { ...paragraph.node.attrs, bookmarks: [...bookmarks, { id: nextBookmark++, name: bookmark }] });
    const hyperlink = schema.marks.hyperlink.create({ href: `#${bookmark}` });
    const title = [paragraph.marker, paragraph.node.textContent].filter(Boolean).join("  ");
    const page = pageAtPosition(layout, paragraph.pos);
    // PAGEREF \h already creates a native Word link. Wrapping the field in a
    // hyperlink makes the pinned serializer discard its instruction.
    const field = schema.nodes.field.create({ fieldType: "PAGEREF", instruction: `PAGEREF ${bookmark} \\h`, displayText: page ? labels.get(page.number) ?? "" : "", fieldKind: "complex" });
    const template = entries.find((entry) => String(entry.node.attrs.styleId) === `TOC${paragraph.level}`)?.node ?? entries[0].node;
    return schema.nodes.paragraph.create({ ...template.attrs, paraId: null, bookmarks: null, styleId: `TOC${paragraph.level}`, _originalRunBoundaries: null }, [schema.text(title, [hyperlink]), schema.nodes.tab.create(), field]);
  });
  const from = entries[0].pos;
  const to = entries.at(-1)!.pos + entries.at(-1)!.node.nodeSize;
  view.dispatch(tr.replaceWith(from, to, Fragment.fromArray(generated)).setMeta("wordFieldUpdate", true).setMeta("suggestionModeBypass", true));
  return true;
}

export async function updateWordFields(editor: DocxEditorRef, metadata: WordMetadata, flush: <T>(update: () => T) => T = update => update()) {
  const paged = editor.getEditorRef(); const view = paged?.getView();
  if (!view || !paged) throw new Error("The document editor is still loading.");
  flush(() => updateContents(view, paged.getLayout(), metadata));
  let count = 0;
  for (let pass = 0; pass < 3; pass++) {
    paged.relayout();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    count += flush(() => updateFieldValues(view, paged.getLayout(), metadata));
  }
  for (const [rid, story] of paged.getHfPmViews()) {
    const layout = withWordSections(view.state.doc, paged.getLayout());
    const page = layout?.pages.find((page) => headerFooterId(editor, page, layout, "header") === rid || headerFooterId(editor, page, layout, "footer") === rid);
    count += flush(() => updateFieldValues(story, layout, metadata, page, view.state.doc));
  }
  return count;
}

/** Resolve per-page fields after native pagination, including reused HF stories. */
export function decorateWordFields(root: HTMLElement, editor: DocxEditorRef, metadata: WordMetadata) {
  const paged = editor.getEditorRef();
  const body = paged?.getView()?.state.doc;
  const layout = body ? withWordSections(body, paged?.getLayout() ?? null) : null;
  if (!body || !layout) return false;
  const labels = pageLabels(layout, metadata.pages);
  const bodyFields = resolveWordFields(body, layout, metadata);
  const notes = new Map<string, number>();
  body.descendants((node, pos) => {
    const note = node.marks.find((mark) => mark.type.name === "footnoteRef" && mark.attrs.noteType !== "endnote");
    if (note) notes.set(String(note.attrs.id), pos);
  });
  for (const page of layout.pages) {
    const pageElement = root.querySelector<HTMLElement>(`.layout-page[data-page-number="${page.number}"]`);
    if (!pageElement) continue;
    pageElement.dataset.wordPageNumber = labels.get(page.number) ?? String(page.number);
    const paint = (container: HTMLElement, doc: Node, values: Map<number, string>) => {
      doc.descendants((node, pos) => {
        if (node.type.name !== "field") return;
        for (const span of container.querySelectorAll<HTMLElement>(`.layout-run[data-pm-start="${pos}"]`)) {
          const text = values.get(pos);
          // Wrapped results are measured and sliced from the native field cache.
          // Replacing a fragment with the full result would undo wrapping.
          if (span.dataset.wordFieldResult !== "true" && text !== undefined && span.textContent !== text) span.textContent = text;
          const target = fieldTarget(String(node.attrs.instruction ?? ""));
          if (target) { span.dataset.wordBookmark = target; span.tabIndex = 0; span.setAttribute("role", "link"); span.setAttribute("aria-label", `${span.textContent}, ${target}`); }
        }
      });
    };
    const content = pageElement.querySelector<HTMLElement>(".layout-page-content");
    if (content) paint(content, body, bodyFields);
    for (const [id, pos] of notes) {
      const marker = content?.querySelector<HTMLElement>(`.layout-run[data-pm-start="${pos}"]`);
      if (marker && !marker.closest(".layout-footnote-area")) {
        marker.dataset.wordNoteId = id; marker.tabIndex = 0; marker.setAttribute("role", "link");
      }
    }
    const renderedNotes = Array.from(pageElement.querySelectorAll<HTMLElement>(".layout-footnote-content"));
    page.footnoteIds?.forEach((id, index) => {
      const note = renderedNotes[index];
      const pos = notes.get(String(id));
      if (note && pos !== undefined) {
        note.dataset.wordNoteId = String(id); note.tabIndex = -1;
        const number = note.querySelector<HTMLElement>(".layout-run-text");
        if (number) { number.dataset.wordNoteReferencePos = String(pos); number.tabIndex = 0; number.setAttribute("role", "link"); }
      }
    });
    for (const story of ["header", "footer"] satisfies ("header" | "footer")[]) {
      const container = pageElement.querySelector<HTMLElement>(`.layout-page-${story}`);
      if (!container) continue;
      const rid = headerFooterId(editor, page, layout, story);
      const view = rid && paged?.getHfPmViews().get(rid);
      if (view) paint(container, view.state.doc, resolveWordFields(view.state.doc, layout, metadata, page, body));
    }
  }
  return true;
}

export function navigateWordNote(target: Element, root: HTMLElement, editor: DocxEditorRef): boolean {
  const back = target.closest<HTMLElement>("[data-word-note-reference-pos]")?.dataset.wordNoteReferencePos;
  if (back !== undefined) { editor.highlightRange(Number(back), Number(back) + 1); return true; }
  const id = target.closest<HTMLElement>(".layout-run[data-word-note-id]")?.dataset.wordNoteId;
  if (!id) return false;
  const note = Array.from(root.querySelectorAll<HTMLElement>(".layout-footnote-content[data-word-note-id]")).find((node) => node.dataset.wordNoteId === id);
  if (!note) return false;
  note.scrollIntoView({ block: "center" }); note.focus({ preventScroll: true }); return true;
}
