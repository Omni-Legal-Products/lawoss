import JSZip from "jszip";
import { DocxReviewer } from "@eigenpal/docx-editor-agents";
import { parseDocx } from "@eigenpal/docx-editor-core/docx";
import { toProseDoc, fromProseDoc } from "@eigenpal/docx-editor-core/prosemirror/conversion";
import { W, children, elements, parseXml, readWordMetadata, finalizeWordPackage, reviewWordPackage, wordElement, xmlText, type Xml, type XmlElement } from "./docx-word-package";

type Diff<T> = { kind: "same" | "remove" | "add"; old?: T; next?: T };
async function comparisonCopy(buffer: ArrayBuffer) {
  const accepted = await reviewWordPackage(buffer, "accept");
  const model = await parseDocx(accepted);
  const saved = await new DocxReviewer(fromProseDoc(toProseDoc(model), model), "Comparison", accepted).toBuffer();
  const zip = await JSZip.loadAsync(await finalizeWordPackage(saved, await readWordMetadata(accepted)));
  for (const [path, file] of Object.entries(zip.files)) if (/^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(path)) {
    const doc = parseXml(await file.async("string"));
    // Word's lastRenderedPageBreak is a cached pagination hint, not a revision.
    for (const marker of elements(doc, "lastRenderedPageBreak")) marker.parentNode?.removeChild(marker);
    for (const paragraph of elements(doc, "p")) if (/^TOC\d+$/.test(elements(paragraph, "pStyle")[0]?.getAttributeNS(W, "val") ?? "") && !elements(paragraph, "tab").length) {
      const title = children(paragraph).find((node) => node.localName === "hyperlink");
      if (title) { const run = wordElement(doc, "r"); run.appendChild(wordElement(doc, "tab")); paragraph.insertBefore(run, title.nextSibling); }
    }
    zip.file(path, xmlText(doc));
  }
  return zip.generateAsync({ type: "arraybuffer" });
}
/** Word-level LCS; paragraphs/rows are aligned before their individual runs. */
function diff<T>(old: T[], next: T[], key: (item: T) => string): Diff<T>[] {
  if (old.length * next.length > 2_000_000) throw new Error("This comparison is too large. Compare smaller sections first.");
  const table = Array.from({ length: old.length + 1 }, () => new Uint32Array(next.length + 1));
  for (let i = old.length - 1; i >= 0; i--) for (let j = next.length - 1; j >= 0; j--) table[i][j] = key(old[i]) === key(next[j]) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const result: Diff<T>[] = [];
  let i = 0; let j = 0;
  while (i < old.length || j < next.length) {
    if (i < old.length && j < next.length && key(old[i]) === key(next[j])) result.push({ kind: "same", old: old[i++], next: next[j++] });
    else if (i < old.length && (j === next.length || table[i + 1][j] >= table[i][j + 1])) result.push({ kind: "remove", old: old[i++] });
    else result.push({ kind: "add", next: next[j++] });
  }
  return result;
}

const visibleText = (node: XmlElement) => elements(node, "t").map((text) => text.textContent ?? "").join("");
const blockKey = (node: XmlElement) => `${node.localName}:${visibleText(node)}`;
const copy = (doc: Xml, node: XmlElement) => doc.importNode(node, true);
const prop = (node: XmlElement, name: string) => children(node).find((child) => child.localName === name);
// XML prefixes, attribute order and property order are not formatting changes.
function propertyKey(node: XmlElement): string {
  const attributes = Array.from(node.attributes).filter((attribute) => attribute.namespaceURI !== "http://www.w3.org/2000/xmlns/" && !/^rsid/.test(attribute.localName ?? ""))
    .map((attribute) => `${attribute.namespaceURI}:${attribute.localName}=${attribute.value}`).sort();
  return JSON.stringify([node.namespaceURI, node.localName, attributes, children(node).map(propertyKey).sort()]);
}
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const normalizedPath = (path: string) => path.split("/").reduce<string[]>((parts, part) => { if (part === "..") parts.pop(); else if (part && part !== ".") parts.push(part); return parts; }, []).join("/");

