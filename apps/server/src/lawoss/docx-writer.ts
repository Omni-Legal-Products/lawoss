/**
 * LAWOSS: nový dokument Word bez shellu a bez ďalšej závislosti (rozhodnutie MČ 10. 11. 2026).
 *
 * Nástroj `lawoss_files`, úkon `create_file`, dostane od agenta malú štruktúru (názov, nadpisy, odseky, zoznamy,
 * zlom strany) a tento modul z nej zloží minimálny platný OOXML balík cez `fflate`: A4, okraje 2,5 cm, Arial 11 b.,
 * riadkovanie 1,15, jazyk `sk-SK` alebo `cs-CZ`, skutočné číslovanie Wordu a odrážky. V texte platí len `**tučné**`
 * a `*kurzíva*`; všetko ostatné je doslovný text.
 *
 * Výstup je deterministický (pevný čas položiek ZIP, žiadne dátumy v metadátach): server dokument zloží pri pláne
 * aj pri vykonaní a schválenie viaže na SHA-256 bajtov. Iný bajt medzi kartou a vykonaním by každé schválenie
 * skončil ako „súbory sa zmenili“.
 */
import { strToU8, zipSync, type Zippable } from "fflate";

export type DocxLanguage = "sk-SK" | "cs-CZ";
export type DocxAlign = "left" | "justify" | "right" | "center";
export type DocxBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string; align?: DocxAlign | undefined }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "page_break" };
export type DocxContent = { title?: string | undefined; blocks: DocxBlock[] };

type Run = { text: string; bold?: true; italic?: true };

/** Characters XML 1.0 cannot carry (control characters, lone surrogates) are dropped; line endings become `\n`. */
export function cleanText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[^\x09\x0A\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "");
}

/** Text between the markers must start and end with a non-space, so `5 * 3` and a lone `*` stay literal. */
const BOLD = /\*\*(\S(?:[^]*?\S)?)\*\*/g;
const ITALIC = /\*([^\s*](?:[^*]*?[^\s*])?)\*/g;

function split(text: string, pattern: RegExp, mark: (run: Run) => Run, rest: (plain: string) => Run[]): Run[] {
  const runs: Run[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) runs.push(...rest(text.slice(last, match.index)));
    runs.push(...rest(match[1] ?? "").map(mark));
    last = match.index + match[0].length;
  }
  if (last < text.length) runs.push(...rest(text.slice(last)));
  return runs;
}

/** `**bold**` and `*italic*` (italic also inside bold); unmatched asterisks stay as written. */
export function inlineRuns(text: string): Run[] {
  const italic = (plain: string) => split(plain, ITALIC, (run) => ({ ...run, italic: true }), (inner) => inner ? [{ text: inner }] : []);
  return split(cleanText(text), BOLD, (run) => ({ ...run, bold: true }), italic);
}

/** The text a reader sees, without the emphasis markers (the approval card's preview). */
export const plainText = (text: string): string => inlineRuns(text).map((run) => run.text).join("");

const escapeXml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function runXml(run: Run): string {
  const properties = run.bold || run.italic ? `<w:rPr>${run.bold ? "<w:b/><w:bCs/>" : ""}${run.italic ? "<w:i/><w:iCs/>" : ""}</w:rPr>` : "";
  // A line break or a tab inside a paragraph is its own element; spaces at run edges need xml:space.
  const body = run.text.split(/(\n|\t)/).map((piece) => piece === "\n" ? "<w:br/>" : piece === "\t" ? "<w:tab/>"
    : piece ? `<w:t xml:space="preserve">${escapeXml(piece)}</w:t>` : "").join("");
  return body ? `<w:r>${properties}${body}</w:r>` : "";
}

const JC: Record<DocxAlign, string> = { left: "left", justify: "both", right: "right", center: "center" };

