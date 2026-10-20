import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { ApiError } from "../../errors.js";
import type { WorkspaceInfo } from "../../types.js";
import { fingerprint, sha256 } from "./hash.js";
import { idSchema } from "./schema.js";
import { encodeDeadlineRecord, parseDeadlineRecord } from "./record.js";
import { readDeadlineEnvelope, withRecordWriteLock } from "./runtime.js";
import type { DeadlinePayload, DeadlineDomainEvent, MatterBinding } from "./types.js";
const conflict = (message: string) => new ApiError(409, "deadline_conflict", message);
const missing = (error: unknown): boolean => error instanceof Error && "code" in error && error.code === "ENOENT";
export function safePath(root: string, child: string, createDirectories = false): string {
  if (child.includes("\\") || child.startsWith("/") || child.split("/").some(part => !part || part === "." || part === ".." || part.includes(":"))) throw conflict("Use an ordinary scoped relative path.");
  const canonicalRoot = realpathSync(root); let path = canonicalRoot;
  const parts = child.split("/");
  for (const [i, part] of parts.entries()) {
    path = join(path, part);
    try { const info = lstatSync(path); if (info.isSymbolicLink() || (i < parts.length - 1 && !info.isDirectory())) throw conflict("Deadline path cannot contain a symlink or non-directory ancestor."); }
    catch (error) { if (!missing(error)) throw error; if (createDirectories && i < parts.length - 1) mkdirSync(path); }
  }
  return path;
}
function readBounded(path: string, maximum: number): string {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { const stat = lstatSync(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw conflict("Deadline file is not a bounded ordinary file."); const bytes = readFileSync(fd); if (bytes.length > maximum) throw conflict("Deadline file exceeds its bound."); return bytes.toString("utf8"); } finally { closeSync(fd); }
}
export function resolveMatterBindingSync(workspace: Pick<WorkspaceInfo, "id" | "path" | "appFilesStorageKey">, path: string): MatterBinding {
  const workspaceRoot = realpathSync(workspace.path), matterRoot = path === "" ? workspaceRoot : safePath(workspaceRoot, path);
  const info = lstatSync(workspaceRoot), matterInfo = lstatSync(matterRoot);
  if (!matterInfo.isDirectory() || matterInfo.isSymbolicLink()) throw conflict("Matter root must be a current ordinary directory.");
  const cards = ["matter.md", "spis.md", "project.md", "projekt.md"].filter(name => existsSync(join(matterRoot, name)));
  if (cards.length !== 1) throw conflict("A unique readable matter card is required.");
  const card = readBounded(safePath(matterRoot, cards[0]!), 128 * 1024);
  if (!/^jurisdiction:\s*(cz|sk)\s*$/m.test(card)) throw conflict("Matter card needs an explicit CZ/SK jurisdiction.");
  const matterId = /^id:\s*([\w-]+)\s*$/m.exec(card)?.[1] ?? `matter_${fingerprint({ path, card: cards[0] }).slice(0, 32)}`;
  return { workspaceId: workspace.id, jurisdiction: /^jurisdiction:\s*(cz|sk)\s*$/m.exec(card)?.[1] === "cz" ? "cz" : "sk", matterId, matterRoot, workspaceRoot, relativePath: path, receiptScope: fingerprint({ workspaceId: workspace.id, key: workspace.appFilesStorageKey ?? null, dev: info.dev, ino: info.ino, matterDev: matterInfo.dev, matterIno: matterInfo.ino, matterId }), workspaceStorageKey: workspace.appFilesStorageKey, workspaceRootGeneration: fingerprint({ workspaceId: workspace.id, workspaceRoot, key: workspace.appFilesStorageKey ?? null, dev: info.dev, ino: info.ino, matterRoot, matterDev: matterInfo.dev, matterIno: matterInfo.ino, cardHash: sha256(card) }) };
}
export async function resolveMatterBinding(workspace: WorkspaceInfo, path: string): Promise<MatterBinding> { return resolveMatterBindingSync(workspace, path); }
export function assertMatterBinding(binding: MatterBinding): void {
  const current = resolveMatterBindingSync({ id: binding.workspaceId, path: binding.workspaceRoot, appFilesStorageKey: binding.workspaceStorageKey }, binding.relativePath);
  if (current.workspaceRootGeneration !== binding.workspaceRootGeneration || current.matterId !== binding.matterId || current.matterRoot !== binding.matterRoot) throw conflict("Workspace, matter card or filesystem identity changed.");
}
export type StoredDeadline = { text: string; recordHash: string; payload: DeadlinePayload; fingerprint: string };
export function readStoredDeadline(binding: MatterBinding, candidateId: string): StoredDeadline {
  assertMatterBinding(binding); idSchema.parse(candidateId);
  const text = readBounded(safePath(binding.matterRoot, `memory/${candidateId}.md`), 2 * 1024 * 1024), payload = parseDeadlineRecord(text);
  if (!payload || payload.revisions.at(-1)?.workspaceId !== binding.workspaceId || payload.revisions.at(-1)?.matterId !== binding.matterId) throw conflict("Deadline belongs to another matter or workspace.");
  return { text, recordHash: sha256(text), payload, fingerprint: readDeadlineEnvelope(text)!.fingerprint };
}
export function listStoredDeadlines(binding: MatterBinding): StoredDeadline[] {
  assertMatterBinding(binding);
  const memory = safePath(binding.matterRoot, "memory"); if (!existsSync(memory)) return [];
  if (!lstatSync(memory).isDirectory()) throw conflict("Matter memory is not readable.");
  const files = readdirSync(memory); if (files.length > 10000) throw conflict("Matter memory exceeds bounded local coverage.");
  const out: StoredDeadline[] = [];
  for (const name of files) {
    if (!name.endsWith(".md") || ["index.md", "log.md", "INDEX.md"].includes(name)) continue;
    const text = readBounded(safePath(binding.matterRoot, `memory/${name}`), 2 * 1024 * 1024);
    const envelope = readDeadlineEnvelope(text);
    if (envelope) { if (name !== `${envelope.id}.md`) throw conflict("Managed deadline filename does not match its identity."); out.push(readStoredDeadline(binding, envelope.id)); }
  }
  return out;
}
export function withDeadlineLock<T>(binding: MatterBinding, action: () => T): T { assertMatterBinding(binding); return withRecordWriteLock(binding.matterRoot, action); }
/** Durable replacement, full-byte CAS checked again after staging; never forced overwrite. */
export function writeDeadlineRecord(binding: MatterBinding, candidateId: string, expectedRecordHash: string | null, payload: DeadlinePayload, event: DeadlineDomainEvent, fault?: (point: string) => void): StoredDeadline {
  idSchema.parse(candidateId); const target = safePath(binding.matterRoot, `memory/${candidateId}.md`, true);
  const current = existsSync(target) ? readBounded(target, 2 * 1024 * 1024) : null;
  if ((current === null ? null : sha256(current)) !== expectedRecordHash) throw conflict("OKF bytes changed; reload the current record.");
  const bytes = encodeDeadlineRecord(current, payload, event), temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    fault?.("okf_staged");
    if ((existsSync(target) ? sha256(readBounded(target, 2 * 1024 * 1024)) : null) !== expectedRecordHash) throw conflict("External edit detected after staging; preserved the external revision.");
    renameSync(temporary, target); syncDirectory(join(binding.matterRoot, "memory")); fault?.("okf_renamed");
    return readStoredDeadline(binding, candidateId);
  } finally { rmSync(temporary, { force: true }); }
}
export function syncDirectory(path: string): void {
  if (process.platform === "win32") return; // Windows directory FlushFileBuffers is not supported; files are flushed before rename.
  const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); }
}
export function assertSourceBytes(binding: MatterBinding, payload: DeadlinePayload): void {
  const candidate = payload.revisions.at(-1)!;
  const sources = [...candidate.input.evidence, ...(candidate.input.delivery ? [candidate.input.delivery.evidence] : [])];
  for (const evidence of sources) {
    const source = safePath(binding.workspaceRoot, evidence.relativePath), rel = relative(binding.matterRoot, source);
    if (rel.startsWith(`..${sep}`) || rel === ".." || resolve(source) === binding.matterRoot) throw conflict("Evidence must belong to the selected matter.");
    const info = lstatSync(source); if (!info.isFile() || info.size > 64 * 1024 * 1024) throw conflict("Source is not a bounded file.");
    if (sha256(readFileSync(source)) !== (evidence.parentChainHashes.at(-1) ?? evidence.sha256)) throw conflict("Source bytes changed; prepare a new revision.");
  }
}
