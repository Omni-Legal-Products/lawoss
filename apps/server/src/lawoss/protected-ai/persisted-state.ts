import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ApiError } from "../../errors.js";

export const MAX_PROTECTED_CHECKPOINT = 16 * 1024 * 1024;
const MAX_HISTORY_JSON = 16 * 1024 * 1024;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const recordSchema = z.record(z.string(), z.unknown());
const inputSchema = z.strictObject({ workspaceId: z.string().min(1).max(256), caseDirectory: z.string().max(4096), providerId: z.string().min(1).max(128), modelId: z.string().min(1).max(200), profileId: z.string().min(1).max(128).optional(), sources: z.array(z.strictObject({ id: z.string().uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(500) });
const captureSchema = z.strictObject({ version: z.literal(1), workspaceId: z.string().min(1).max(256), sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/), operationId: z.string().uuid(), input: inputSchema,
  rootIdentity: z.string().min(1), sourceSetSha256: z.string().regex(/^[a-f0-9]{64}$/), hostDirectory: z.string().min(1).max(4096), workspaceRoot: z.string().min(1).max(4096), guestDirectory: z.literal("/tmp/home/protected-engine/workspace"), capturedAt: z.iso.datetime(),
  session: recordSchema, messages: z.array(recordSchema).max(10000), children: z.array(z.unknown()).max(1000), todo: z.array(z.unknown()).max(10000), statuses: recordSchema });
const savedSchema = captureSchema.extend({ checkpoint: z.strictObject({ file: z.string().regex(/^[a-f0-9]{64}-[a-f0-9-]{36}\.sqlite$/), sha256: z.string().regex(/^[a-f0-9]{64}$/), size: z.number().int().positive().max(MAX_PROTECTED_CHECKPOINT) }) });
export type ProtectedSessionCapture = z.infer<typeof captureSchema>;
export type StoredProtectedSession = ProtectedSessionCapture & { checkpoint: { path: string; sha256: string; size: number } };
const invalid = () => new ApiError(409, "protected_history_invalid", "The private protected-session history requires explicit recovery; no model transfer was authorized.");
async function boundedFile(path: string, maximum: number): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maximum) throw invalid();
  const bytes = await readFile(path); if (bytes.length !== info.size || bytes.length > maximum) throw invalid(); return bytes;
}
function sqlite(bytes: Uint8Array) { if (bytes.length < 100 || bytes.length > MAX_PROTECTED_CHECKPOINT || Buffer.from(bytes.subarray(0, 16)).toString("ascii") !== "SQLite format 3\0") throw invalid(); }
async function exclusiveWrite(path: string, bytes: Uint8Array) { const file = await open(path, "wx", 0o600); try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); } }

/** Host-private captured engine data, never portable policy or an approval receipt. */
export class ProtectedSessionStore {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly directory: string) {}
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const work = this.pending.then(operation); this.pending = work.then(() => {}, () => {}); return work;
  }
  private async ensureDirectory() { await mkdir(this.directory, { recursive: true, mode: 0o700 }); const info = await lstat(this.directory); if (!info.isDirectory() || info.isSymbolicLink()) throw invalid(); }
  save(capture: ProtectedSessionCapture, checkpoint: Uint8Array): Promise<StoredProtectedSession> {
    const key = digest(Buffer.from(JSON.stringify([capture.workspaceId, capture.sessionId])));
    return this.serial(() => this.saveOwned(key, capture, checkpoint));
  }
  private async saveOwned(key: string, input: ProtectedSessionCapture, bytes: Uint8Array): Promise<StoredProtectedSession> {
    const capture = captureSchema.parse(input); sqlite(bytes);
    if (capture.workspaceId !== capture.input.workspaceId || capture.session.id !== capture.sessionId || capture.session.directory !== capture.guestDirectory) throw invalid();
    await this.ensureDirectory();
    const file = `${key}-${randomUUID()}.sqlite`, target = join(this.directory, `${key}.json`), temporary = join(this.directory, `.${key}-${randomUUID()}.tmp`);
    const checkpoint = { file, sha256: digest(bytes), size: bytes.byteLength };
    const encoded = Buffer.from(JSON.stringify({ ...capture, checkpoint })); if (encoded.byteLength > MAX_HISTORY_JSON) throw invalid();
    let previous: z.infer<typeof savedSchema> | undefined;
    try { previous = savedSchema.parse(JSON.parse((await boundedFile(target, MAX_HISTORY_JSON)).toString("utf8"))); } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    try {
      await exclusiveWrite(join(this.directory, file), bytes); await exclusiveWrite(temporary, encoded); await rename(temporary, target);
    } catch (error) { await rm(temporary, { force: true }); await rm(join(this.directory, file), { force: true }); throw error; }
    if (previous && previous.checkpoint.file !== file) await rm(join(this.directory, previous.checkpoint.file), { force: true });
    return { ...capture, checkpoint: { path: join(this.directory, file), sha256: checkpoint.sha256, size: checkpoint.size } };
  }
  load(): Promise<StoredProtectedSession[]> { return this.serial(() => this.loadOwned()); }
  read(workspaceId: string, sessionId: string): Promise<StoredProtectedSession | undefined> {
    return this.serial(async () => {
      await this.ensureDirectory();
      const name = `${digest(Buffer.from(JSON.stringify([workspaceId, sessionId])))}.json`;
      try { await lstat(join(this.directory, name)); } catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined; throw error; }
      return this.readOwned(name);
    });
  }
  private async loadOwned(): Promise<StoredProtectedSession[]> {
    await this.ensureDirectory();
    const names = (await readdir(this.directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)); if (names.length > 1000) throw invalid();
    const result: StoredProtectedSession[] = [];
    for (const name of names) result.push(await this.readOwned(name));
    return result;
  }
  private async readOwned(name: string): Promise<StoredProtectedSession> {
    try {
        const value = savedSchema.parse(JSON.parse((await boundedFile(join(this.directory, name), MAX_HISTORY_JSON)).toString("utf8")));
        if (name !== `${digest(Buffer.from(JSON.stringify([value.workspaceId, value.sessionId])))}.json` || value.input.workspaceId !== value.workspaceId || value.session.id !== value.sessionId || value.session.directory !== value.guestDirectory || !value.checkpoint.file.startsWith(name.slice(0, -5) + "-")) throw invalid();
        const checkpoint = await boundedFile(join(this.directory, value.checkpoint.file), MAX_PROTECTED_CHECKPOINT); sqlite(checkpoint);
        if (checkpoint.length !== value.checkpoint.size || digest(checkpoint) !== value.checkpoint.sha256) throw invalid();
        return { ...value, checkpoint: { path: join(this.directory, value.checkpoint.file), sha256: value.checkpoint.sha256, size: value.checkpoint.size } };
    } catch { throw invalid(); }
  }
}