function paragraph(text: string, properties: string): string {
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}${inlineRuns(text).map(runXml).join("")}</w:p>`;
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
/** Unordered lists share one definition; every ordered list gets its own, so each starts again at 1. */
const BULLET_NUM = 1;

function documentXml(content: DocxContent): { xml: string; orderedLists: number } {
  let orderedLists = 0;
  const body = content.blocks.map((block) => {
    if (block.type === "heading") return paragraph(block.text, `<w:pStyle w:val="Heading${block.level}"/>`);
    if (block.type === "page_break") return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    if (block.type === "paragraph") return paragraph(block.text, block.align ? `<w:jc w:val="${JC[block.align]}"/>` : "");
    const numId = block.ordered ? BULLET_NUM + ++orderedLists : BULLET_NUM;
    return block.items.map((item) => paragraph(item, `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`)).join("");
  }).join("");
  const title = content.title?.trim() ? paragraph(content.title.trim(), '<w:pStyle w:val="Title"/>') : "";
  // A4 with 2.5 cm margins (1417 twips).
  const section = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
  return { xml: `${HEADER}<w:document ${W}><w:body>${title}${body}${section}</w:body></w:document>`, orderedLists };
}

function numberingXml(orderedLists: number): string {
  const level = (format: string, text: string) => `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>`;
  const ordered = Array.from({ length: orderedLists }, (_, index) => index + 1);
  // Schema order: every abstractNum before the first num.
  const abstracts = [`<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${level("bullet", "•")}</w:abstractNum>`,
    ...ordered.map((id) => `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>${level("decimal", "%1.")}</w:abstractNum>`)];
  const nums = [`<w:num w:numId="${BULLET_NUM}"><w:abstractNumId w:val="0"/></w:num>`,
    ...ordered.map((id) => `<w:num w:numId="${BULLET_NUM + id}"><w:abstractNumId w:val="${id}"/></w:num>`)];
  return `${HEADER}<w:numbering ${W}>${abstracts.join("")}${nums.join("")}</w:numbering>`;
}

function stylesXml(language: DocxLanguage): string {
  const fonts = '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/>';
  const heading = (level: number, size: number, extra = "") => `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>`
    + `<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr><w:rPr><w:b/><w:bCs/>${extra}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  return `${HEADER}<w:styles ${W}>`
    // 11 pt, line spacing 1.15 (276/240), 6 pt after a paragraph.
    + `<w:docDefaults><w:rPrDefault><w:rPr>${fonts}<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="${language}" w:eastAsia="${language}" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>`
    + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
    + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
    + '<w:pPr><w:spacing w:after="240"/><w:jc w:val="center"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>'
    + heading(1, 28) + heading(2, 24) + heading(3, 22, "<w:i/><w:iCs/>")
    + '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>'
    + "</w:styles>";
}

const CONTENT_TYPES = `${HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
  + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
  + '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
  + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';

const RELATIONSHIPS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const ROOT_RELS = `${HEADER}<Relationships xmlns="${RELATIONSHIPS}"><Relationship Id="rId1" Type="${OFFICE}/officeDocument" Target="word/document.xml"/>`
  + `<Relationship Id="rId2" Type="${RELATIONSHIPS}/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
const DOCUMENT_RELS = `${HEADER}<Relationships xmlns="${RELATIONSHIPS}"><Relationship Id="rId1" Type="${OFFICE}/styles" Target="styles.xml"/>`
  + `<Relationship Id="rId2" Type="${OFFICE}/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="${OFFICE}/settings" Target="settings.xml"/></Relationships>`;
/** Current Word layout (no "compatibility mode" banner). */
const SETTINGS = `${HEADER}<w:settings ${W}><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

function coreXml(title: string | undefined, language: DocxLanguage): string {
  return `${HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">`
    + `${title ? `<dc:title>${escapeXml(cleanText(title))}</dc:title>` : ""}<dc:language>${language}</dc:language></cp:coreProperties>`;
}

/** The ZIP's fixed entry time, from local components: fflate writes DOS time with local getters, so this is the same in every time zone. */
const ENTRY_TIME = new Date(2026, 0, 1, 0, 0, 0);

/** The bytes of a new `.docx`; the same content and language always give the same bytes. */
export function buildDocx(content: DocxContent, language: DocxLanguage = "sk-SK"): Uint8Array {
  const document = documentXml(content);
  const parts: [string, string][] = [
    ["[Content_Types].xml", CONTENT_TYPES], ["_rels/.rels", ROOT_RELS], ["word/document.xml", document.xml], ["word/_rels/document.xml.rels", DOCUMENT_RELS],
    ["word/styles.xml", stylesXml(language)], ["word/numbering.xml", numberingXml(document.orderedLists)], ["word/settings.xml", SETTINGS],
    ["docProps/core.xml", coreXml(content.title?.trim() || undefined, language)],
  ];
  const files: Zippable = {};
  for (const [name, xml] of parts) files[name] = [strToU8(xml), { mtime: ENTRY_TIME, level: 6 }];
  return zipSync(files);
}