async function mergeResources(base: JSZip, next: JSZip) {
  const paths = new Map<string, string>();
  let index = 1;
  for (const [path, file] of Object.entries(next.files)) if (!file.dir && !/\.(xml|rels)$/.test(path)) {
    let target = path;
    if (base.file(path) && await base.file(path)!.async("base64") !== await file.async("base64")) {
      do { target = path.replace(/([^/]+)$/, `lw-comparison-${index++}-$1`); } while (base.file(target));
    }
    paths.set(path, target);
    if (!base.file(target)) base.file(target, await file.async("uint8array"));
  }
  const relations = new Map<string, Map<string, string>>();
  for (const [path, file] of Object.entries(next.files)) {
    if (!/^word\/.*\.rels$/.test(path)) continue;
    const source = path.replace("/_rels/", "/").replace(/\.rels$/, "");
    const folder = source.slice(0, source.lastIndexOf("/") + 1);
    const revised = parseXml(await file.async("string"));
    const oldFile = base.file(path);
    const original = parseXml(oldFile ? await oldFile.async("string") : xmlText(revised));
    const ids = new Map<string, string>();
    for (const rel of Array.from(revised.getElementsByTagName("Relationship"))) {
      const id = rel.getAttribute("Id")!;
      const target = rel.getAttribute("Target") ?? "";
      const absolute = normalizedPath(folder + target);
      const mapped = paths.get(absolute);
      if (mapped && mapped !== absolute) rel.setAttribute("Target", mapped.startsWith(folder) ? mapped.slice(folder.length) : "../".repeat(folder.split("/").filter(Boolean).length) + mapped);
      const existing = Array.from(original.getElementsByTagName("Relationship")).find((node) => node.getAttribute("Id") === id);
      let newId = id;
      if (existing && (existing.getAttribute("Target") !== rel.getAttribute("Target") || existing.getAttribute("Type") !== rel.getAttribute("Type"))) {
        do { newId = `rIdLWComparison${index++}`; } while (Array.from(original.getElementsByTagName("Relationship")).some((node) => node.getAttribute("Id") === newId));
      }
      ids.set(id, newId);
      if (!existing || newId !== id) {
        const node = copy(original, rel); node.setAttribute("Id", newId); original.documentElement!.appendChild(node);
      }
      if (!base.file(absolute) && next.file(absolute) && !/^word\/(styles|numbering|settings)\.xml$/.test(absolute)) base.file(absolute, await next.file(absolute)!.async("uint8array"));
    }
    base.file(path, xmlText(original)); relations.set(source, ids);
  }
  const types = parseXml(await base.file("[Content_Types].xml")!.async("string"));
  const revisedTypes = parseXml(await next.file("[Content_Types].xml")!.async("string"));
  for (const item of children(revisedTypes.documentElement!)) {
    const part = item.getAttribute("PartName");
    const mapped = part && paths.get(part.slice(1));
    if (mapped) item.setAttribute("PartName", `/${mapped}`);
    const attribute = item.localName === "Override" ? "PartName" : "Extension";
    if (!children(types.documentElement!).some((node) => node.localName === item.localName && node.getAttribute(attribute) === item.getAttribute(attribute))) types.documentElement!.appendChild(copy(types, item));
  }
  base.file("[Content_Types].xml", xmlText(types));
  return relations;
}

function remapRelationships(doc: Xml, ids: Map<string, string> | undefined) {
  if (!ids) return;
  for (const node of Array.from(doc.getElementsByTagName("*"))) for (const name of ["id", "embed", "link"]) {
    const id = node.getAttributeNS(R, name);
    if (id && ids.get(id) && ids.get(id) !== id) node.setAttributeNS(R, `r:${name}`, ids.get(id)!);
  }
}

async function mergeComments(base: JSZip, next: JSZip) {
  const file = next.file("word/comments.xml");
  const mapping = new Map<string, string>();
  if (!file) return mapping;
  const incoming = parseXml(await file.async("string"));
  const original = parseXml(await base.file("word/comments.xml")?.async("string") ?? `<w:comments xmlns:w="${W}"/>`);
  const existing = elements(original, "comment");
  let id = Math.max(0, ...[...existing, ...elements(incoming, "comment")].map((node) => Number(node.getAttributeNS(W, "id")))) + 1;
  const paragraphIds = new Set(Array.from(original.getElementsByTagName("*")).flatMap((node) => Array.from(node.attributes).filter((attr) => attr.localName === "paraId").map((attr) => attr.value)));
  const renamedParagraphs = new Map<string, string>();
  for (const comment of elements(incoming, "comment")) {
    const oldId = comment.getAttributeNS(W, "id")!;
    const old = existing.find((node) => node.getAttributeNS(W, "id") === oldId);
    if (old && visibleText(old) === visibleText(comment) && old.getAttributeNS(W, "author") === comment.getAttributeNS(W, "author")) { mapping.set(oldId, oldId); continue; }
    const newId = String(id++); mapping.set(oldId, newId);
    const copied = copy(original, comment); copied.setAttributeNS(W, "w:id", newId);
    for (const node of Array.from(copied.getElementsByTagName("*"))) for (const attribute of Array.from(node.attributes)) if (attribute.localName === "paraId") {
      if (paragraphIds.has(attribute.value)) {
        let replacement: string;
        do { replacement = (id++).toString(16).padStart(8, "0").toUpperCase(); } while (paragraphIds.has(replacement));
        renamedParagraphs.set(attribute.value, replacement); node.setAttributeNS(attribute.namespaceURI, attribute.name, replacement);
      }
      paragraphIds.add(attribute.value);
    }
    original.documentElement!.appendChild(copied);
  }
  base.file("word/comments.xml", xmlText(original));
  for (const [path, part] of Object.entries(next.files)) {
    if (!/^word\/comments[^/]+\.xml$/.test(path)) continue;
    const incomingPart = parseXml(await part.async("string"));
    const originalPart = parseXml(await base.file(path)?.async("string") ?? xmlText(incomingPart));
    for (const node of children(incomingPart.documentElement!)) {
      const copied = copy(originalPart, node);
      for (const attribute of Array.from(copied.attributes)) if (renamedParagraphs.has(attribute.value)) copied.setAttributeNS(attribute.namespaceURI, attribute.name, renamedParagraphs.get(attribute.value)!);
      if (!children(originalPart.documentElement!).some((existing) => xmlText(existing) === xmlText(copied))) originalPart.documentElement!.appendChild(copied);
    }
    base.file(path, xmlText(originalPart));
  }
  return mapping;
}

