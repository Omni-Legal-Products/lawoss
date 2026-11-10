/**
 * LAWOSS: nástroj `lawoss_files` – premenovanie, presun, kópia, nový priečinok, nový súbor, presun do Koša
 * (alfa 2, MČ 22. 10. 2026; nový súbor `create_file` MČ 10. 11. 2026: nový Word, Markdown alebo text bez shellu).
 *
 * Jedna požiadavka = jedna karta enginu s vlastným povolením `lawoss_file_change` a celým plánom
 * („pôvodná → nová“, „Do Koša: X“). Pravidlo odvodzuje `legalwork-runtime-config.ts` z `edit`
 * (zákaz ostáva zákazom, inak „pýtať sa“, YOLO „povoliť“ len pre chat), ale „povoliť do konca
 * konverzácie“ z natívnej karty úprav (engine 1.18.29 ho drží pre celý priečinok klienta) ho nepokryje.
 * `always: []`: každá zmena súborov sa schvaľuje zvlášť.
 * Zamietnutie = engine `RejectedError`, server nič nevykoná. Plán a vykonanie robí server
 * (`lawoss/file-operations.ts`), ktorý pred vykonaním overí revíziou, že sa disk od karty nezmenil.
 */
// OpenCode 2 načíta `default` export (`Plugin.define`).
import { Plugin } from "@opencode/plugin";
import { z } from "zod";
import { chatFilePath, chatWorkspace } from "./lawoss-file-paths.js";
import { CREATE_FILE_RULE, EXACT_NAME_RULE, FILE_REPORT_RULE, fileOperationToolText, MOVE_ACROSS_DRIVES_RULE } from "./lawoss-file-operations-text.js";
import { listWorkspaces, serverUrl, workspaceToolHeaders, type OpenCodeContext } from "./office-plugin-shared.js";
import { hideEngineEnvFromShell } from "./wiki-agent-secret.js";
import { nativeTool } from "./native-tool.js";
import { registerPrimaryContext } from "./native-review-worker.js";

const pathArg = z.string().min(1).max(4096);
// A flat object, not a union: every provider's tool schema accepts it (Gemini and OpenAI reject some anyOf shapes).
// The same holds inside a Word document: one block object with optional fields, no union of block types.
const block = z.object({
  type: z.enum(["heading", "paragraph", "list", "page_break"]).describe("heading: level and text; paragraph: text and optionally align; list: ordered and items; page_break: nothing else."),
  level: z.number().int().min(1).max(3).optional().describe("heading: 1, 2 or 3 (default 1)."),
  text: z.string().optional().describe("heading/paragraph: the text. Only **bold** and *italic* are formatting; everything else is literal."),
  align: z.enum(["left", "justify", "right", "center"]).optional().describe("paragraph: alignment (default left)."),
  ordered: z.boolean().optional().describe("list: true for a numbered list, false for bullets (default false)."),
  items: z.array(z.string()).optional().describe("list: the text of each item."),
});
const document = z.object({
  title: z.string().max(300).optional().describe("The document's title, shown centred at the top."),
  blocks: z.array(block).min(1).max(1000).describe("The document's content in order."),
});
const operation = z.object({
  operation: z.enum(["move", "copy", "create_folder", "create_file", "delete"]).describe("move renames or moves, also to another drive or linked folder (the original then goes to the Trash); copy keeps the original; create_file writes ONE new .docx, .md or .txt file from the content given here and never overwrites; delete moves a file or a folder with its contents to the Trash, where the user can restore it."),
  from: pathArg.optional().describe("move/copy: the existing file or folder."),
  to: pathArg.optional().describe("move/copy: the new path; it must not exist yet."),
  path: pathArg.optional().describe("create_folder/delete: the folder to create or the file/folder to delete. create_file: the new file; it must not exist yet, its extension must match format, and its folder must exist or be created by a create_folder operation earlier in this call."),
  format: z.enum(["docx", "md", "txt"]).optional().describe("create_file: the kind of file; the same as the extension of path."),
  content: z.string().optional().describe("create_file with format md or txt: the whole text of the file (at most 1 MiB)."),
  document: document.optional().describe("create_file with format docx: the Word document as a title and blocks. Do not send XML, HTML or Markdown here."),
  language: z.enum(["sk-SK", "cs-CZ"]).optional().describe("create_file with format docx: the language of the text, for spell-checking in Word (default: Czech when the app runs in Czech, otherwise Slovak)."),
});
const args = z.object({
  operations: z.array(operation).min(1).max(50).describe("Changes in order, 1–50. Paths are relative to the chat's folder (in a case chat, the case folder) or absolute inside this client's folder or its linked folders. A case or client folder may be written as its code alone (Spisy/M001/…): the tool uses the one folder starting with that code, and refuses if several match."),
  description: z.string().max(300).optional().describe("Briefly say why, in the user's language."),
});

const SYSTEM = `To rename, move, copy or delete files and folders, to create folders or to create a new document, use lawoss_files instead of shell commands (mv, cp, rm, mkdir, redirection): the user sees one approval card listing the exact changes, and deleted items go to the Trash. Put a whole requested batch in one call. If the user declines the card, nothing changed; do not retry it now, but if the user later explicitly asks again, call lawoss_files again so they see a new card. Report only the changes the tool result lists as done. ${CREATE_FILE_RULE} ${EXACT_NAME_RULE} ${MOVE_ACROSS_DRIVES_RULE} ${FILE_REPORT_RULE}`;

type Plan = { operations: unknown[]; revision: string };
/** The tool's own permission (not `edit`): see the file header. */
const PERMISSION = "lawoss_file_change";

/**
 * An approved change has no time limit (#223): moving a large folder to another drive copies and compares every
 * file. A stopped chat aborts it and the server removes a partial copy; the plan stays bounded.
 */
