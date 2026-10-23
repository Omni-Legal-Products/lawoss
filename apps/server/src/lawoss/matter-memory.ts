/**
 * LAWOSS: čítanie pamäte spisu bez karty (alfa 2, N-A3-3, rozhodnutie MČ 23. 10. 2026).
 *
 * Skill `okf-pamat` čítal pamäť cez `node …/okf-memory.js preamble|read` v shelli a každé čítanie
 * ukázalo najširšiu kartu („celý počítač + internet“). Nástroj `lawoss_memory`
 * (`opencode-plugins/lawoss-memory-tools.ts`) volá túto funkciu: ten istý kód pamäte, bez podprocesu,
 * len na čítanie, len v koreni klienta chatu a v jeho pripojených priečinkoch. Spis vo vnútri iného
 * registrovaného klienta (aj vnoreného) sa odmietne bez jeho mena. Zápis pamäte ostáva v CLI so schválením.
 */
import { lstat, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { canonicalPath, isOfficeMemoryFolder } from "./linked-folders-rules.js";
import { documentLinkedFolders, officeRoot } from "./linked-folders.js";
import { isPathWithin } from "./path-within.js";
import { matterMemoryScope, readMatterMemory } from "./workspace-memory-runtime.js";

/** Every memory and context file is a regular file read without links, up to these limits (okf-pamat safe-read.ts). */
export { FILE_BYTE_LIMIT, STORE_BYTE_LIMIT } from "./workspace-memory-runtime.js";

/** Characters per page; the engine truncates larger tool results, so the model follows nextOffset. */
export const MATTER_MEMORY_PAGE = 40_000;

const inputSchema = z.object({
  action: z.enum(["preamble", "read"]),
  matter: z.string().min(1).max(4096),
  offset: z.number().int().min(0).optional(),
});

export type MatterMemoryResult = {
  action: "preamble" | "read";
  matter: string;
  /** false: some memory files could not be read; the text names them. Partial text is not "nothing else exists". */
  complete: boolean;
  text: string;
  offset: number;
  nextOffset: number | null;
  untrusted: true;
};

const notOwn = () => new ApiError(403, "memory_folder_not_own",
  "This folder is outside this client's folder and its linked folders, or it belongs to another client. Nothing was read. Read only the memory of this client's own cases.");

/**
 * May the chat of `workspace` read memory in `path`? Its own root or linked folder, and the deepest registered
 * client there is this one (a registered folder that contains this client, e.g. the practice root, does not count).
 */
function readable(path: string, own: { root: string; linked: readonly string[]; others: readonly string[] }): boolean {
  if (!isPathWithin(own.root, path) && !own.linked.some((folder) => isPathWithin(folder, path))) return false;
  return !own.others.some((other) => isPathWithin(other, path) && !isPathWithin(other, own.root));
}

/** The client card above a case chat's root (a case registered on its own) is allowed while no other client lies under it. */
function readableAbove(path: string, own: { root: string; others: readonly string[] }): boolean {
  return isPathWithin(path, own.root) && !own.others.some((other) => isPathWithin(path, other));
}

/**
 * The `Office/` (or `_kancelaria/`) that okf-pamat found above the case, by its real path: the practice's own office
 * (onboarding profile), a folder of this client, or (without a profile) a real folder next to the clients whose
 * parent is not another registered client. A link to another client's case (`C001/Office -> C017/…`), an office
 * of a client that contains this one, or a link elsewhere is not read.
 */
async function officeReadable(logical: string, own: { root: string; linked: readonly string[]; others: readonly string[] }, practice: string | null): Promise<boolean> {
  const real = await canonicalPath(logical);
  if (practice && isOfficeMemoryFolder(real, practice)) return true;
  if (readable(real, own)) return true;
  const named = await lstat(logical).catch(() => null);
  if (!named?.isDirectory() || named.isSymbolicLink() || real !== resolve(logical).normalize("NFC")) return false;
  const parent = dirname(real);
  return isPathWithin(parent, own.root) && !own.others.some((other) => isPathWithin(other, real) && !isPathWithin(other, own.root))
    && !own.others.some((other) => other === parent);
}

/** `linkedFolders`: the client's linked folders, read at every call (tests pass their own, as for `LawossDocuments`). */
export async function readMatterMemoryForChat(config: ServerConfig, workspace: WorkspaceInfo, body: unknown,
  linkedFolders: (config: ServerConfig, workspace: WorkspaceInfo) => Promise<readonly string[]> = documentLinkedFolders): Promise<MatterMemoryResult> {
  if (workspace.workspaceType === "remote") throw new ApiError(400, "memory_local_workspace_required", "Case memory can be read only in a local client folder.");
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "memory_arguments", "Use action preamble or read and the absolute path of this client's case folder.");
  const { action, matter, offset = 0 } = parsed.data;
  if (!isAbsolute(matter) || matter.includes("\0")) throw new ApiError(400, "memory_arguments", "Use the absolute path of this client's case folder.");
  const root = await canonicalPath(workspace.path);
  const others = await Promise.all(config.workspaces
    .filter((entry) => entry.id !== workspace.id && entry.workspaceType !== "remote" && Boolean(entry.path))
    .map((entry) => canonicalPath(entry.path)));
  const own = { root, linked: await linkedFolders(config, workspace), others: others.filter((other) => other !== root) };
  const target = await canonicalPath(matter);
  if (!readable(target, own)) throw notOwn();
  if (!(await stat(target).catch(() => null))?.isDirectory()) throw new ApiError(404, "memory_folder_missing", "This case folder does not exist. Nothing was read.");
  // `read`/`preamble` also read the client (and subject) memory above the case: never another client's.
  // The practice's `Office/` above is shared (rules, lessons, do-not-cite list): okf-pamat reads only its
  // `okf.config` and `memory/*.md` there, as regular files without links and within size limits (safe-read.ts),
  // and only when `officeReadable` confirms it below.
  const scope = matterMemoryScope(target);
  for (const dir of [scope.clientDir, scope.subjectDir]) {
    if (!dir) continue;
    const above = await canonicalPath(dir);
    if (!readable(above, own) && !readableAbove(above, own)) throw notOwn();
  }
  // Not confirmed: okf-pamat leaves the office out and reports the read as incomplete (no other client named).
  const office = !scope.officeDir || await officeReadable(scope.officeDir, own, await officeRoot(config));
  const result = readMatterMemory(action, target, { allowedRoots: [root, ...own.linked], office });
  const text = result.out.slice(offset, offset + MATTER_MEMORY_PAGE);
  const end = offset + text.length;
  return { action, matter: target, complete: result.code === 0, text, offset, nextOffset: end < result.out.length ? end : null, untrusted: true };
}