function remapComments(doc: Xml, mapping: Map<string, string>) {
  for (const kind of ["commentRangeStart", "commentRangeEnd", "commentReference"]) for (const node of elements(doc, kind)) {
    const id = node.getAttributeNS(W, "id"); if (id && mapping.get(id)) node.setAttributeNS(W, "w:id", mapping.get(id)!);
  }
}

async function mergeDefinitions(base: JSZip, next: JSZip) {
  const styles = new Map<string, string>();
  if (base.file("word/styles.xml") && next.file("word/styles.xml")) {
    const before = parseXml(await base.file("word/styles.xml")!.async("string"));
    const after = parseXml(await next.file("word/styles.xml")!.async("string"));
    const original = elements(before, "style");
    const additions: XmlElement[] = [];
    let index = 1;
    for (const style of elements(after, "style")) {
      const id = style.getAttributeNS(W, "styleId")!;
      const old = original.find((item) => item.getAttributeNS(W, "styleId") === id);
      let target = id;
      if (old && propertyKey(old) !== propertyKey(style)) do { target = `LWComparisonStyle${index++}`; } while ([...original, ...additions].some((node) => node.getAttributeNS(W, "styleId") === target));
      styles.set(id, target);
      if (!old || target !== id) {
        const node = copy(before, style); node.setAttributeNS(W, "w:styleId", target); node.removeAttributeNS(W, "default"); additions.push(node);
      }
    }
    for (const style of additions) {
      for (const name of ["basedOn", "next", "link"]) for (const reference of elements(style, name)) {
        const value = reference.getAttributeNS(W, "val");
        if (value && styles.get(value)) reference.setAttributeNS(W, "w:val", styles.get(value)!);
      }
      before.documentElement!.appendChild(style);
    }
    base.file("word/styles.xml", xmlText(before));
  }
  const numbering = new Map<string, string>();
  if (next.file("word/numbering.xml")) {
    if (!base.file("word/numbering.xml")) base.file("word/numbering.xml", await next.file("word/numbering.xml")!.async("string"));
    else {
      const before = parseXml(await base.file("word/numbering.xml")!.async("string"));
      const after = parseXml(await next.file("word/numbering.xml")!.async("string"));
      const abstracts = new Map<string, string>();
      for (const kind of ["abstractNum", "num"]) {
        const attribute = kind === "abstractNum" ? "abstractNumId" : "numId";
        const existing = elements(before, kind);
        let nextId = Math.max(0, ...[...existing, ...elements(after, kind)].map((item) => Number(item.getAttributeNS(W, attribute)))) + 1;
        for (const item of elements(after, kind)) {
          const id = item.getAttributeNS(W, attribute)!;
          if (kind === "num") {
            const reference = elements(item, "abstractNumId")[0]; const value = reference?.getAttributeNS(W, "val");
            if (value && abstracts.get(value)) reference.setAttributeNS(W, "w:val", abstracts.get(value)!);
          }
          const old = existing.find((node) => node.getAttributeNS(W, attribute) === id);
          const target = old && xmlText(old) !== xmlText(item) ? String(nextId++) : id;
          (kind === "abstractNum" ? abstracts : numbering).set(id, target);
          if (!old || target !== id) { const node = copy(before, item); node.setAttributeNS(W, `w:${attribute}`, target); before.documentElement!.appendChild(node); }
        }
      }
      base.file("word/numbering.xml", xmlText(before));
    }
  }
  return (doc: Xml) => {
    for (const name of ["pStyle", "rStyle"]) for (const node of elements(doc, name)) {
      const id = node.getAttributeNS(W, "val"); if (id && styles.get(id)) node.setAttributeNS(W, "w:val", styles.get(id)!);
    }
    for (const node of elements(doc, "numId")) {
      const id = node.getAttributeNS(W, "val"); if (id && numbering.get(id)) node.setAttributeNS(W, "w:val", numbering.get(id)!);
    }
  };
}

type RevisionContext = { doc: Xml; author: string; date: string; nextId: () => string };
function revision(context: RevisionContext, name: string) {
  return wordElement(context.doc, name, { id: context.nextId(), author: context.author, date: context.date });
}

