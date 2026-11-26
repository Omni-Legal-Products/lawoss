import { createHash } from "node:crypto";
import { lstat, open } from "node:fs/promises";
import { constants } from "node:fs";
import { join, relative, sep } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";

const line = (max: number) => z.string().trim().min(1).max(max).regex(/^[^\p{Cc}\p{Cf}\u2028\u2029]+$/u);
export const registerCaseSchema = z.strictObject({
  operation: z.literal("register_case"),
  title: line(180),
  source: line(1024),
  phase: line(350).optional(),
  next_step: line(350).optional(),
});
type Case = z.infer<typeof registerCaseSchema>;
type Create = { operation: "create_folder"; path: string } | { operation: "create_file"; format: "md"; path: string; content: string };
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";
const info = (path: string) => lstat(path).catch(error => { if (missing(error)) return null; throw error; });

/** Emit ordinary create-only operations so the existing path checks, approval and audit cover every write. */
export async function planCaseRegistration(input: Case, root: string, resolveOwned: (path: string) => Promise<string>): Promise<Create[]> {
  const title = input.title.normalize("NFC").replace(/\s+/gu, " ");
  const key = title.toLowerCase();
  const id = createHash("sha256").update(key).digest("hex").slice(0, 16);
  const slug = key.normalize("NFKD").replace(/\p{M}+/gu, "").replace(/[^a-z0-9]+/gu, "-").slice(0, 48).replace(/-+$/u, "");
  const folder = await resolveOwned(join(root, "Spisy", `spis-${slug || "okf"}-${id}`));
  const card = await resolveOwned(join(folder, "matter.md"));
  if (input.source.split(/[\\/]/u).some(part => !part || part === "." || part === "..") || /^[A-Za-z]:/u.test(input.source)) {
    throw new ApiError(400, "case_source_path", "Use the existing source file's path relative to this client.");
  }
  const source = await resolveOwned(join(root, ...input.source.split(/[\\/]/u)));
  if (!(await info(source))?.isFile()) throw new ApiError(400, "case_source_missing", "A case needs an existing source file in this client.");
  const marker = `registration_id: ${id}`;
  const existing = await info(card);
  if (existing) {
    if (existing.isFile() && existing.size < 64 * 1024) {
      const file = await open(card, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(await file.readFile("utf8"))?.[1];
        if (header?.split(/\r?\n/u).includes(marker)) return [];
      } finally { await file.close(); }
    }
    throw new ApiError(409, "case_card_exists", "This case path already has a different card. Review the existing case.");
  }
  const path = relative(root, source).split(sep).join("/");
  const lines = ["---", "type: spis", marker, `title: ${JSON.stringify(title)}`, `source: ${JSON.stringify(path)}`];
  if (input.phase) lines.push(`phase: ${JSON.stringify(input.phase)}`);
  if (input.next_step) lines.push(`next_step: ${JSON.stringify(input.next_step)}`);
  lines.push("---", "", title, "", path, "");
  const directory = await info(folder);
  if (directory && !directory.isDirectory()) throw new ApiError(409, "case_folder_conflict", "The case folder path is already in use.");
  const operations: Create[] = directory ? [] : [{ operation: "create_folder", path: folder }];
  operations.push({ operation: "create_file", path: card, format: "md", content: lines.join("\n") });
  return operations;
}
