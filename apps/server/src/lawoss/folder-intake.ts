import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { FolderIntake, IntakeCase, IntakeFile } from "@legalwork/types/folder-intake";
import { CORPUS_EXTENSIONS, extractCorpusText } from "../corpus/extract.js";
import type { DocumentPreparation } from "../document-preparation/service.js";
import { ApiError } from "../errors.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { applyFileOperations, MAX_FILE_OPERATIONS, planFileOperations } from "./file-operations.js";
import { isSensitiveWorkspacePath, resolveWorkspaceFilePath } from "./filesystem-boundary.js";
import { identifiedCases, intakeCaseKey, referencedCase, representativePassage, topicSource, topicSuggestions } from "./intake-cases.js";
import { nestedClientRoots } from "./linked-folders.js";
import { foldedPath, isPathWithin } from "./path-within.js";
import { externalAppFilesRoot } from "./workspace-app-files.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const card = /^(?:matter|spis|project|projekt)\.md$/iu;
const indexName = "PREHLAD-LAWOSS.md";
const ignored = new Set(["node_modules", "__pycache__", "$recycle.bin", "__macosx"]);
const instructions = /^(?:agents|claude|gemini)\.md$/iu;
type Entry = { stamp: string; file: IntakeFile; text: string };
type Job = { scope: string; snapshot: FolderIntake; workspace: WorkspaceInfo; controller: AbortController; done: Promise<void>; applying?: Promise<void> };

async function atomicText(path: string, value: string) {
  const temp = path + "." + randomUUID() + ".tmp";
  try { await writeFile(temp, value, { mode: 0o600, flag: "wx" }); await rename(temp, path); }
  finally { await rm(temp, { force: true }); }
}