function trackRuns(node: XmlElement, kind: "ins" | "del", context: RevisionContext) {
  const runs = elements(node, "r").filter((run) => run.parentNode?.localName !== "rPr");
  for (const run of runs) {
    if (kind === "del") for (const text of [...elements(run, "t"), ...elements(run, "instrText")]) {
      const replacement = wordElement(context.doc, text.localName === "t" ? "delText" : "delInstrText");
      replacement.setAttribute("xml:space", "preserve");
      replacement.appendChild(context.doc.createTextNode(text.textContent ?? ""));
      text.parentNode!.replaceChild(replacement, text);
    }
    const wrapper = revision(context, kind);
    run.parentNode!.replaceChild(wrapper, run);
    wrapper.appendChild(run);
  }
}

function trackedBlock(node: XmlElement, kind: "ins" | "del", context: RevisionContext): XmlElement {
  const result = copy(context.doc, node);
  if (result.localName === "tr") {
    const properties = prop(result, "trPr") ?? wordElement(context.doc, "trPr");
    if (!properties.parentNode) result.insertBefore(properties, result.firstChild);
    properties.appendChild(revision(context, kind));
  } else if (result.localName === "p") {
    const properties = prop(result, "pPr") ?? wordElement(context.doc, "pPr");
    if (!properties.parentNode) result.insertBefore(properties, result.firstChild);
    const runProperties = prop(properties, "rPr") ?? wordElement(context.doc, "rPr");
    if (!runProperties.parentNode) properties.appendChild(runProperties);
    runProperties.appendChild(revision(context, kind));
  } else if (result.localName === "tbl") {
    for (const row of children(result).filter((child) => child.localName === "tr")) {
      const properties = prop(row, "trPr") ?? wordElement(context.doc, "trPr");
      if (!properties.parentNode) row.insertBefore(properties, row.firstChild);
      properties.appendChild(revision(context, kind));
    }
  }
  trackRuns(result, kind, context);
  return result;
}

type Unit = { node: XmlElement; text: string };
function unitKey(unit: Unit) {
  if (unit.node.localName !== "sdt") return unit.text;
  const id = elements(prop(unit.node, "sdtPr") ?? unit.node, "id")[0]?.getAttributeNS(W, "val");
  return id ? `control:${id}` : unit.text;
}
function units(paragraph: XmlElement, doc: Xml): Unit[] {
  const result: Unit[] = [];
  for (const child of children(paragraph)) {
    if (child.localName === "pPr") continue;
    if (child.localName !== "r" || children(child).some((item) => !["t", "rPr"].includes(item.localName ?? ""))) {
      result.push({ node: copy(doc, child), text: xmlText(child) }); continue;
    }
    const text = elements(child, "t").map((t) => t.textContent ?? "").join("");
    for (const token of text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? []) {
      const run = wordElement(doc, "r");
      const properties = prop(child, "rPr");
      if (properties) run.appendChild(copy(doc, properties));
      const value = wordElement(doc, "t"); value.setAttribute("xml:space", "preserve"); value.appendChild(doc.createTextNode(token)); run.appendChild(value);
      result.push({ node: run, text: token });
    }
  }
  return result;
}

function trackedUnit(unit: Unit, kind: "ins" | "del", context: RevisionContext) {
  if (unit.node.localName !== "r") { const container = wordElement(context.doc, "p"); container.appendChild(unit.node); trackRuns(container, kind, context); return children(container)[0]; }
  const wrapper = revision(context, kind);
  if (kind === "del") for (const text of [...elements(unit.node, "t"), ...elements(unit.node, "instrText")]) {
    const replacement = wordElement(context.doc, text.localName === "t" ? "delText" : "delInstrText");
    replacement.setAttribute("xml:space", "preserve"); replacement.appendChild(context.doc.createTextNode(text.textContent ?? "")); text.parentNode!.replaceChild(replacement, text);
  }
  wrapper.appendChild(unit.node); return wrapper;
}

function propertyChange(original: XmlElement, revised: XmlElement, name: string, context: RevisionContext) {
  const before = prop(original, name); const after = prop(revised, name);
  if (propertyKey(before ?? wordElement(context.doc, name)) === propertyKey(after ?? wordElement(context.doc, name))) return;
  const properties = after ?? wordElement(context.doc, name);
  if (!properties.parentNode) revised.insertBefore(properties, revised.firstChild);
  const change = revision(context, `${name}Change`); change.appendChild(before ? copy(context.doc, before) : wordElement(context.doc, name)); properties.appendChild(change);
}

function compareParagraph(original: XmlElement, revised: XmlElement, context: RevisionContext) {
  const result = copy(context.doc, revised);
  for (const child of children(result)) if (child.localName !== "pPr") result.removeChild(child);
  propertyChange(original, result, "pPr", context);
  for (const step of diff(units(original, context.doc), units(revised, context.doc), unitKey)) {
    if (step.kind === "same") {
      const node = step.next!.node;
      if (node.localName === "r" && step.old!.node.localName === "r") propertyChange(step.old!.node, node, "rPr", context);
      if (node.localName === "sdt") {
        const before = prop(step.old!.node, "sdtContent"); const after = prop(node, "sdtContent");
        if (before && after) node.replaceChild(compareParagraph(before, after, context), after);
      }
      result.appendChild(node);
    } else result.appendChild(trackedUnit(step.kind === "add" ? step.next! : step.old!, step.kind === "add" ? "ins" : "del", context));
  }
  return result;
}

