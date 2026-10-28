/**
 * LAWOSS: karta „Upraviť súbory?“ pred zápisom cez editor dokumentov (N-A7-8, 28. 10. 2026).
 *
 * Nástroje `inapp_*` (upstream `legalwork-extensions-preview.ts`) menia súbor cez živý editor v appke, ktorý ho
 * uloží cez `POST /workspace/…/files/content`. Engine ich bránou `edit` nevedie, lebo sú to pluginové nástroje.
 * Pred každým zapisujúcim volaním sa preto plugin spýta enginu (`context.ask`) s povolením `edit`: karta je tá
 * istá ako pri natívnej úprave („Upraviť súbory?“, rozsah = cesta od koreňa klienta, napr. `Spisy/M005-…/…`),
 * pravidlá advokáta, firmy aj YOLO (`edit: allow`) platia bez zmeny. Zamietnutie = výnimka enginu, do editora
 * nič neodíde. `always: []`: jedna karta na jedno zapisujúce volanie (natívna karta úprav „povoliť pre klienta“
 * aj tak neponúka). Čítanie sa nepýta.
 *
 * Upstream súbor volá tieto funkcie jedným riadkom v `callInAppOfficeTool`, `callInAppDocxTool`,
 * `inapp_documents_open` (`copy_to`) a `inapp_markdown_create` (`complete`). Tieto volania nesú hlavičku
 * `EDITOR_WRITE_HEADERS`; most UI v desktope akciu editora, ktorá zapisuje, bez nej odmietne, takže ju
 * nespustí ani `legalwork_ui_execute_action`, ani MCP `legalwork-ui` (`lawoss-editor-write-gate.mjs`).
 */
import { inAppDocumentSurface, taskDocumentSnapshot } from "../inapp-document-bridge.js";
import type { OpenCodeContext } from "./office-plugin-shared.js";

export { EDITOR_WRITE_HEADERS } from "../lawoss/editor-write-header.js";

/** The engine's approval request in a tool context (`context.ask`). */
export type EditorApprovalAsk = NonNullable<OpenCodeContext["ask"]>;

/** Native edit permission: same card, same rules (lawyer, firm, YOLO) as the engine's own file edits. */
export const EDITOR_WRITE_PERMISSION = "edit";

/** Editor operations that only read; every other operation of a format saves the file and asks first. */
const READ_ONLY: Record<"docx" | "xlsx" | "pptx" | "md", readonly string[]> = {
  docx: ["read_document", "read_selection", "find_text", "read_changes", "read_comments", "inspect_document"],
  xlsx: ["read"],
  pptx: ["read", "read_presentation", "preview"],
  md: ["read"],
};

/** Word operations whose result is a new file named `fileName`, not a change of the open document. */
const DOCX_COPIES = ["create_comparison_copy", "create_clean_copy"];

const MAX_SHOWN = 2000;

const text = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
const clip = (value: string) => value.length > MAX_SHOWN ? `${value.slice(0, MAX_SHOWN)}…` : value;
const lines = (sign: string, value: string) => clip(value).split("\n").map((line) => `${sign} ${line}`).join("\n");

/** The proposed change in the card's "Navrhnuté zmeny", when the call states it as old → new text. */
function proposedChange(args: Record<string, unknown>): string | undefined {
  const before = text(args.search) ?? text(args.placeholder), after = text(args.replacement) ?? text(args.replaceWith) ?? text(args.value);
  if (after !== undefined) return [before ? lines("-", before) : null, lines("+", after)].filter(Boolean).join("\n");
  const sheet = text(args.sheet), range = text(args.range);
  return sheet && range ? `${sheet}!${range}` : undefined;
}

async function ask(context: OpenCodeContext, path: string, change?: string): Promise<void> {
  if (!context.ask) throw new Error("Changing this file needs the user's approval, but approval requests are unavailable. Nothing was changed.");
  await context.ask({ permission: EDITOR_WRITE_PERMISSION, patterns: [path], always: [], metadata: { filepath: path, ...(change ? { diff: change } : {}) } });
}

/** The task's prepared Word document (the given one, else the selected one); none for another format. */
async function wordDocument(context: OpenCodeContext, given: string | undefined): Promise<string | undefined> {
  if (!context.sessionID) return undefined;
  const surface = inAppDocumentSurface(await taskDocumentSnapshot(context.sessionID), context.sessionID, given);
  return surface?.format === "docx" ? surface.path : undefined;
}

/**
 * Asks before an editor operation that saves a file; returns the document path the editor must address.
 * A Word call is checked against the task's prepared Word document (without `path`, the selected one): its path
 * is shown on the card and sent with the call, so the approved file and the written file are the same.
 */
export async function approveEditorWrite(context: OpenCodeContext, format: "docx" | "xlsx" | "pptx" | "md", toolName: string, args: Record<string, unknown>): Promise<string | undefined> {
  const given = text(args.path);
  if (READ_ONLY[format].includes(toolName)) return given;
  const path = format === "docx" ? await wordDocument(context, given) : given;
  if (!path) throw new Error("No Word document is selected for this task. Prepare it with inapp_documents_open first. Nothing was changed.");
  await ask(context, DOCX_COPIES.includes(toolName) ? text(args.fileName) ?? path : path, proposedChange(args));
  return path;
}

/** Asks before a new file is created (a template copy or a new Markdown file); nothing to ask without a path. */
export async function approveNewFile(context: OpenCodeContext, path: string | null | undefined): Promise<void> {
  if (path) await ask(context, path);
}