/** Only the local host may start an intake or inspect its source inventory. */
export class FolderIntakes {
  private jobs = new Map<string, Job>();
  constructor(private config: ServerConfig, private preparation: DocumentPreparation) {}
  close() { for (const job of this.jobs.values()) job.controller.abort(); }
  private scope(workspace: WorkspaceInfo) {
    return JSON.stringify([workspace.path, workspace.appFiles, this.config.workspaces.map(w => [w.id, w.path])]);
  }
  private owned(workspace: WorkspaceInfo) {
    if (this.config.readOnly || !this.config.workspaces.some(w => w.id === workspace.id && w.path === workspace.path) ||
        ["wiki", "main-assistant"].includes(workspace.preset)) throw new ApiError(403, "intake_workspace", "Select a writable local client.");
  }
  start(workspace: WorkspaceInfo, refresh = false) {
    this.owned(workspace);
    const previous = this.jobs.get(workspace.id);
    if (previous?.scope === this.scope(workspace) && !previous.controller.signal.aborted && (previous.snapshot.state === "scanning" || previous.applying || !refresh)) return previous.snapshot;
    previous?.controller.abort();
    const snapshot: FolderIntake = { run: randomUUID(), state: "scanning", files: 0, folders: 0, indexed: 0, partial: 0, skipped: 0, sources: [], issues: [], cases: [], suggestions: [], registered: 0, outside: workspace.appFiles === "outside" };
    const job: Job = { scope: this.scope(workspace), workspace, snapshot, controller: new AbortController(), done: Promise.resolve() };
    this.jobs.set(workspace.id, job);
    job.done = this.scan(job).catch(error => {
      snapshot.state = "failed";
      snapshot.issues.push(error instanceof Error ? error.message : String(error));
    });
    return snapshot;
  }
  async settled(workspace: WorkspaceInfo) { await this.jobs.get(workspace.id)?.done; return this.start(workspace); }
  async search(workspace: WorkspaceInfo, run: string, query: string): Promise<IntakeFile[]> {
    this.owned(workspace);
    const job = this.jobs.get(workspace.id);
    if (!job || job.scope !== this.scope(workspace) || job.snapshot.run !== run || job.snapshot.state !== "ready")
      throw new ApiError(409, "intake_changed", "Refresh the folder before searching.");
    const cache = join(externalAppFilesRoot(this.config, workspace), "folder-index-v1");
    const needle = query.toLocaleLowerCase(), results: IntakeFile[] = [];
    for (const file of job.snapshot.sources) {
      if (file.path.toLocaleLowerCase().includes(needle)) { results.push(file); continue; }
      if (!file.hash) continue;
      const stored: Entry = JSON.parse(await readFile(join(cache, digest(file.path) + ".json"), "utf8"));
      const offset = stored.text.toLocaleLowerCase().indexOf(needle);
      if (offset >= 0) results.push({...file, excerpt: stored.text.slice(Math.max(0, offset - 45), offset + needle.length + 95)});
    }
    if (this.jobs.get(workspace.id) !== job || job.scope !== this.scope(workspace)) throw new ApiError(409, "intake_changed", "Refresh the folder before searching.");
    return results;
  }
  async save(workspace: WorkspaceInfo, run: string, extra: IntakeCase[] = []) {
    this.owned(workspace);
    const job = this.jobs.get(workspace.id);
    if (!job || job.scope !== this.scope(workspace) || job.snapshot.run !== run || job.snapshot.state !== "ready") throw new ApiError(409, "intake_changed", "Refresh the client before saving.");
    if (job.applying) throw new ApiError(409, "intake_busy", "A save is in progress.");
    const cases = new Map(job.snapshot.cases.map(c => [intakeCaseKey(c.title), c]));
    for (const candidate of extra) {
      if (!job.snapshot.sources.some(f => f.path === candidate.source && f.hash)) throw new ApiError(400, "intake_source", "Choose a currently indexed source.");
      cases.set(intakeCaseKey(candidate.title), candidate);
    }
    const selected = [...cases.values()];
    job.applying = this.register(job, selected);
    try { await job.applying; job.snapshot.cases = selected; job.snapshot.suggestions = job.snapshot.suggestions.filter(c => !cases.has(intakeCaseKey(c.title))); } finally { job.applying = undefined; }
    return job.snapshot;
  }
  private async register(job: Job, cases: IntakeCase[]) {
    for (let offset = 0; offset < cases.length; offset += MAX_FILE_OPERATIONS) {
      this.owned(job.workspace);
      const operations = cases.slice(offset, offset + MAX_FILE_OPERATIONS).map(c => ({ ...c, operation: "register_case" }));
      for (const source of new Set(operations.map(c => c.source))) {
        const file = job.snapshot.sources.find(f => f.path === source);
        const path = await resolveWorkspaceFilePath(job.workspace.path, source);
        const info = await lstat(path);
        if (!info.isFile() || info.nlink !== 1 || info.size > 64 * 1024 * 1024 || !file?.hash || createHash("sha256").update(await readFile(path)).digest("hex") !== file.hash)
          throw new ApiError(409, "intake_changed_source", "The source has changed. Refresh the folder before registering cases.");
      }
      const plan = await planFileOperations(this.config, job.workspace, operations);
      if (plan.operations.length) {
        const result = await applyFileOperations(this.config, job.workspace, operations, plan.operations, plan.revision, undefined, { type: "host" }, job.controller.signal);
        if (!result.complete) throw new Error("Case registration was interrupted. Refresh to retry.");
      }
      job.snapshot.registered = Math.min(offset + operations.length, cases.length);
    }
  }
  private async scan(job: Job) {
    const { workspace, snapshot, controller: { signal } } = job;
    const root = await realpath(workspace.path);
    const cache = join(externalAppFilesRoot(this.config, workspace), "folder-index-v1");
    await mkdir(cache, { recursive: true, mode: 0o700 });
    const nested = (await nestedClientRoots(this.config, workspace)).map(path => foldedPath(path));
    const recordedNames = new Set<string>();
    const titles = new Map<string, IntakeCase>();
    const generated = new Map<string, IntakeCase>();
    const existing = new Set<string>();
    const topics: NonNullable<ReturnType<typeof topicSource>>[] = [];
    const used = new Set<string>();
    const note = (path: string) => { if (snapshot.issues.length < 50) snapshot.issues.push(path); };
    const pending = [""];
    const matterRoots: string[] = [];
    while (pending.length) {
      this.owned(workspace); signal.throwIfAborted();
      if (this.scope(workspace) !== job.scope) throw new Error("Client folders changed. Refresh to retry.");
      const dir = pending.pop()!;
      const location = await resolveWorkspaceFilePath(root, dir, { allowRoot: !dir });
      if (foldedPath(location) !== foldedPath(join(root, dir)) || nested.some(n => isPathWithin(n, foldedPath(location)))) continue;
      const entries = await readdir(location, { withFileTypes: true }).catch(error => { if (!dir) throw error; note(dir); return []; });
      if (dir && entries.some(e => /^(?:klient|client)\.md$/iu.test(e.name))) continue;
      const insideCase = matterRoots.some(p => !p || dir === p || dir.startsWith(p + "/"));
      const caseDirectory = insideCase || entries.some(e => card.test(e.name));
      if (caseDirectory && !insideCase) matterRoots.push(dir);
      if (caseDirectory) existing.add(intakeCaseKey(basename(location)));
      for (const e of entries.sort((a,b) => a.name.localeCompare(b.name))) {
        signal.throwIfAborted();
        const path = dir ? dir + "/" + e.name : e.name;
        if (e.isSymbolicLink() || e.name.startsWith(".") || e.name.startsWith("~$") || ignored.has(e.name.toLowerCase()) || isSensitiveWorkspacePath(path)) continue;
        if (e.isDirectory()) { pending.push(path); snapshot.folders++; continue; }
        if (!e.isFile() || e.name === indexName) continue;
        snapshot.files++;
        const record: IntakeFile = { path, state: "unsupported" };
        if (CORPUS_EXTENSIONS.has(extname(e.name).toLowerCase())) {
          try {
            const actual = await resolveWorkspaceFilePath(root, path);
            if (actual !== join(location, e.name)) throw new Error("Changed source path.");
            const info = await lstat(actual);
            if (!info.isFile() || info.nlink !== 1) throw new Error("Source is not a regular single-link file.");
            const stamp = [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join("/");
            const name = digest(path) + ".json";
            let entry: Entry | undefined;
            try { entry = JSON.parse(await readFile(join(cache, name), "utf8")) as Entry; } catch { /* Missing or interrupted cache is rebuilt. */ }
            if (entry?.stamp !== stamp || entry.file.state !== "indexed") {
              const result = await extractCorpusText(root, path, this.preparation, signal, { scans: "native-only" });
              const file: IntakeFile = { path, state: result.complete ? "indexed" : result.text ? "partial" : "unreadable", hash: result.hash, excerpt: representativePassage(result.text) };
              entry = { stamp, file, text: result.text };
              await atomicText(join(cache, name), JSON.stringify(entry));
            }
            used.add(name);
            Object.assign(record, entry.file);
            if (card.test(e.name)) {
              const title = entry.text.match(/^title:\s*(.+)$/im)?.[1]?.replace(/^["']|["']$/gu, "");
              if (title) {
                const key = intakeCaseKey(title);
                recordedNames.add(key);
                if (/^registration_id:/m.test(entry.text)) {
                  const field = (name: string): string | undefined => {
                    const value = entry.text.split("\n").find(line => line.startsWith(name + ": "))?.slice(name.length + 2);
                    try { const parsed: unknown = JSON.parse(value ?? "null"); return typeof parsed === "string" ? parsed : undefined; } catch { return undefined; }
                  };
                  const source = field("source");
                  if (source) generated.set(key, {title: field("title") ?? title, source, phase: field("phase"), next_step: field("next_step")});
                } else existing.add(key);
              }
            } else if (!caseDirectory && !instructions.test(e.name)) {
              const explicit = identifiedCases(entry.text, path);
              const ref = !explicit.length && referencedCase(entry.text, path);
              if (ref) explicit.push(ref);
              if (!explicit.length) { const topic = topicSource(path, entry.text); if (topic) topics.push(topic); }
              for (const c of explicit) if (!titles.has(intakeCaseKey(c.title))) titles.set(intakeCaseKey(c.title), c);
            }
          } catch { signal.throwIfAborted(); record.state = "unreadable"; note(path); }
        }
        if (record.state === "indexed") snapshot.indexed++;
        else if (record.state === "partial") snapshot.partial++;
        else snapshot.skipped++;
        snapshot.sources.push(record);
      }
    }
    const indexed = new Set(snapshot.sources.filter(f => f.hash).map(f => f.path));
    for (const [key, record] of generated) if (!titles.has(key) && indexed.has(record.source)) titles.set(key, record);
    snapshot.registered = [...generated.keys()].filter(key => titles.has(key)).length;
    snapshot.cases = [...titles].filter(([key]) => !existing.has(key)).map(([, value]) => value);
    snapshot.suggestions = topicSuggestions(topics).filter(c => !titles.has(intakeCaseKey(c.title)) && !recordedNames.has(intakeCaseKey(c.title)));
    for (const file of await readdir(cache)) if (/^[a-f0-9]{64}\.json$/u.test(file) && !used.has(file)) await rm(join(cache, file), { force: true });
    this.owned(workspace); signal.throwIfAborted();
    const overview = ["# " + workspace.name, "", ...snapshot.cases.map(c => "- " + c.title + " (" + c.source + ")"), "", ...snapshot.sources.map(f => "- " + f.path + (f.excerpt ? ": " + f.excerpt : "")), ""].join("\n");
    await atomicText(join(cache, indexName), overview);
    if (!snapshot.outside) await this.register(job, snapshot.cases);
    snapshot.state = "ready";
  }
}