function compareChildren(original: XmlElement, revised: XmlElement, context: RevisionContext, contentNames: string[]): XmlElement {
  const result = copy(context.doc, revised);
  for (const child of children(result)) if (contentNames.includes(child.localName ?? "")) result.removeChild(child);
  const old = children(original).filter((child) => contentNames.includes(child.localName ?? ""));
  const next = children(revised).filter((child) => contentNames.includes(child.localName ?? ""));
  const steps = diff(old, next, blockKey);
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    let node: XmlElement;
    if (step.kind === "same") node = compareBlock(step.old!, step.next!, context);
    else {
      // Corresponding changed paragraphs/rows remain one object; only new/deleted
      // objects receive a paragraph/row marker. Reject then restores the original.
      const removed: XmlElement[] = []; const added: XmlElement[] = [];
      let end = index;
      while (end < steps.length && steps[end].kind !== "same") {
        if (steps[end].old) removed.push(steps[end].old!);
        if (steps[end].next) added.push(steps[end].next!);
        end++;
      }
      for (let offset = 0; offset < Math.max(removed.length, added.length); offset++) {
        const before = removed[offset]; const after = added[offset];
        const block = before && after && before.localName === after.localName ? compareBlock(before, after, context) : after ? trackedBlock(after, "ins", context) : trackedBlock(before, "del", context);
        if (before && after && before.localName !== after.localName) result.appendChild(trackedBlock(before, "del", context));
        result.insertBefore(block, prop(result, "sectPr") ?? null);
      }
      index = end - 1; continue;
    }
    result.insertBefore(node, prop(result, "sectPr") ?? null);
  }
  return result;
}

function compareBlock(original: XmlElement, revised: XmlElement, context: RevisionContext): XmlElement {
  if (original.localName === "p") return compareParagraph(original, revised, context);
  if (original.localName === "tbl") {
    const result = compareChildren(original, revised, context, ["tr"]); propertyChange(original, result, "tblPr", context); return result;
  }
  if (original.localName === "tr") {
    const oldCells = children(original).filter((node) => node.localName === "tc");
    const newCells = children(revised).filter((node) => node.localName === "tc");
    if (oldCells.length !== newCells.length) throw new Error("Comparing a changed table column structure is not supported yet. Keep the originals and review this change in Word.");
    const result = copy(context.doc, revised);
    children(result).filter((node) => node.localName === "tc").forEach((cell, index) => {
      const revised = compareChildren(oldCells[index], newCells[index], context, ["p", "tbl", "sdt"]);
      propertyChange(oldCells[index], revised, "tcPr", context); result.replaceChild(revised, cell);
    });
    propertyChange(original, result, "trPr", context); return result;
  }
  if (original.localName === "sdt") {
    const result = copy(context.doc, revised);
    const before = prop(original, "sdtContent"); const after = prop(result, "sdtContent");
    if (before && after) result.replaceChild(compareChildren(before, after, context, ["p", "tbl", "sdt"]), after);
    return result;
  }
  return copy(context.doc, revised);
}

export async function compareWordDocuments(original: ArrayBuffer, revised: ArrayBuffer, author: string): Promise<ArrayBuffer> {
  const clean = comparisonCopy;
  const [base, next] = await Promise.all([JSZip.loadAsync(await clean(original)), JSZip.loadAsync(await clean(revised))]);
  const relationships = await mergeResources(base, next);
  const remapDefinitions = await mergeDefinitions(base, next);
  const commentIds = await mergeComments(base, next);
  let id = 1;
  for (const file of Object.values(base.files)) if (!file.dir && /\.xml$/.test(file.name)) for (const match of (await file.async("string")).matchAll(/w:id="(\d+)"/g)) id = Math.max(id, Number(match[1]) + 1);
  for (const [path, file] of Object.entries(next.files)) {
    if (!/^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(path)) continue;
    const originalPart = base.file(path);
    if (!originalPart) { base.file(path, await file.async("uint8array")); continue; }
    const before = parseXml(await originalPart.async("string")); const after = parseXml(await file.async("string"));
    remapRelationships(after, relationships.get(path));
    remapDefinitions(after);
    remapComments(after, commentIds);
    const context: RevisionContext = { doc: before, author: author.trim() || "Comparison", date: new Date().toISOString(), nextId: () => String(id++) };
    if (path === "word/document.xml") {
      const oldBody = elements(before, "body")[0]; const newBody = elements(after, "body")[0];
      oldBody.parentNode!.replaceChild(compareChildren(oldBody, newBody, context, ["p", "tbl", "sdt"]), oldBody);
    } else if (/notes\.xml$/.test(path)) {
      const kind = path.includes("footnotes") ? "footnote" : "endnote";
      for (const note of elements(after, kind)) {
        const oldNote = elements(before, kind).find((n) => n.getAttributeNS(W, "id") === note.getAttributeNS(W, "id"));
        if (oldNote) oldNote.parentNode!.replaceChild(compareChildren(oldNote, note, context, ["p", "tbl", "sdt"]), oldNote);
        else before.documentElement!.appendChild(copy(before, note));
      }
    } else before.replaceChild(compareChildren(before.documentElement!, after.documentElement!, context, ["p", "tbl", "sdt"]), before.documentElement!);
    base.file(path, xmlText(before));
  }
  return base.generateAsync({ type: "arraybuffer" });
}

