import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import { CORPUS_EXTENSIONS, extractCorpusText, type CorpusAttachment } from "../../corpus/extract.js";
import type { DocumentPreparation } from "../../document-preparation/service.js";
import { within } from "../../reviews/storage.js";
import type { ServerConfig, WorkspaceInfo } from "../../types.js";
import { workspaceAppFilesRoot } from "../workspace-app-files.js";
import { DOCUMENT_LIMITS as LIMIT, documentRecordSchema, type DocumentEvidence, type DocumentRead, type DocumentRecord, type DocumentSummary } from "./types.js";

const outputRecordSchema = z.object({ sourceKind:z.enum(["isir","workspace"]), identityPath:z.string().nullable(), identityHash:z.string().nullable(), documentIds:z.array(z.string().uuid()).min(1).max(20), owned:z.boolean(), workspaceId:z.string(), path:z.string(), hash:z.string().regex(/^[a-f0-9]{64}$/), sourceHash:z.string(), verifiedHash:z.string().nullable(), kind:z.enum(["registry","summary"]), outputLanguage:z.enum(["cs","sk","en"]), verified:z.literal(false), legalApproval:z.literal(false), identity:z.object({caseNumber:z.string().nullable(),company:z.string().nullable(),sourceUrl:z.string().nullable(),project:z.string()}) });
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const summary = ({ pages, ...record }: DocumentRecord): DocumentSummary => ({ ...record, pageCount: new Set(pages.map(page => page.page).filter(page => page !== null)).size || (pages.length ? 1 : 0), readablePages: new Set(pages.filter(page => page.status === "complete").map(page => page.page)).size });
function originalRecord(records: DocumentRecord[], record: DocumentRecord): DocumentRecord {
  const seen = new Set<string>();
  while (record.provenance.parentId) {
    if (seen.has(record.id)) throw new Error("Cyclic document provenance."); seen.add(record.id);
    const parent = records.find(item => item.id === record.provenance.parentId);
    if (!parent) throw new Error("Document provenance is missing."); record = parent;
  }
  return record;
}
/** One serialized worker bounds PDF rendering, OCR and portfolio expansion across workspaces. */
export class LawossDocuments {
  private pending: Promise<unknown> = Promise.resolve();
  private mutations: Promise<unknown> = Promise.resolve();
  private active = new Map<string, { controller: AbortController; done: Promise<unknown>; workspaceId: string; bytes: number }>();
  private stopped = false;
  constructor(private readonly config: Pick<ServerConfig, "configPath">, private readonly preparation: DocumentPreparation) {}
  private lock<T>(action: () => Promise<T>): Promise<T> {
    const result = this.mutations.then(action); this.mutations = result.catch(() => {}); return result;
  }
  private async directory(workspace: WorkspaceInfo) {
    const base = workspaceAppFilesRoot(this.config, workspace);
    // Reject existing symlinks before creating or reading app-owned storage.
    let directory = resolve(base);
    if (workspace.appFiles === "outside") await mkdir(directory, { recursive: true });
    directory = await realpath(directory);
    for (const segment of [".legalwork", "lawoss-documents"]) {
      directory = join(directory, segment);
      try { const entry = await lstat(directory); if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error("Document storage is not a directory."); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; await mkdir(directory); }
    }
    return directory;
  }
  private async records(workspace: WorkspaceInfo): Promise<DocumentRecord[]> {
    const file = join(await this.directory(workspace), "records.json");
    try {
      const info = await lstat(file); if (info.isSymbolicLink() || info.size > 128 * 1024 * 1024) throw new Error("Invalid document storage.");
      const records = z.array(documentRecordSchema).max(LIMIT.records).parse(JSON.parse(await readFile(file, "utf8")));
      if (records.some(record => record.workspaceId !== workspace.id)) throw new Error("Document storage belongs to another workspace.");
      return records;
    } catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error; }
  }
  private async save(workspace: WorkspaceInfo, records: DocumentRecord[]) {
    const directory = await this.directory(workspace), temp = join(directory, `${randomUUID()}.tmp`);
    const bytes = JSON.stringify(records);
    if (Buffer.byteLength(bytes) > 128 * 1024 * 1024) throw new Error("Document storage limit reached.");
    await writeFile(temp, bytes, { flag: "wx", mode: 0o600 }); await rename(temp, join(directory, "records.json"));
  }
  private async source(workspace: WorkspaceInfo, path: string, availableBytes = LIMIT.bytes) {
    const root = await realpath(workspace.path), requested = resolve(root, path);
    if (!within(root, requested)) throw new ApiError(403, "document_path", "Document is outside this workspace.");
    const absolute = await realpath(requested);
    if (!within(root, absolute)) throw new ApiError(403, "document_path", "Document is outside this workspace.");
    const info = await stat(absolute);
    if (!info.isFile() || info.size > LIMIT.bytes) throw new ApiError(400, "document_size", "Document exceeds 64 MiB.");
    if (info.size > availableBytes) throw new ApiError(429, "document_queue_bytes", "Queued documents exceed 128 MiB; narrow the batch.");
    const bytes = await readFile(absolute);
    if (bytes.length > availableBytes) throw new ApiError(429, "document_queue_bytes", "Queued documents exceed 128 MiB; narrow the batch.");
    if (bytes.length > LIMIT.bytes) throw new Error("Document exceeds 64 MiB.");
    return { path: relative(root, requested).replaceAll("\\", "/"), bytes, hash: hash(bytes), extension: extname(absolute).toLowerCase() };
  }
  async list(workspace: WorkspaceInfo): Promise<DocumentSummary[]> {
    return this.lock(async () => {
      const records = await this.records(workspace); let changed = false;
      for (const record of records) if (["uploaded", "preparing"].includes(record.status) && !this.active.has(originalRecord(records, record).id)) {
        record.status = record.pages.length ? "partial" : "failed"; record.complete = false; record.issue = "Preparation interrupted; retry the original source."; changed = true;
      }
      if (changed) {
        const directory = await this.directory(workspace);
        for (const record of records) if (!record.provenance.parentId && !this.active.has(record.id)) await rm(join(directory, `scratch-${record.id}`), { recursive: true, force: true });
        await this.save(workspace, records);
      }
      return records.map(record => this.active.has(originalRecord(records, record).id) ? { ...summary(record), status: "preparing", complete: false } : summary(record));
    });
  }
  async prepare(workspace: WorkspaceInfo, paths: string[]): Promise<DocumentSummary[]> {
    await this.list(workspace);
    return this.lock(async () => {
      if (this.stopped) throw new ApiError(503, "documents_stopped", "Document preparation is stopping.");
      const inputs = z.array(z.string().min(1).max(4096)).min(1).max(LIMIT.sources).parse(paths);
      if (this.active.size + inputs.length > LIMIT.active) throw new ApiError(429, "document_limit", "Wait for current preparations.");
      let available = LIMIT.queuedBytes - [...this.active.values()].reduce((sum, job) => sum + job.bytes, 0);
      const sources: Array<Awaited<ReturnType<LawossDocuments["source"]>>> = [];
      for (const path of inputs) { const source = await this.source(workspace, path, Math.min(LIMIT.bytes, available)); sources.push(source); available -= source.bytes.length; }
      const records = await this.records(workspace), result: DocumentSummary[] = [];
      const launches: Array<{ id: string; source: Awaited<ReturnType<LawossDocuments["source"]>> }> = [];
      const plannedIds = new Set<string>();
      // Admission, not asynchronous extraction updates, selects the current
      // original. Advance past legacy timestamps and ties under a coarse clock.
      let admittedAt = records.filter(record => !record.provenance.parentId).reduce((latest, record) => Math.max(latest, record.admittedAt ?? record.updatedAt), Date.now());
      // Plan against the final record set, before persisting or launching work.
      // Reuse consumes no slot; retries free their old attachment descendants.
      for (const source of sources) {
        let record = records.find(record => !record.provenance.parentId && record.path === source.path && record.hash === source.hash);
        if (record) record.admittedAt = ++admittedAt;
        if (record && (this.active.has(record.id) || record.status === "readable" || plannedIds.has(record.id))) { result.push(summary(record)); continue; }
        if (record) {
          const descendants = new Set([record.id]);
          for (const item of records) if (item.provenance.parentId && descendants.has(item.provenance.parentId)) descendants.add(item.id);
          for (let i = records.length - 1; i >= 0; i--) if (descendants.has(records[i].id) && records[i].id !== record.id) records.splice(i, 1);
          record.pages = []; record.issue = undefined; record.extraction = undefined; record.complete = false; record.status = "uploaded";
        } else {
          record = { id: randomUUID(), workspaceId: workspace.id, path: source.path, hash: source.hash, status: "uploaded", pages: [], complete: false, updatedAt: Date.now(), admittedAt: ++admittedAt, provenance: { sourcePath: source.path, depth: 0 } }; records.push(record);
        }
        launches.push({ id: record.id, source }); plannedIds.add(record.id); result.push(summary(record));
      }
      if (records.length > LIMIT.records) throw new ApiError(429, "document_limit", "Document storage record limit reached.");
      await this.save(workspace, records);
      for (const { id, source } of launches) {
        const controller = new AbortController();
        const done = this.pending.then(() => this.run(workspace, id, source, controller.signal)).catch(() => {}).finally(() => this.active.delete(id));
        this.pending = done; this.active.set(id, { controller, done, workspaceId: workspace.id, bytes: source.bytes.length });
      }
      return result;
    });
  }
  private async update(workspace: WorkspaceInfo, id: string, update: Partial<DocumentRecord>) {
    await this.lock(async () => { const records = await this.records(workspace), record = records.find(record => record.id === id); if (!record) throw new Error("Document no longer exists."); Object.assign(record, update, { updatedAt: Date.now() }); await this.save(workspace, records); });
  }
  private async run(workspace: WorkspaceInfo, id: string, source: Awaited<ReturnType<LawossDocuments["source"]>>, signal: AbortSignal) {
    let scratch: string | undefined;
    try {
      signal.throwIfAborted(); await this.update(workspace, id, { status: "preparing" });
      const directory = await this.directory(workspace);
      scratch = join(directory, `scratch-${id}`); await mkdir(scratch, { mode: 0o700 });
      const record = (await this.lock(() => this.records(workspace))).find(record => record.id === id)!;
      const budget = { count: 0, bytes: 0, text: 0 };
      const complete = await this.extract(workspace, record, source.bytes, source.extension, scratch, signal, budget, new Set());
      const current = await this.source(workspace, source.path);
      if (current.hash !== source.hash) throw new Error("Source changed during preparation; retry.");
      signal.throwIfAborted();
      const final = (await this.lock(() => this.records(workspace))).find(item => item.id === id)!;
      await this.update(workspace, id, { status: complete ? "readable" : final.pages.some(page => page.text.trim()) ? "partial" : "failed", complete });
    } catch (error) {
      await this.lock(async () => {
        const records = await this.records(workspace), descendants = new Set([id]);
        for (const record of records) if (record.provenance.parentId && descendants.has(record.provenance.parentId)) descendants.add(record.id);
        for (const record of records) if (descendants.has(record.id)) { record.status = "failed"; record.complete = false; record.pages = []; record.issue = signal.aborted ? "Preparation cancelled or interrupted; retry the original source." : error instanceof Error ? error.message : "Preparation failed."; }
        await this.save(workspace, records);
      });
    } finally { if (scratch) await rm(scratch, { recursive: true, force: true }); }
  }
  private async extract(workspace: WorkspaceInfo, record: DocumentRecord, bytes: Uint8Array, extension: string, scratch: string, signal: AbortSignal, budget: { count: number; bytes: number; text: number }, ancestors: Set<string>): Promise<boolean> {
    signal.throwIfAborted();
    if (ancestors.has(record.hash)) { await this.update(workspace, record.id, { status: "failed", issue: "Cyclic attachment content.", complete: false }); return false; }
    const seen = new Set(ancestors); seen.add(record.hash);
    if (!CORPUS_EXTENSIONS.has(extension)) { await this.update(workspace, record.id, { status: "failed", issue: "Unsupported attachment or document format.", complete: false }); return false; }
    const file = `${record.id}${extension}`; await writeFile(join(scratch, file), bytes, { flag: "wx", mode: 0o600 });
    let result;
    try { result = await extractCorpusText(scratch, file, this.preparation, signal, { retry: true, attachments: true }); }
    catch (error) { signal.throwIfAborted(); await this.update(workspace, record.id, { status: "failed", issue: error instanceof Error ? error.message : "Extraction failed.", complete: false }); return false; }
    budget.text += result.text.length;
    if (budget.text > LIMIT.text) {
      await this.update(workspace, record.id, { status: "failed", complete: false, issue: "Portfolio text exceeds 2 million characters; narrow the source." }); return false;
    }
    let complete = result.attachments ? !!result.text.trim() && result.pages.every(page => page.status === "complete") : result.complete;
    let issue = result.attachments?.length && complete ? undefined : result.issue;
    await this.update(workspace, record.id, { pages: result.pages.map(({ page, text, source, status }) => ({ page, text, source, status })), extraction: result.extraction });
    if (extension === ".pdf" || result.attachments) {
      try {
        const { inspectPdfAttachments } = await import("../../document-preparation/render.js");
        const attachments: CorpusAttachment[] = result.attachments ?? await inspectPdfAttachments(bytes, signal, { count: LIMIT.attachments - budget.count, bytes: LIMIT.attachmentBytes - budget.bytes });
        if (attachments.length > LIMIT.attachments - budget.count) throw new Error("Document attachment count exceeds the tree limit.");
        if (attachments.reduce((sum, attachment) => sum + attachment.bytes.length, 0) > LIMIT.attachmentBytes - budget.bytes) throw new Error("Document attachment bytes exceed the tree limit.");
        // Reserve all immediate siblings before recursion. A nested subtree
        // must not spend bytes/count already needed by later siblings.
        budget.count += attachments.length;
        budget.bytes += attachments.reduce((sum, attachment) => sum + attachment.bytes.length, 0);
        for (const attachment of attachments) {
          signal.throwIfAborted();
          if (record.provenance.depth >= LIMIT.depth) throw new Error("Document attachment nesting exceeds 3 levels.");
          const child: DocumentRecord = { id: randomUUID(), workspaceId: workspace.id, path: record.path, hash: hash(attachment.bytes), status: "preparing", pages: [], complete: false, updatedAt: Date.now(), provenance: { sourcePath: record.provenance.sourcePath, parentId: record.id, parentHash: record.hash, attachmentName: attachment.name.slice(0, 4096), depth: record.provenance.depth + 1 } };
          await this.lock(async () => { const records = await this.records(workspace); if (records.length >= LIMIT.records) throw new Error("Document record limit reached."); records.push(child); await this.save(workspace, records); });
          if (!await this.extract(workspace, child, attachment.bytes, attachment.extension ?? extname(attachment.name).toLowerCase(), scratch, signal, budget, seen)) { complete = false; issue = "Some document attachments are unreadable or incomplete."; }
        }
      } catch (error) { signal.throwIfAborted(); complete = false; issue = error instanceof Error ? error.message : "Portfolio discovery failed."; }
    }
    signal.throwIfAborted();
    await this.update(workspace, record.id, { status: record.provenance.depth === 0 ? "preparing" : complete ? "readable" : result.text.trim() ? "partial" : "failed", complete: record.provenance.depth === 0 ? false : complete, issue }); return complete;
  }
  async read(workspace: WorkspaceInfo, id: string, offset = 0, limit = LIMIT.read): Promise<DocumentRead> {
    z.string().uuid().parse(id); z.number().int().nonnegative().parse(offset); z.number().int().min(1).max(LIMIT.read).parse(limit);
    await this.list(workspace);
    const record = await this.lock(async () => (await this.records(workspace)).find(record => record.id === id));
    if (!record) throw new ApiError(404, "document_missing", "Document record not found.");
    const source = await this.source(workspace, record.provenance.sourcePath);
    // All descendants are tied to the top-level source; check the ancestor chain.
    const records = await this.lock(() => this.records(workspace)), ancestor = originalRecord(records, record);
    if (this.active.has(ancestor.id)) throw new ApiError(409, "document_pending", "Preparation is not finished.");
    if (source.hash !== ancestor.hash) throw new ApiError(409, "document_stale", "Source has changed; prepare it again.");
    if (["uploaded", "preparing"].includes(record.status)) throw new ApiError(409, "document_pending", "Preparation is not finished.");
    const text = record.pages.map(page => page.text).join("\n\n"), end = Math.min(text.length, offset + limit);
    if (offset > text.length) throw new ApiError(400, "document_offset", "Offset exceeds document text.");
    let start = 0; const pages: DocumentRecord["pages"] = [];
    for (const page of record.pages) { const pageEnd = start + page.text.length; if (pageEnd > offset && start < end) pages.push({ ...page, text: page.text.slice(Math.max(0, offset - start), Math.min(page.text.length, end - start)) }); start = pageEnd + 2; }
    return { ...summary(record), text: text.slice(offset, end), pages, offset, nextOffset: end < text.length ? end : null, untrusted: true };
  }
  async evidence(workspace:WorkspaceInfo,id:string):Promise<DocumentEvidence> {
    const fresh=await this.read(workspace,id);
    const record=await this.lock(async()=>(await this.records(workspace)).find(item=>item.id===id));
    if(!record || record.hash!==fresh.hash || record.updatedAt!==fresh.updatedAt) throw new ApiError(409,"document_stale","Evidence changed during inspection.");
    return {...summary(record),pages:record.pages.map(({text,...page})=>page)};
  }
  async cancel(workspace: WorkspaceInfo, id: string) {
    const job = this.active.get(id); if (!job || job.workspaceId !== workspace.id) throw new ApiError(404, "document_job", "Active document preparation not found.");
    job.controller.abort(); await job.done; return { id, cancelled: true };
  }
  async outputRecords(workspace: WorkspaceInfo) {
    return this.lock(async () => {
      await realpath(workspace.path);
      const file = join(await this.directory(workspace), "outputs.json");
      try {
        const info = await lstat(file); if (info.isSymbolicLink() || info.size > 4 * 1024 * 1024) throw new Error("Invalid output storage.");
        const records=z.array(outputRecordSchema).max(500).parse(JSON.parse(await readFile(file, "utf8")));
        if(records.some(record=>record.workspaceId!==workspace.id)) throw new Error("Output storage belongs to another workspace.");
        return records;
      } catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error; }
    });
  }
  async outputRecord(workspace:WorkspaceInfo,path:string) { return (await this.outputRecords(workspace)).find(record=>record.path===path); }
  async saveOutputRecord(workspace: WorkspaceInfo, input: Omit<z.infer<typeof outputRecordSchema>, "workspaceId">) {
    // The caller has already resolved the existing workspace root; never recreate a moved root.
    await realpath(workspace.path);
    return this.lock(async () => {
      const directory = await this.directory(workspace), file = join(directory, "outputs.json");
      let records: z.infer<typeof outputRecordSchema>[] = [];
      try { const info = await lstat(file); if (info.isSymbolicLink() || info.size > 4 * 1024 * 1024) throw new Error("Invalid output storage."); records = z.array(outputRecordSchema).max(500).parse(JSON.parse(await readFile(file,"utf8"))); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
      const record = outputRecordSchema.parse({ ...input, workspaceId: workspace.id });
      records = records.filter(item => !(item.workspaceId === workspace.id && item.path === input.path)); records.push(record);
      if (records.length > 500) throw new Error("Output record limit reached.");
      const bytes=JSON.stringify(records); if(Buffer.byteLength(bytes)>4*1024*1024) throw new Error("Output metadata exceeds 4 MiB.");
      const temp = join(directory, `${randomUUID()}.tmp`);
      try { await writeFile(temp, bytes, {flag:"wx",mode:0o600}); await rename(temp,file); } finally { await rm(temp,{force:true}); }
    });
  }
  async stop() { this.stopped = true; for (const job of this.active.values()) job.controller.abort(); await Promise.all([...this.active.values()].map(job => job.done)); }
}
