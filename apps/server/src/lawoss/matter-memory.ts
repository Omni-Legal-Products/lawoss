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
 *
 * Rozhodnutia MČ 10. 11. 2026 (prehliadka s vetami advokáta):
 * A. `scope: "client"`: jeden záznam L2 na úrovni klienta (`<klient>/memory/`, typy `subject`, `screening` a pracovná
 *    poznámka `client_note`), ktorý `readScope()` prečíta pri každom prípade klienta. Tá istá hranica, karta a revízie.
 * B. `kind: "instruction_deadline"` (nástroj `lawoss_memory_deadline`): lehota s výslovným dátumom z pokynu advokáta
 *    v chate. Jedna karta, potom riadok pokynu vo `VSTUPY.md` prípadu a úloha s `deadlines` označená
 *    `deadline_basis: lawyer_instruction` (bez `verified`); buď oba zápisy, alebo žiadny.
 */
import { createHash } from "node:crypto";
import { lstat, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { withFileWriteLocks } from "../file-write-lock.js";
import { readRegister, writeRegister, type Register } from "./file-operation-inputs.js";
import { appendInputRow, INPUT_REGISTER_FILE, instructionInputRow, MATTER_CARD_FILES, nextInputId, receivedStamp } from "./input-register-runtime.js";
import { canonicalPath, isOfficeMemoryFolder } from "./linked-folders-rules.js";
import { documentLinkedFolders, officeRoot } from "./linked-folders.js";
import { isPathWithin } from "./path-within.js";
import { CLIENT_RECORD_TYPES, clientMemoryDir, INSTRUCTION_DEADLINE_BASIS, instructionDeadlineRecord, matterMemoryScope, readMatterMemory, writeClientMemory, writeMatterMemory } from "./workspace-memory-runtime.js";

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
    .filter((entry) => entry.id !== workspace.id && Boolean(entry.path))
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
  /** `client`: a client-level record in the client's own memory, read with every case of that client. */
  scope: z.enum(["case", "client"]).optional(),
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
  /** `client`: the record applies to the whole client (every case of it). */
  scope?: "client";
  /** A deadline from the lawyer's instruction in chat: what the card says besides the record. */
  deadline?: MatterMemoryDeadline;
};
/** `register`: the case's input register that gets the instruction's row `inputId`; `basis`: not verified from a document. */
export type MatterMemoryDeadline = { case: string; date: string; what: string; basis: string; register: string; inputId: string };
export type MatterMemoryWriteResult = { status: "written"; target: string; id: string; text: string; register?: string; inputId?: string };

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

/** The client's folder a client-level record goes to: the named folder (client card) or the client above the named case. */
async function clientTarget(named: string, own: OwnFolders): Promise<string> {
  const dir = clientMemoryDir(named);
  if (!dir) {
    throw new ApiError(422, "memory_client_missing", "This folder has no client card (client.md), so a note for the whole client has no place here. Nothing was written. Write the note to the case instead, or tell the user.");
  }
  const real = await canonicalPath(dir);
  if (!writable(real, own)) throw notOwn("written");
  return real;
}

/** The boundary every write shares: this client's own root, no other client, no office, a real `memory/` folder. */
async function writeTarget(config: ServerConfig, own: OwnFolders, matter: string, client: boolean): Promise<string> {
  const named = await canonicalPath(matter);
  if (!writable(named, own)) throw notOwn("written");
  const practice = await officeRoot(config);
  const office = () => new ApiError(403, "memory_write_office", "This is the office memory, shared by every client of the practice. Nothing was written. Write only to this client's case.");
  if (inOffice(named, own.root, practice)) throw office();
  if (!(await stat(named).catch(() => null))?.isDirectory()) throw new ApiError(404, "memory_folder_missing", "This case folder does not exist. Nothing was written.");
  const target = client ? await clientTarget(named, own) : named;
  if (inOffice(target, own.root, practice)) throw office();
  // The record goes to `<target>/memory/`: a real folder of this client, not a link (okf-pamat checks it again under its lock).
  if (await memoryFolderIsLink(target) || !writable(await canonicalPath(join(target, "memory")), own)) throw notOwn("written");
  return target;
}

/**
 * One memory record for the chat's `lawoss_memory_write`: without `apply` the preview for the card, with
 * `apply` and the preview's `approved` token the write itself (`okf-memory write … --apply`). The case (with its
 * matter card), its `memory/` folder and the record file must lie under this client's own root, never in a linked
 * folder, another client or an office; only a layer L2 record that stays in the case is written (no approver's name,
 * no deletion). With `scope: "client"` the record goes to the client's own memory instead (subject, screening or a
 * client note, layer L2), under the same boundary. `kind: "instruction_deadline"` is `writeInstructionDeadline`.
 */