function combineParagraph(paragraph: XmlElement, versions: { paragraph: XmlElement; author: string }[], context: RevisionContext): XmlElement {
  const doc = context.doc;
  const originalUnits = units(paragraph, doc);
  const edits: { from: number; to: number; inserted: Unit[]; author: string }[] = [];
  const formats = new Map<number, { node: XmlElement; author: string }>();
  const controls = new Map<number, { node: XmlElement; author: string }[]>();
  let paragraphFormat: { node: XmlElement; author: string } | undefined;
  for (const version of versions) {
    const revised = version.paragraph;
    const before = prop(paragraph, "pPr"); const after = prop(revised, "pPr");
    if (xmlText(before ?? wordElement(doc, "pPr")) !== xmlText(after ?? wordElement(doc, "pPr"))) {
      if (paragraphFormat && xmlText(prop(paragraphFormat.node, "pPr") ?? wordElement(doc, "pPr")) !== xmlText(after ?? wordElement(doc, "pPr"))) throw new Error("These drafts propose conflicting paragraph formatting. Compare each draft separately to review that conflict.");
      paragraphFormat = { node: revised, author: version.author };
    }
    let position = 0; let edit: typeof edits[number] | undefined;
    for (const step of diff(originalUnits, units(revised, doc), unitKey)) {
      if (step.kind === "same") {
        if (step.old!.node.localName === "r" && xmlText(step.old!.node) !== xmlText(step.next!.node)) {
          const existing = formats.get(position);
          if (existing && xmlText(existing.node) !== xmlText(step.next!.node)) throw new Error("These drafts propose conflicting text formatting. Compare each draft separately to review that conflict.");
          formats.set(position, { node: step.next!.node, author: version.author });
        }
        if (step.old!.node.localName === "sdt") {
          const versions = controls.get(position) ?? [];
          versions.push({ node: step.next!.node, author: version.author }); controls.set(position, versions);
        }
        if (edit) edits.push(edit); edit = undefined; position++;
      } else {
        edit ??= { from: position, to: position, inserted: [], author: version.author };
        if (step.kind === "remove") edit.to = ++position; else edit.inserted.push(step.next!);
      }
    }
    if (edit) edits.push(edit);
  }
  for (let index = 0; index < edits.length; index++) for (const other of edits.slice(index + 1)) {
    const edit = edits[index];
    const onlyComments = (entry: typeof edit) => entry.from === entry.to && entry.inserted.every((unit) => /^commentRange(Start|End)$/.test(unit.node.localName ?? "") || elements(unit.node, "commentReference").length > 0);
    if (onlyComments(edit) && onlyComments(other)) continue;
    if (edit.author !== other.author && (Math.max(edit.from, other.from) < Math.min(edit.to, other.to) || edit.from === other.from)) {
      if (edit.from === other.from && edit.to === other.to && edit.inserted.map(unitKey).join("") === other.inserted.map(unitKey).join("")) {
        edits.splice(edits.indexOf(other), 1);
      } else throw new Error("These drafts change the same wording. Compare each draft separately to review that conflict.");
    }
  }
  const result = copy(doc, paragraphFormat?.node ?? paragraph);
  for (const child of children(result)) if (child.localName !== "pPr") result.removeChild(child);
  if (paragraphFormat) propertyChange(paragraph, result, "pPr", { ...context, author: paragraphFormat.author });
  for (let position = 0; position <= originalUnits.length; position++) {
    for (const edit of edits.filter((entry) => entry.from === position)) for (const unit of edit.inserted) result.appendChild(trackedUnit(unit, "ins", { ...context, author: edit.author }));
    const old = originalUnits[position]; if (!old) continue;
    const removed = edits.find((edit) => position >= edit.from && position < edit.to);
    const formatting = formats.get(position);
    const node = copy(doc, formatting?.node ?? old.node);
    if (formatting) propertyChange(old.node, node, "rPr", { ...context, author: formatting.author });
    const controlVersions = controls.get(position);
    const before = prop(old.node, "sdtContent"); const after = prop(node, "sdtContent");
    if (controlVersions && before && after) node.replaceChild(combineParagraph(before, controlVersions.flatMap((version) => {
      const paragraph = prop(version.node, "sdtContent"); return paragraph ? [{ paragraph, author: version.author }] : [];
    }), context), after);
    result.appendChild(removed ? trackedUnit({ ...old, node }, "del", { ...context, author: removed.author }) : node);
  }
  return result;
}

