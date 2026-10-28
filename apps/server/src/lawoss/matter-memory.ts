/**
 * LAWOSS: čítanie pamäte spisu bez karty (alfa 2, N-A3-3, rozhodnutie MČ 23. 10. 2026).
 *
 * Skill `okf-pamat` čítal pamäť cez `node …/okf-memory.js preamble|read` v shelli a každé čítanie
 * ukázalo najširšiu kartu („celý počítač + internet“). Nástroj `lawoss_memory`
 * (`opencode-plugins/lawoss-memory-tools.ts`) volá túto funkciu: ten istý kód pamäte, bez podprocesu,
 * len na čítanie, len v koreni klienta chatu a v jeho pripojených priečinkoch. Spis vo vnútri iného
 * registrovaného klienta (aj vnoreného) sa odmietne bez jeho mena.
 *
 * Zápis (N-A7-10, MČ 23. 10. 2026: zápis s kartou „čo a kam“): nástroj `lawoss_memory_write` pošle celý
 * záznam sem; `writeMatterMemoryForChat` v tej istej hranici pripraví náhľad (`okf-memory write` bez `--apply`),
 * nástroj ukáže jednu kartu s textom a cieľovým súborom a po schválení sa zapíše tým istým kódom. Len jeden
 * záznam vrstvy L2 v spise s kartou veci pod koreňom klienta chatu (nie v pripojenom priečinku ani v kancelárii,
 * ktorej pamäť čítajú všetci klienti); L1/L3 (kancelária, meno schvaľujúceho) a mazanie ostávajú v CLI.
 */
import { createHash } from "node:crypto";
import { lstat, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { canonicalPath, isOfficeMemoryFolder } from "./linked-folders-rules.js";
import { documentLinkedFolders, officeRoot } from "./linked-folders.js";
import { isPathWithin } from "./path-within.js";
import { matterMemoryScope, readMatterMemory, writeMatterMemory } from "./workspace-memory-runtime.js";

/** Every memory and context file is a regular file read without links, up to these limits (okf-pamat safe-read.ts). */
export { FILE_BYTE_LIMIT, STORE_BYTE_LIMIT } from "./workspace-memory-runtime.js";

/** Characters per page; the engine truncates larger tool results, so the model follows nextOffset. */
export const MATTER_MEMORY_PAGE = 40_000;

/** Snapshots for paging: the newest few reads, for a short time; the boundary is still checked on every call. */
const PAGE_SNAPSHOTS = 2, PAGE_SNAPSHOT_MS = 120_000;
const pages = new Map<string, { code: number; out: string; at: number }>();

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

const notOwn = (verb: "read" | "written" = "read") => new ApiError(403, "memory_folder_not_own",
  `This folder is outside this client's folder and its linked folders, or it belongs to another client. Nothing was ${verb}. Use only the memory of this client's own cases.`);

type OwnFolders = { root: string; linked: readonly string[]; others: readonly string[] };

/** The chat's client root, its linked folders and every other registered client, all by their real paths. */
async function ownFolders(config: ServerConfig, workspace: WorkspaceInfo,
  linkedFolders: (config: ServerConfig, workspace: WorkspaceInfo) => Promise<readonly string[]>): Promise<OwnFolders> {
  const root = await canonicalPath(workspace.path);
  const others = await Promise.all(config.workspaces
    .filter((entry) => entry.id !== workspace.id && entry.workspaceType !== "remote" && Boolean(entry.path))
    .map((entry) => canonicalPath(entry.path)));
  return { root, linked: await linkedFolders(config, workspace), others: others.filter((other) => other !== root) };
}

/**
 * May the chat of `workspace` read memory in `path`? Its own root or linked folder, and the deepest registered
 * client there is this one (a registered folder that contains this client, e.g. the practice root, does not count).
 */
function readable(path: string, own: OwnFolders): boolean {
  if (!isPathWithin(own.root, path) && !own.linked.some((folder) => isPathWithin(folder, path))) return false;
  return !own.others.some((other) => isPathWithin(other, path) && !isPathWithin(other, own.root));
}

/** The client card above a case chat's root (a case registered on its own) is allowed while no other client lies under it. */
function readableAbove(path: string, own: { root: string; others: readonly string[] }): boolean {
  return isPathWithin(path, own.root) && !own.others.some((other) => isPathWithin(path, other));
}

/**
 * The `Office/` (or `_kancelaria/`) that okf-pamat found above the case, by its real path: the practice's own office
 * (onboarding profile), a folder of this client, or (only without a profile) a real folder next to the clients that
 * lies in no other registered client. A link to another client's case (`C001/Office -> C017/…`), an office
 * of a client that contains this one, or a link elsewhere is not read.
 */
async function officeReadable(logical: string, own: { root: string; linked: readonly string[]; others: readonly string[] }, practice: string | null): Promise<boolean> {
  const real = await canonicalPath(logical);
  if (practice && isOfficeMemoryFolder(real, practice)) return true;
  if (readable(real, own)) return true;
  // Without a practice profile only: a real folder next to the clients, inside no other registered client
  // (not even a client that contains this one).
  if (practice) return false;
  const named = await lstat(logical).catch(() => null);
  if (!named?.isDirectory() || named.isSymbolicLink() || real !== resolve(logical).normalize("NFC")) return false;
  return isPathWithin(dirname(real), own.root) && !own.others.some((other) => isPathWithin(other, real));
}

/** `linkedFolders`: the client's linked folders, read at every call (tests pass their own, as for `LawossDocuments`). */
export async function readMatterMemoryForChat(config: ServerConfig, workspace: WorkspaceInfo, body: unknown,
  linkedFolders: (config: ServerConfig, workspace: WorkspaceInfo) => Promise<readonly string[]> = documentLinkedFolders): Promise<MatterMemoryResult> {
  if (workspace.workspaceType === "remote") throw new ApiError(400, "memory_local_workspace_required", "Case memory can be read only in a local client folder.");
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "memory_arguments", "Use action preamble or read and the absolute path of this client's case folder.");
  const { action, matter, offset = 0 } = parsed.data;
  if (!isAbsolute(matter) || matter.includes("\0")) throw new ApiError(400, "memory_arguments", "Use the absolute path of this client's case folder.");
  const own = await ownFolders(config, workspace, linkedFolders);
  const root = own.root;
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
  // A memory profile in the case must not map a root or source into another client (also a nested one).
  const excludedRoots = own.others.filter((other) => !isPathWithin(other, own.root));
  // offset 0 reads afresh; later pages reuse that snapshot (one consistent text, not a new full read per page).
  const key = `${workspace.id}\0${action}\0${target}`, cached = pages.get(key);
  const result = offset > 0 && cached && Date.now() - cached.at < PAGE_SNAPSHOT_MS ? cached
    : { ...readMatterMemory(action, target, { allowedRoots: [root, ...own.linked], office, excludedRoots }), at: Date.now() };
  pages.delete(key); pages.set(key, result);
  while (pages.size > PAGE_SNAPSHOTS) pages.delete(pages.keys().next().value ?? key);
  const text = result.out.slice(offset, offset + MATTER_MEMORY_PAGE);
  const end = offset + text.length;
  return { action, matter: target, complete: result.code === 0, text, offset, nextOffset: end < result.out.length ? end : null, untrusted: true };
}

