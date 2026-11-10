/**
 * LAWOSS: obsah nového súboru pre `lawoss_files`, úkon `create_file` (rozhodnutie MČ 10. 11. 2026).
 *
 * Pri prehliadke alfy advokát požiadal o „krátku predžalobnú výzvu ako Word dokument“ a dostal karty
 * „Spustiť príkaz v počítači?“ s `mkdir -p`, `printf > súbor.md` a `node -e require.resolve('docx')`. Vytvorenie
 * dokumentu je základný úkon advokáta, preto ho robí server: z textu (`md`, `txt`) alebo z malej štruktúry (`docx`)
 * zloží bajty, ich veľkosť a SHA-256 a krátky čitateľný náhľad na kartu. Hranicu klienta, zákaz prepísania a zápis
 * rieši `file-operations.ts` rovnako ako pri ostatných úkonoch.
 *
 * Obsah sa nikdy nezapisuje do logu ani auditu: von ide len cesta, veľkosť a SHA-256. Náhľad je text od agenta na
 * schvaľovacej karte, preto je jeden riadok bez značiek; riadiace znaky v ňom escapuje `file-operations.ts`.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { buildDocx, cleanText, plainText, type DocxBlock, type DocxContent, type DocxLanguage } from "./docx-writer.js";

export const CREATE_FILE_FORMATS = ["docx", "md", "txt"] as const;
export type CreateFileFormat = (typeof CREATE_FILE_FORMATS)[number];
/** One new file: 1 MiB of text (UTF-8), or of the text inside a Word document. */
export const MAX_CREATE_FILE_BYTES = 1024 * 1024;
/** All new files of one request together; the routes read at most `FILE_ROUTE_BODY_BYTES`. */
export const MAX_CREATE_PLAN_BYTES = 2 * MAX_CREATE_FILE_BYTES;
export const FILE_ROUTE_BODY_BYTES = 3 * 1024 * 1024;
export const MAX_DOCX_BLOCKS = 1000;
export const MAX_DOCX_LIST_ITEMS = 200;
export const MAX_DOCX_BLOCK_CHARS = 20_000;
export const MAX_DOCX_TITLE_CHARS = 300;
/** Characters of text the approval card shows. */
export const PREVIEW_CHARS = 300;

/** The route's shape of the operation; `content` is checked against `format` in `prepareNewFile` with its own errors. */
export const createFileOperationSchema = z.strictObject({
  operation: z.literal("create_file"),
  path: z.string().min(1).max(4096),
  format: z.enum(CREATE_FILE_FORMATS),
  content: z.unknown(),
  language: z.enum(["sk-SK", "cs-CZ"]).optional(),
});
export type CreateFileOperation = z.infer<typeof createFileOperationSchema>;

const docxSchema = z.strictObject({
  title: z.string().optional(),
  blocks: z.array(z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("heading"), level: z.union([z.literal(1), z.literal(2), z.literal(3)]), text: z.string() }),
    z.strictObject({ type: z.literal("paragraph"), text: z.string(), align: z.enum(["left", "justify", "right", "center"]).optional() }),
    z.strictObject({ type: z.literal("list"), ordered: z.boolean(), items: z.array(z.string()).min(1) }),
    z.strictObject({ type: z.literal("page_break") }),
  ])).min(1),
});

const DOCX_SHAPE = 'For docx, content is { title?, blocks: [{ type: "heading", level: 1-3, text } | { type: "paragraph", text, align?: "left"|"justify"|"right"|"center" } | { type: "list", ordered, items: [text] } | { type: "page_break" }] }; inside text only **bold** and *italic* are formatting.';
const tooLarge = (what: string) => new ApiError(413, "file_operation_content_too_large", `${what} Nothing was changed. Shorten the content or split it into several files.`);

export type NewFile = { bytes: Uint8Array; size: number; sha256: string; preview: string; title?: string };

/** One line of at most `PREVIEW_CHARS` characters, cut with an ellipsis. The caller escapes control characters (`visibleName`). */
function oneLine(text: string, limit = PREVIEW_CHARS): string {
  const line = Array.from(text.replace(/\s+/gu, " ").trim());
  return line.length > limit ? `${line.slice(0, limit).join("").trimEnd()}…` : line.join("");
}