export async function writeMatterMemoryForChat(config: ServerConfig, workspace: WorkspaceInfo, body: unknown,
  linkedFolders: (config: ServerConfig, workspace: WorkspaceInfo) => Promise<readonly string[]> = documentLinkedFolders, now = new Date()): Promise<MatterMemoryWritePreview | MatterMemoryWriteResult> {
  if (config.readOnly) throw new ApiError(403, "read_only", "This server is read-only. Nothing was written.");
  if (body && typeof body === "object" && "kind" in body && body.kind === "instruction_deadline") return writeInstructionDeadline(config, workspace, body, linkedFolders, now);
  const parsed = writeSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "memory_arguments", "Send the case folder, the whole record, the reason and, for a change of an existing record, its revision.");
  const { matter, record, reason, ifRevision, apply = false, approved } = parsed.data;
  const client = parsed.data.scope === "client";
  if (!isAbsolute(matter) || matter.includes("\0") || record.includes("\0")) throw new ApiError(400, "memory_arguments", "Use the absolute path of this client's case folder.");
  const own = await ownFolders(config, workspace, linkedFolders);
  const target = await writeTarget(config, own, matter, client);

  const options = { reason, expectedRevision: ifRevision };
  const write = client ? writeClientMemory : writeMatterMemory;
  const preview = write(target, record, { ...options, apply: false });
  const plan = preview.plan;
  if (preview.code !== 0 || !plan) throw refused(preview.out);
  if (plan.kind === "delete" || plan.requiresApproval || plan.layer !== "L2" || await canonicalPath(plan.targetDir) !== target) {
    throw new ApiError(422, "memory_write_layer",
      `Record ${plan.id} is layer ${plan.layer}: it belongs to the office or needs the lawyer's name, so this tool does not write it. Nothing was written. Tell the user.`);
  }
  // The seam checks it too; a client-level record is never another type, whatever the seam returns.
  if (client && !CLIENT_RECORD_TYPES.includes(plan.type)) throw refused(`A client-level record is only ${CLIENT_RECORD_TYPES.join(", ")}.`);
  const file = await canonicalPath(plan.file);
  if (!writable(file, own)) throw notOwn("written");
  // Bound to the file, the preview and the exact bytes of the record that will be written.
  const token = createHash("sha256").update(`${file}\0${plan.recordHash}\0${preview.out}`).digest("hex");
  const shown = shownPath(file, own.root);
  if (!apply) {
    return { status: "preview", target: shown, kind: plan.kind, title: plan.title, type: plan.type, truth: plan.truth,
      ...(plan.previousTruth === undefined ? {} : { previousTruth: plan.previousTruth }),
      history: plan.history, fields: plan.fields, reason, approved: token, ...(client ? { scope: "client" as const } : {}) };
  }
  if (approved !== token) {
    throw new ApiError(409, "memory_write_changed", "The case memory or the record changed after the card was shown. Nothing was written. Read the memory again and prepare a new proposal.");
  }
  const result = write(target, record, { ...options, apply: true });
  if (result.code !== 0) throw refused(result.out);
  return { status: "written", target: shown, id: plan.id, text: result.out };
}

const deadlineSchema = z.object({
  kind: z.literal("instruction_deadline"),
  matter: z.string().min(1).max(4096),
  date: z.string().max(64),
  what: z.string().trim().min(1).max(200),
  instruction: z.string().trim().min(1).max(1000),
  apply: z.boolean().optional(),
  approved: z.string().max(128).optional(),
  sessionID: z.string().optional(),
});

const localDay = (now: Date): string => receivedStamp(now).slice(0, 10);