const writeSchema = z.object({
  matter: z.string().min(1).max(4096),
  record: z.string().min(1).max(256 * 1024),
  reason: z.string().trim().min(1).max(1000),
  ifRevision: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  apply: z.boolean().optional(),
  approved: z.string().max(128).optional(),
  sessionID: z.string().optional(),
});

/** What the card shows: the record's text and its file, relative to the client's folder (or a linked folder's name). */
export type MatterMemoryWritePreview = {
  status: "preview";
  target: string;
  kind: "create" | "update";
  title: string;
  /** The record type (matter, decision, subject…). */
  type: string;
  truth: string;
  previousTruth?: string;
  history: string[];
  fields: string[];
  reason: string;
  /** Binds the approval to this exact preview; apply refuses when the memory changed after the card. */
  approved: string;
};
export type MatterMemoryWriteResult = { status: "written"; target: string; id: string; text: string };

/** A path for the lawyer, relative to the client's folder. */
const shownPath = (file: string, root: string): string => relative(root, file).split(sep).join("/");

/** Written memory stays with this client: under its own root, in no other registered client. */
function writable(path: string, own: OwnFolders): boolean {
  return isPathWithin(own.root, path) && !own.others.some((other) => isPathWithin(other, path) && !isPathWithin(other, own.root));
}

const OFFICE_NAMES = new Set(["office", "_kancelaria"]);

/**
 * The office memory (`Office/`, `_kancelaria/`) is read by every client of the practice: never written from one
 * client's chat. Refused when the case, or any folder from the client root down to it, is an office folder, or when
 * it lies in the practice's office (onboarding profile), even if that office is linked to this client.
 */