type Source = { node: XmlElement; author: string };
function combineTree(original: XmlElement, sources: Source[], context: RevisionContext, contentNames: string[]): XmlElement {
  const old = children(original).filter((node) => contentNames.includes(node.localName ?? ""));
  const versions = new Map<number, Source[]>();
  const additions = new Map<number, Source[]>();
  const deleted = new Map<number, string>();
  const addVersion = (index: number, source: Source) => { const items = versions.get(index) ?? []; items.push(source); versions.set(index, items); };
  const addNew = (index: number, source: Source) => {
    const items = additions.get(index) ?? [];
    if (!items.some((item) => xmlText(item.node) === xmlText(source.node))) items.push(source);
    additions.set(index, items);
  };
  for (const source of sources) {
    const steps = diff(old, children(source.node).filter((node) => contentNames.includes(node.localName ?? "")), blockKey);
    let position = 0;
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      if (step.kind === "same") { addVersion(position++, { node: step.next!, author: source.author }); continue; }
      const removed: XmlElement[] = []; const added: XmlElement[] = [];
      let end = index;
      while (end < steps.length && steps[end].kind !== "same") {
        if (steps[end].old) removed.push(steps[end].old!);
        if (steps[end].next) added.push(steps[end].next!);
        end++;
      }
      for (let offset = 0; offset < Math.max(removed.length, added.length); offset++) {
        const before = removed[offset]; const after = added[offset];
        if (before && after && before.localName === after.localName) addVersion(position + offset, { node: after, author: source.author });
        else {
          if (before) deleted.set(position + offset, source.author);
          if (after) addNew(position + Math.min(offset, removed.length), { node: after, author: source.author });
        }
      }
      position += removed.length; index = end - 1;
    }
  }
  let formatSource: Source | undefined;
  const property = original.localName === "tbl" ? "tblPr" : original.localName === "tr" ? "trPr" : original.localName === "tc" ? "tcPr" : undefined;
  if (property) for (const source of sources) if (xmlText(prop(original, property) ?? wordElement(context.doc, property)) !== xmlText(prop(source.node, property) ?? wordElement(context.doc, property))) {
    if (formatSource && xmlText(prop(formatSource.node, property) ?? wordElement(context.doc, property)) !== xmlText(prop(source.node, property) ?? wordElement(context.doc, property))) throw new Error("These drafts propose conflicting table formatting. Compare each draft separately to review that conflict.");
    formatSource = source;
  }
  const result = copy(context.doc, formatSource?.node ?? original);
  for (const child of children(result)) if (contentNames.includes(child.localName ?? "")) result.removeChild(child);
  if (formatSource && property) propertyChange(original, result, property, { ...context, author: formatSource.author });
  for (let index = 0; index <= old.length; index++) {
    for (const addition of additions.get(index) ?? []) result.insertBefore(trackedBlock(addition.node, "ins", { ...context, author: addition.author }), prop(result, "sectPr") ?? null);
    const node = old[index]; if (!node) continue;
    const updates = versions.get(index) ?? [];
    const removed = deleted.get(index);
    let combined: XmlElement;
    if (removed) {
      if (updates.some((source) => xmlText(source.node) !== xmlText(node))) throw new Error("One draft deletes a clause that another changes. Compare each draft separately to review that conflict.");
      combined = trackedBlock(node, "del", { ...context, author: removed });
    } else if (node.localName === "p") combined = combineParagraph(node, updates.map((source) => ({ paragraph: source.node, author: source.author })), context);
    else if (node.localName === "tbl") combined = combineTree(node, updates, context, ["tr"]);
    else if (node.localName === "tr") {
      const cells = children(node).filter((child) => child.localName === "tc");
      const groups = updates.map((source) => ({ ...source, cells: children(source.node).filter((child) => child.localName === "tc") }));
      if (groups.some((source) => source.cells.length !== cells.length)) throw new Error("Combining changed table columns requires conflict review. Compare each draft separately.");
      combined = copy(context.doc, node);
      const changed = updates.filter((source) => xmlText(prop(node, "trPr") ?? wordElement(context.doc, "trPr")) !== xmlText(prop(source.node, "trPr") ?? wordElement(context.doc, "trPr")));
      if (changed.length) {
        if (changed.some((source) => xmlText(prop(source.node, "trPr") ?? wordElement(context.doc, "trPr")) !== xmlText(prop(changed[0].node, "trPr") ?? wordElement(context.doc, "trPr")))) throw new Error("These drafts propose conflicting row formatting. Compare each draft separately.");
        const old = prop(combined, "trPr"); old?.parentNode?.removeChild(old);
        const properties = prop(changed[0].node, "trPr"); if (properties) combined.insertBefore(copy(context.doc, properties), combined.firstChild);
        propertyChange(node, combined, "trPr", { ...context, author: changed[0].author });
      }
      children(combined).filter((child) => child.localName === "tc").forEach((cell, offset) => combined.replaceChild(combineTree(cells[offset], groups.map((source) => ({ node: source.cells[offset], author: source.author })), context, ["p", "tbl", "sdt"]), cell));
    } else if (node.localName === "sdt") {
      combined = copy(context.doc, node);
      const content = prop(combined, "sdtContent"); const before = prop(node, "sdtContent");
      if (content && before) combined.replaceChild(combineTree(before, updates.flatMap((source) => { const node = prop(source.node, "sdtContent"); return node ? [{ node, author: source.author }] : []; }), context, ["p", "tbl", "sdt"]), content);
    } else combined = copy(context.doc, node);
    result.insertBefore(combined, prop(result, "sectPr") ?? null);
  }
  return result;
}