/** The lower-case extension of the last path segment, or "" when it has none. */
function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function checkFormat(operation: CreateFileOperation): void {
  const extension = extensionOf(operation.path);
  if (!CREATE_FILE_FORMATS.some((format) => format === extension))
    throw new ApiError(400, "file_operation_unsupported_format", `create_file makes only .docx, .md and .txt files, and this path ends with ${/^[a-z0-9]{1,10}$/.test(extension) ? `.${extension}` : "another or no extension"}. Nothing was changed.`);
  if (extension !== operation.format)
    throw new ApiError(400, "file_operation_format_mismatch", `The format ${operation.format} does not match the file extension .${extension}. Nothing was changed. Use the same format and extension.`);
}

function docxText(block: DocxBlock): string[] {
  return block.type === "list" ? block.items : block.type === "page_break" ? [] : [block.text];
}

function checkedDocx(raw: unknown): DocxContent {
  const parsed = docxSchema.safeParse(raw);
  if (!parsed.success) {
    // Zod names the place and the expected type, never the supplied text.
    const where = parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "content"}: ${issue.message}`).join("; ");
    throw new ApiError(400, "file_operation_content", `The content of a Word document is not in the expected shape (${where}). Nothing was changed. ${DOCX_SHAPE}`);
  }
  const content = parsed.data;
  if (content.blocks.length > MAX_DOCX_BLOCKS) throw tooLarge(`A Word document can have at most ${MAX_DOCX_BLOCKS} blocks.`);
  if ((content.title?.length ?? 0) > MAX_DOCX_TITLE_CHARS) throw tooLarge(`The title can have at most ${MAX_DOCX_TITLE_CHARS} characters.`);
  let total = 0;
  for (const block of content.blocks) {
    if (block.type === "list" && block.items.length > MAX_DOCX_LIST_ITEMS) throw tooLarge(`A list can have at most ${MAX_DOCX_LIST_ITEMS} items.`);
    for (const text of docxText(block)) {
      if (text.length > MAX_DOCX_BLOCK_CHARS) throw tooLarge(`One heading, paragraph or list item can have at most ${MAX_DOCX_BLOCK_CHARS} characters.`);
      total += Buffer.byteLength(text, "utf8");
    }
  }
  if (total > MAX_CREATE_FILE_BYTES) throw tooLarge("The text of the document is larger than 1 MiB.");
  return content;
}

/** Text for `.md` and `.txt`: UTF-8 without a byte-order mark, `\n` line endings. */
function textBytes(raw: unknown, format: CreateFileFormat): { bytes: Uint8Array; text: string } {
  if (typeof raw !== "string")
    throw new ApiError(400, "file_operation_content", `For ${format}, content is the text of the file as a string. Nothing was changed.`);
  // A lone surrogate cannot be written as UTF-8: the encoder writes U+FFFD, and the preview shows the text as written.
  const bytes = Buffer.from(raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n"), "utf8");
  if (bytes.byteLength > MAX_CREATE_FILE_BYTES) throw tooLarge("The text of the file is larger than 1 MiB.");
  return { bytes, text: bytes.toString("utf8") };
}

/** The bytes to write and what the card shows about them. Throws a typed `ApiError` for every refusal. */
export function prepareNewFile(operation: CreateFileOperation): NewFile {
  checkFormat(operation);
  const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  if (operation.format !== "docx") {
    const { bytes, text } = textBytes(operation.content, operation.format);
    return { bytes, size: bytes.byteLength, sha256: digest(bytes), preview: oneLine(text) };
  }
  const content = checkedDocx(operation.content);
  const language: DocxLanguage = operation.language ?? "sk-SK";
  const bytes = buildDocx(content, language);
  const title = oneLine(plainText(content.title ?? ""), MAX_DOCX_TITLE_CHARS);
  const preview = oneLine(content.blocks.flatMap(docxText).map((text) => plainText(cleanText(text))).join(" "));
  return { bytes, size: bytes.byteLength, sha256: digest(bytes), preview, ...(title ? { title } : {}) };
}