async function post(context: OpenCodeContext, workspace: string, route: "plan" | "apply", body: unknown): Promise<unknown> {
  const limit = route === "plan" ? [AbortSignal.timeout(120_000)] : [];
  const signals = [...(context.abort ? [context.abort] : []), ...limit];
  const response = await fetch(`${serverUrl()}/workspace/${encodeURIComponent(workspace)}/lawoss/files/${route}`, {
    method: "POST", headers: { ...await workspaceToolHeaders(context), "Content-Type": "application/json" }, body: JSON.stringify(body),
    ...(signals.length ? { signal: AbortSignal.any(signals) } : {}),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`File change refused (${response.status}): ${text}`);
  return JSON.parse(text);
}

type OperationInput = z.output<typeof operation>;
type BlockInput = z.output<typeof block>;

/** The server's exact block shape from the model's flat one; a missing required field is named, not guessed. */
function serverBlock(item: BlockInput, index: number): Record<string, unknown> {
  const missing = (field: string) => new Error(`create_file: block ${index + 1} (${item.type}) needs ${field}. Nothing was changed.`);
  if (item.type === "page_break") return { type: "page_break" };
  if (item.type === "list") {
    if (!item.items?.length) throw missing("items");
    return { type: "list", ordered: item.ordered ?? false, items: item.items };
  }
  if (item.text === undefined) throw missing("text");
  if (item.type === "heading") return { type: "heading", level: item.level ?? 1, text: item.text };
  return { type: "paragraph", text: item.text, ...(item.align ? { align: item.align } : {}) };
}

/** create_file as the server takes it: `content` is the text (md, txt) or the structured Word document (docx). */
function newFile(item: OperationInput): Record<string, unknown> {
  if (!item.format) throw new Error("create_file needs format: docx, md or txt, the same as the extension of path. Nothing was changed.");
  if (item.format !== "docx") {
    if (item.content === undefined) throw new Error(`create_file with format ${item.format} needs content: the text of the file. Nothing was changed.`);
    return { operation: "create_file", format: item.format, content: item.content };
  }
  if (!item.document) throw new Error("create_file with format docx needs document: { title, blocks: [{ type: \"heading\" | \"paragraph\" | \"list\" | \"page_break\", … }] }. Nothing was changed.");
  return { operation: "create_file", format: "docx", content: { ...(item.document.title ? { title: item.document.title } : {}), blocks: item.document.blocks.map(serverBlock) },
    ...(item.language ? { language: item.language } : {}) };
}

function visiblePaths(plan: Plan): string[] {
  const paths = plan.operations.flatMap((item) => item && typeof item === "object"
    ? ["from", "to"].flatMap((key) => { const value: unknown = Reflect.get(item, key); return typeof value === "string" ? [value] : []; }) : []);
  return [...new Set(paths)];
}

async function execute(input: z.output<typeof args>, context: OpenCodeContext): Promise<string> {
  if (!context.sessionID || !context.directory) throw new Error("File changes require a chat and its folder.");
  if (!context.ask) throw new Error("File changes need the user's approval, but approval requests are unavailable.");
  const directory = context.directory;
  const own = chatWorkspace(await listWorkspaces(context), directory);
  if (!own) throw new Error(`No LegalWork workspace matches the working directory ${directory}.`);
  const absolute = (value: string) => chatFilePath(value, directory, own.path);
  const operations = input.operations.map((item) => {
    if (item.operation === "move" || item.operation === "copy") {
      if (!item.from || !item.to) throw new Error(`${item.operation} needs both from and to. Nothing was changed.`);
      return { operation: item.operation, from: absolute(item.from), to: absolute(item.to) };
    }
    if (!item.path) throw new Error(`${item.operation} needs path. Nothing was changed.`);
    if (item.operation === "create_file") return { ...newFile(item), path: absolute(item.path) };
    return { operation: item.operation, path: absolute(item.path) };
  });
  const workspace = own.id;
  const plan: Plan = z.object({ operations: z.array(z.unknown()), revision: z.string() }).parse(await post(context, workspace, "plan", { operations }));
  await context.ask({ permission: PERMISSION, patterns: visiblePaths(plan), always: [],
    metadata: { lawossFiles: plan.operations, ...(input.description ? { description: input.description } : {}) } });
  const result = await post(context, workspace, "apply", { operations, approved: plan.operations, revision: plan.revision, sessionID: context.sessionID });
  return fileOperationToolText(result);
}

export default Plugin.define({
  id: "lawoss.file-operations",
  async setup(ctx) {
    const shell = await ctx.shell.hook("create.before", (event) => { hideEngineEnvFromShell(event); });
    const context = await registerPrimaryContext(ctx, (event) => { event.system.push({ type: "text", text: SYSTEM }); });
    const tools = await ctx.tool.transform((editor) => {
      editor.add(nativeTool(ctx, {
        name: "lawoss_files",
        description: `Rename, move, copy or delete files and folders, create folders, or create a new Word (.docx), Markdown (.md) or plain-text (.txt) file from content you give, in this client's folder and its linked folders. Shows the user one approval card with every change (no card when YOLO Mode is on). Deleting moves items to the Trash. Never overwrites: an existing target is refused. A declined card changes nothing. The result lists what was actually done. ${CREATE_FILE_RULE} ${EXACT_NAME_RULE} ${MOVE_ACROSS_DRIVES_RULE}`,
        schema: args,
        // The tool asks its own `lawoss_file_change` card with the whole plan; no second card for its name.
        permission: "domain",
        execute,
      }));
    });
    return async () => { await Promise.all([shell.dispose(), context.dispose(), tools.dispose()]); };
  },
});
