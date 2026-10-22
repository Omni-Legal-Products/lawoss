/**
 * LAWOSS: nástroj `lawoss_files` – premenovanie, presun, kópia, nový priečinok, zmazanie (alfa 2, MČ 22. 10. 2026).
 *
 * Jedna požiadavka = jedna karta enginu s povolením `edit` a celým plánom („pôvodná → nová“,
 * „zmazať X“). Povolenie `edit` znamená, že platí predvolené „pýtať sa“, pravidlá advokáta aj firmy
 * a YOLO bez karty, bez ďalšieho napojenia. `always: []`: každá zmena súborov sa schvaľuje zvlášť
 * („povoliť do konca konverzácie“ by v engine 1.18.29 platilo pre všetky chaty klienta).
 * Zamietnutie = engine `RejectedError`, server nič nevykoná. Plán a vykonanie robí server
 * (`lawoss/file-operations.ts`), ktorý pred vykonaním overí, že sa disk od karty nezmenil.
 */
// Exportovaný je len vstupný bod pluginu: OpenCode volá každý export modulu.
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { resolveWorkspaceId, serverUrl, workspaceToolHeaders, type OpenCodeContext } from "./office-plugin-shared.js";

const pathArg = z.string().min(1).max(4096);
// A flat object, not a union: every provider's tool schema accepts it (Gemini and OpenAI reject some anyOf shapes).
const operation = z.object({
  operation: z.enum(["move", "copy", "create_folder", "delete"]).describe("move renames or moves; delete removes a file or a folder with its contents."),
  from: pathArg.optional().describe("move/copy: the existing file or folder."),
  to: pathArg.optional().describe("move/copy: the new path; it must not exist yet."),
  path: pathArg.optional().describe("create_folder/delete: the folder to create or the file/folder to delete."),
});
const args = z.object({
  operations: z.array(operation).min(1).max(50).describe("Changes in order, 1–50. Paths are relative to the chat's folder or absolute inside this client's folder or its linked folders."),
  description: z.string().max(300).optional().describe("Briefly say why, in the user's language."),
});

const SYSTEM = "To rename, move, copy or delete files and folders or to create folders, use lawoss_files instead of shell commands (mv, cp, rm, mkdir): the user sees one approval card listing the exact changes. Put a whole requested batch in one call. If the user declines the card, nothing changed; do not retry it now, but if the user later explicitly asks again, call lawoss_files again so they see a new card. Report only the changes the tool result lists as done.";

type Plan = { operations: unknown[] };

async function post(context: OpenCodeContext, workspace: string, route: string, body: unknown): Promise<unknown> {
  const response = await fetch(`${serverUrl()}/workspace/${encodeURIComponent(workspace)}/lawoss/files/${route}`, {
    method: "POST", headers: { ...await workspaceToolHeaders(context), "Content-Type": "application/json" }, body: JSON.stringify(body),
    signal: context.abort ? AbortSignal.any([context.abort, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`File change refused (${response.status}): ${text}`);
  return JSON.parse(text);
}

function visiblePaths(plan: Plan): string[] {
  const paths = plan.operations.flatMap((item) => item && typeof item === "object"
    ? ["from", "to"].flatMap((key) => { const value: unknown = Reflect.get(item, key); return typeof value === "string" ? [value] : []; }) : []);
  return [...new Set(paths)];
}

export const LawossFileOperations = async () => ({
  "experimental.chat.system.transform": async (_input: unknown, output: { system: string[] }) => { output.system.push(SYSTEM); },
  tool: {
    lawoss_files: {
      description: "Rename, move, copy or delete files and folders, or create folders, in this client's folder and its linked folders. Shows the user one approval card with every change (no card when YOLO Mode is on). Never overwrites: an existing target is refused. A declined card changes nothing. The result lists what was actually done.",
      args: args.shape,
      async execute(raw: unknown, context: OpenCodeContext) {
        const input = args.parse(raw);
        if (!context.sessionID || !context.directory) throw new Error("File changes require a chat and its folder.");
        if (!context.ask) throw new Error("File changes need the user's approval, but approval requests are unavailable.");
        const directory = context.directory;
        const absolute = (value: string) => isAbsolute(value) ? value : resolve(directory, value);
        const operations = input.operations.map((item) => {
          if (item.operation === "move" || item.operation === "copy") {
            if (!item.from || !item.to) throw new Error(`${item.operation} needs both from and to. Nothing was changed.`);
            return { operation: item.operation, from: absolute(item.from), to: absolute(item.to) };
          }
          if (!item.path) throw new Error(`${item.operation} needs path. Nothing was changed.`);
          return { operation: item.operation, path: absolute(item.path) };
        });
        const workspace = await resolveWorkspaceId(context, { requireDirectory: true });
        const plan = z.object({ operations: z.array(z.unknown()) }).parse(await post(context, workspace, "plan", { operations }));
        await context.ask({ permission: "edit", patterns: visiblePaths(plan), always: [],
          metadata: { lawossFiles: plan.operations, ...(input.description ? { description: input.description } : {}) } });
        const result = await post(context, workspace, "apply", { operations, approved: plan.operations, sessionID: context.sessionID });
        return JSON.stringify(result);
      },
    },
  },
});