/** Combine independent proposals against their common original. Conflicting
 * wording requires separate comparisons rather than concatenating alternatives. */
export async function combineWordDocuments(original: ArrayBuffer, drafts: { buffer: ArrayBuffer; author: string }[]) {
  const clean = comparisonCopy;
  const base = await JSZip.loadAsync(await clean(original));
  const incoming = await Promise.all(drafts.map(async (draft) => ({ ...draft, zip: await JSZip.loadAsync(await clean(draft.buffer)) })));
  // Newly added notes often reuse the same numeric ID in independently returned
  // drafts. Give each a distinct ID before merging their body references.
  for (const kind of ["footnote", "endnote"]) {
    const path = `word/${kind}s.xml`;
    const originalPart = base.file(path);
    const notes = parseXml(originalPart ? await originalPart.async("string") : `<w:${kind}s xmlns:w="${W}"/>`);
    const existing = new Set(elements(notes, kind).map((note) => note.getAttributeNS(W, "id")));
    const documents = await Promise.all(incoming.map(async (draft) => { const file = draft.zip.file(path); return file ? parseXml(await file.async("string")) : null; }));
    let nextId = Math.max(0, ...documents.flatMap((doc) => doc ? elements(doc, kind).map((note) => Number(note.getAttributeNS(W, "id"))) : []), ...Array.from(existing, Number)) + 1;
    for (let index = 0; index < incoming.length; index++) {
      const document = documents[index]; if (!document) continue;
      const mapping = new Map<string, string>();
      for (const note of elements(document, kind)) {
        const id = note.getAttributeNS(W, "id")!;
        if (Number(id) <= 0 || existing.has(id)) continue;
        const replacement = String(nextId++); mapping.set(id, replacement); note.setAttributeNS(W, "w:id", replacement);
        notes.documentElement!.appendChild(copy(notes, note));
      }
      incoming[index].zip.file(path, xmlText(document));
      if (mapping.size) for (const [story, file] of Object.entries(incoming[index].zip.files)) if (/^word\/(document|header\d+|footer\d+)\.xml$/.test(story)) {
        const doc = parseXml(await file.async("string"));
        for (const reference of elements(doc, `${kind}Reference`)) { const id = reference.getAttributeNS(W, "id"); if (id && mapping.has(id)) reference.setAttributeNS(W, "w:id", mapping.get(id)!); }
        incoming[index].zip.file(story, xmlText(doc));
      }
    }
    if (documents.some(Boolean)) base.file(path, xmlText(notes));
  }
  const mappings: { relations: Awaited<ReturnType<typeof mergeResources>>; definitions: Awaited<ReturnType<typeof mergeDefinitions>>; comments: Map<string, string> }[] = [];
  for (const draft of incoming) mappings.push({ relations: await mergeResources(base, draft.zip), definitions: await mergeDefinitions(base, draft.zip), comments: await mergeComments(base, draft.zip) });
  let id = 1_000_000;
  for (const [path, file] of Object.entries(base.files)) {
    if (!/^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(path)) continue;
    const doc = parseXml(await file.async("string"));
    const versions = await Promise.all(incoming.map(async (draft, index) => {
      const file = draft.zip.file(path);
      const document = parseXml(file ? await file.async("string") : xmlText(doc));
      remapRelationships(document, mappings[index].relations.get(path)); mappings[index].definitions(document);
      remapComments(document, mappings[index].comments);
      return { author: draft.author, document };
    }));
    const context: RevisionContext = { doc, author: "Comparison", date: new Date().toISOString(), nextId: () => String(id++) };
    if (path === "word/document.xml") {
      const body = elements(doc, "body")[0];
      body.parentNode!.replaceChild(combineTree(body, versions.map((version) => ({ node: elements(version.document, "body")[0], author: version.author })), context, ["p", "tbl", "sdt"]), body);
    } else if (/notes\.xml$/.test(path)) {
      const kind = path.includes("footnotes") ? "footnote" : "endnote";
      for (const note of elements(doc, kind)) {
        const updates = versions.flatMap((version) => { const node = elements(version.document, kind).find((node) => node.getAttributeNS(W, "id") === note.getAttributeNS(W, "id")); return node ? [{ node, author: version.author }] : []; });
        note.parentNode!.replaceChild(combineTree(note, updates, context, ["p", "tbl", "sdt"]), note);
      }
    } else {
      const root = doc.documentElement!;
      doc.replaceChild(combineTree(root, versions.map((version) => ({ node: version.document.documentElement!, author: version.author })), context, ["p", "tbl", "sdt"]), root);
    }
    base.file(path, xmlText(doc));
  }
  return base.generateAsync({ type: "arraybuffer" });
}