/** The case's name for the card: the title of its matter card, otherwise the folder's name. Never a code the lawyer must decode. */
async function caseName(target: string): Promise<string> {
  for (const card of MATTER_CARD_FILES) {
    const text = await readFile(join(target, card), "utf8").catch(() => null);
    const header = text === null ? undefined : /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1];
    const title = header === undefined ? undefined : /^title:[ \t]*(.+?)[ \t]*$/m.exec(header)?.[1]?.replace(/^(["'])(.*)\1$/, "$2").trim();
    if (title) return title;
  }
  return basename(target);
}

const registerHash = (register: Register | null): string => register ? createHash("sha256").update(register.content).digest("hex") : "none";

/** Puts the register back as it was before this call's row: the earlier bytes, or no file when the call created it. */
async function restoreRegister(path: string, before: Register | null): Promise<void> {
  if (!before) { await rm(path, { force: true }); return; }
  await writeRegister(path, before.content, await readRegister(path));
}

/**
 * A deadline the lawyer stated in chat with an explicit date (MČ 10. 11. 2026), for `lawoss_memory_deadline`: one card,
 * then (1) the instruction's row in the case's `VSTUPY.md` (source: lawyer's instruction in chat, no document, closed
 * with the record's ID) and (2) a new L2 task with the date in `deadlines`, marked `deadline_basis: lawyer_instruction`
 * and never `verified`, so readers show it as "by the lawyer's instruction, not verified from a document". The date is
 * never derived: anything but a real calendar day is refused. Without `apply` only the preview; with it the register
 * is written first under its lock and put back if the memory write fails (undoing a memory record would be a deletion).
 */
async function writeInstructionDeadline(config: ServerConfig, workspace: WorkspaceInfo, body: unknown,
  linkedFolders: (config: ServerConfig, workspace: WorkspaceInfo) => Promise<readonly string[]>, now: Date): Promise<MatterMemoryWritePreview | MatterMemoryWriteResult> {
  const parsed = deadlineSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(400, "memory_arguments", "Send the case folder, the date the lawyer stated (YYYY-MM-DD), what the deadline is for and the lawyer's sentence.");
  const { matter, date, what, instruction, apply = false, approved } = parsed.data;
  if (!isAbsolute(matter) || matter.includes("\0")) throw new ApiError(400, "memory_arguments", "Use the absolute path of this client's case folder.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new ApiError(422, "memory_deadline_date", "A deadline needs the explicit calendar date the lawyer stated (YYYY-MM-DD). Never derive or compute it. Nothing was written. Ask the lawyer for the exact date.");
  }
  const own = await ownFolders(config, workspace, linkedFolders);
  const target = await writeTarget(config, own, matter, false);
  const register = join(target, INPUT_REGISTER_FILE);
  if (!writable(await canonicalPath(register), own)) throw notOwn("written");

  const before = await readRegister(register).catch(() => { throw refused("The input register of this case is not a regular file."); });
  const inputId = nextInputId(before?.content ?? null);
  const composed = instructionDeadlineRecord(target, { date, what, instruction, inputId, today: localDay(now) });
  if (composed.code !== 0 || !composed.text || !composed.id) throw refused(composed.out);
  const reason = `${composed.jurisdiction === "cz" ? "Pokyn advokáta v chatu" : "Pokyn advokáta v chate"} (${inputId})`;
  const preview = writeMatterMemory(target, composed.text, { reason, apply: false });
  const plan = preview.plan;
  if (preview.code !== 0 || !plan) throw refused(preview.out);
  if (plan.kind !== "create" || plan.requiresApproval || plan.layer !== "L2" || await canonicalPath(plan.targetDir) !== target) throw refused("The deadline record cannot be written to this case.");
  const file = await canonicalPath(plan.file);
  if (!writable(file, own)) throw notOwn("written");
  // Bound to both files: the record's bytes and the register as it was when the card was shown.
  const token = createHash("sha256").update(`${file}\0${plan.recordHash}\0${preview.out}\0${register}\0${registerHash(before)}\0${inputId}`).digest("hex");
  const shown = shownPath(file, own.root), shownRegister = shownPath(register, own.root);
  if (!apply) {
    return { status: "preview", target: shown, kind: "create", title: plan.title, type: plan.type, truth: plan.truth, history: plan.history, fields: plan.fields, reason, approved: token,
      deadline: { case: await caseName(target), date, what: plan.title, basis: INSTRUCTION_DEADLINE_BASIS, register: shownRegister, inputId } };
  }
  const changed = () => new ApiError(409, "memory_write_changed", "The case memory or its input register changed after the card was shown. Nothing was written. Prepare the deadline again.");
  if (approved !== token) throw changed();
  const row = instructionInputRow(inputId, receivedStamp(now), instruction.replace(/\s+/g, " "), composed.id);
  const text = await withFileWriteLocks([register], async () => {
    const current = await readRegister(register);
    if (registerHash(current) !== registerHash(before)) throw changed();
    await writeRegister(register, appendInputRow(current?.content ?? null, row, basename(target)), current);
    let failure: string | null = null, out = "";
    try {
      const result = writeMatterMemory(target, composed.text ?? "", { reason, apply: true });
      if (result.code !== 0) failure = result.out; else out = result.out;
    } catch (error) { failure = error instanceof Error ? error.message : String(error); }
    if (failure === null) return out;
    // Both or neither: the instruction's row goes away with the deadline that was not written.
    try { await restoreRegister(register, current); }
    catch { throw new ApiError(500, "memory_deadline_partial", `The deadline was not written, and the row ${inputId} could not be removed from ${shownRegister}. Tell the user to remove that row. ${failure.trim()}`); }
    throw refused(failure);
  });
  return { status: "written", target: shown, id: composed.id, text, register: shownRegister, inputId };
}