function inOffice(target: string, root: string, practice: string | null): boolean {
  const below = relative(root, target).split(sep).filter(Boolean);
  if ([basename(root), ...below].some((name) => OFFICE_NAMES.has(name.toLowerCase()))) return true;
  if (!practice) return false;
  for (let folder = target; ; folder = dirname(folder)) {
    if (isOfficeMemoryFolder(folder, practice)) return true;
    if (dirname(folder) === folder) return false;
  }
}

/** `memory/` must be a real folder (or not exist yet), never a link to somewhere else. */
async function memoryFolderIsLink(target: string): Promise<boolean> {
  return (await lstat(join(target, "memory")).catch(() => null))?.isSymbolicLink() === true;
}

const refused = (out: string) => new ApiError(422, "memory_write_refused", `${out.trim()}\nNothing was written.`);

/**
 * One case memory record for the chat's `lawoss_memory_write`: without `apply` the preview for the card, with
 * `apply` and the preview's `approved` token the write itself (`okf-memory write … --apply`). The case (with its
 * matter card), its `memory/` folder and the record file must lie under this client's own root, never in a linked
 * folder, another client or an office; only a layer L2 record that stays in the case is written (no approver's name,
 * no deletion).
 */
export async function writeMatterMemoryForChat(config: ServerConfig, workspace: WorkspaceInfo, body: unknown,
  linkedFolders: (config: ServerConfig, workspace: WorkspaceInfo) => Promise<readonly string[]> = documentLinkedFolders): Promise<MatterMemoryWritePreview | MatterMemoryWriteResult> {
  if (workspace.workspaceType === "remote") throw new ApiError(400, "memory_local_workspace_required", "Case memory can be written only in a local client folder.");
  if (config.readOnly) throw new ApiError(403, "read_only", "This server is read-only. Nothing was written.");
  const parsed = writeSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "memory_arguments", "Send the case folder, the whole record, the reason and, for a change of an existing record, its revision.");
  const { matter, record, reason, ifRevision, apply = false, approved } = parsed.data;
  if (!isAbsolute(matter) || matter.includes("\0") || record.includes("\0")) throw new ApiError(400, "memory_arguments", "Use the absolute path of this client's case folder.");
  const own = await ownFolders(config, workspace, linkedFolders);
  const target = await canonicalPath(matter);
  if (!writable(target, own)) throw notOwn("written");
  if (inOffice(target, own.root, await officeRoot(config))) {
    throw new ApiError(403, "memory_write_office", "This is the office memory, shared by every client of the practice. Nothing was written. Write only to this client's case.");
  }
  if (!(await stat(target).catch(() => null))?.isDirectory()) throw new ApiError(404, "memory_folder_missing", "This case folder does not exist. Nothing was written.");
  // The record goes to `<case>/memory/`: a real folder of this client, not a link (okf-pamat checks it again under its lock).
  if (await memoryFolderIsLink(target) || !writable(await canonicalPath(join(target, "memory")), own)) throw notOwn("written");

  const options = { reason, expectedRevision: ifRevision };
  const preview = writeMatterMemory(target, record, { ...options, apply: false });
  const plan = preview.plan;
  if (preview.code !== 0 || !plan) throw refused(preview.out);
  if (plan.kind === "delete" || plan.requiresApproval || await canonicalPath(plan.targetDir) !== target) {
    throw new ApiError(422, "memory_write_layer",
      `Record ${plan.id} is layer ${plan.layer}: it belongs to the office or needs the lawyer's name, so this tool does not write it. Nothing was written. Tell the user.`);
  }
  const file = await canonicalPath(plan.file);
  if (!writable(file, own)) throw notOwn("written");
  // Bound to the file, the preview and the exact bytes of the record that will be written.
  const token = createHash("sha256").update(`${file}\0${plan.recordHash}\0${preview.out}`).digest("hex");
  const shown = shownPath(file, own.root);
  if (!apply) {
    return { status: "preview", target: shown, kind: plan.kind, title: plan.title, type: plan.type, truth: plan.truth,
      ...(plan.previousTruth === undefined ? {} : { previousTruth: plan.previousTruth }),
      history: plan.history, fields: plan.fields, reason, approved: token };
  }
  if (approved !== token) {
    throw new ApiError(409, "memory_write_changed", "The case memory or the record changed after the card was shown. Nothing was written. Read the memory again and prepare a new proposal.");
  }
  const result = writeMatterMemory(target, record, { ...options, apply: true });
  if (result.code !== 0) throw refused(result.out);
  return { status: "written", target: shown, id: plan.id, text: result.out };
}
