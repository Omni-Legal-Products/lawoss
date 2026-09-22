import { randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkedPath, isHash, isObject, jsonText, message, readText, safeId, sha256 } from "./workspace-memory-fs.ts";
import { readWorkspaceMemory, readWorkspaceMemorySnapshot } from "./workspace-memory-reader.ts";
import { WORKSPACE_MEMORY_LIMITS } from "./workspace-memory-types.ts";
import type { WorkspaceMemoryReport, WorkspaceMemorySaveOptions, WorkspaceMemorySaveReport, WorkspaceMemorySaveRequest, WorkspaceMemorySource, WorkspaceMemoryUpdate } from "./workspace-memory-types.ts";

class Conflict extends Error {}
function validateRequest(request: WorkspaceMemorySaveRequest): void {
  if (!isObject(request) || request.version !== 1 || !safeId(request.matterId) || !safeId(request.operationId) || typeof request.reason !== "string" || !request.reason.trim() || request.reason.length > 4096 || !isHash(request.expectedBindingHash) || !isHash(request.expectedContextHash) || !Array.isArray(request.updates) || request.updates.length > WORKSPACE_MEMORY_LIMITS.sources) throw new Error("Invalid workspace save request.");
  const seen = new Set<string>(); let total = 0;
  for (const update of request.updates) {
    if (!isObject(update) || !safeId(update.sourceId) || seen.has(update.sourceId) || !isHash(update.expectedSha256) || typeof update.content !== "string" || Buffer.from(update.content, "utf8").toString("utf8") !== update.content) throw new Error("Invalid or duplicate source update (text must be valid Unicode).");
    const bytes = Buffer.byteLength(update.content); total += bytes;
    if (bytes > WORKSPACE_MEMORY_LIMITS.sourceBytes || total > WORKSPACE_MEMORY_LIMITS.totalBytes) throw new Error("Update byte limit exceeded.");
    seen.add(update.sourceId);
  }
}
function fingerprint(request: WorkspaceMemorySaveRequest): string {
  return sha256(JSON.stringify({ version: request.version, matterId: request.matterId, operationId: request.operationId, reason: request.reason, expectedBindingHash: request.expectedBindingHash, expectedContextHash: request.expectedContextHash, updates: [...request.updates].sort((a, b) => a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0).map(u => ({ sourceId: u.sourceId, expectedSha256: u.expectedSha256, content: u.content })) }));
}
function requireComplete(report: WorkspaceMemoryReport): void {
  if (!report.present || !report.complete) throw new Conflict(`Complete workspace snapshot required: ${report.problems.map(p => p.message).join("; ") || "profile absent"}`);
}
function frontmatter(content: string): string {
  if (!/^(?:\uFEFF)?---(?:\r\n|\n)/.test(content)) return "";
  const match = /^(?:\uFEFF)?---(?:\r\n|\n)[\s\S]*?^(?:---|\.\.\.)(?:\r\n|\n|$)/m.exec(content);
  if (!match) throw new Conflict("Existing YAML frontmatter is unterminated; preserve and repair it explicitly first.");
  return match[0];
}
function validateSnapshot(report: WorkspaceMemoryReport, request: WorkspaceMemorySaveRequest): void {
  requireComplete(report);
  if (report.matterId !== request.matterId || report.bindingHash !== request.expectedBindingHash) throw new Conflict("Matter/profile/grants binding changed.");
  if (report.contextHash !== request.expectedContextHash) throw new Conflict("Context changed; reload all sources before saving.");
  const writable = report.sources.filter(s => s.writable);
  if (!writable.length || writable.length !== request.updates.length || writable.some(s => !request.updates.some(u => u.sourceId === s.id))) throw new Conflict("Updates must cover every writable source exactly once.");
  let total = 0;
  for (const source of report.sources) {
    const update = request.updates.find(u => u.sourceId === source.id);
    total += update ? Buffer.byteLength(update.content) : source.bytes;
    if (!update) continue;
    if (source.sha256 !== update.expectedSha256 || source.content === null) throw new Conflict(`Stale source: ${source.id}`);
    if (source.role === "task_log") { if (!update.content.startsWith(source.content)) throw new Conflict(`Task log ${source.id} is append-only.`); }
    else { const yaml = frontmatter(source.content); if (yaml && !update.content.startsWith(yaml)) throw new Conflict(`Existing frontmatter bytes must be preserved: ${source.id}`); }
    if (source.anchors.some(a => !update.content.includes(a))) throw new Conflict(`Update removes identity anchor: ${source.id}`);
  }
  if (total > WORKSPACE_MEMORY_LIMITS.totalBytes) throw new Conflict("Updated context exceeds total byte limit.");
}
function createPrivate(path: string, content: string, mode = 0o600): void {
  checkedPath(dirname(path), "directory");
  const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, mode);
  try { writeFileSync(fd, content, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
}
function privateDirectory(path: string): void {
  checkedPath(dirname(path), "directory");
  if (!checkedPath(path, "directory", true)) mkdirSync(path, { mode: 0o700 });
  checkedPath(path, "directory"); chmodSync(path, 0o700);
}
function writeJournal(operationPath: string, journal: unknown): void {
  const temp = join(operationPath, `journal-${randomUUID()}.tmp`);
  const content = JSON.stringify(journal, null, 2) + "\n";
  if (Buffer.byteLength(content) > WORKSPACE_MEMORY_LIMITS.journalBytes) throw new Error("Journal byte limit exceeded.");
  createPrivate(temp, content);
  checkedPath(operationPath, "directory");
  const path = join(operationPath, "journal.json"); checkedPath(path, "file", true);
  renameSync(temp, path);
}
interface Replacement { source: WorkspaceMemorySource; update: WorkspaceMemoryUpdate; newHash: string; stage: string; mode: number }

/** Preview is the default; apply is a journaled, cooperative CAS operation, not an OS-wide transaction. */
export function saveWorkspaceMemory(directory: string, request: WorkspaceMemorySaveRequest, options: WorkspaceMemorySaveOptions = {}): WorkspaceMemorySaveReport {
  const result: WorkspaceMemorySaveReport = { status: "error", operationId: null, fingerprint: null, problems: [], changes: [], historyPath: null, rollback: "not-needed" };
  let lockFd: number | undefined, lockPath = "", operationPath = "", prepared = false;
  const replacements: Replacement[] = [], installed: Replacement[] = [];
  let journal: Record<string, unknown> = {};
  try {
    validateRequest(request); result.operationId = request.operationId; result.fingerprint = fingerprint(request);
    const initial = readWorkspaceMemory(directory, options); requireComplete(initial);
    if (initial.matterId !== request.matterId || initial.bindingHash !== request.expectedBindingHash) throw new Conflict("Matter/profile/grants binding changed.");
    const history = join(initial.directory, ".lawoss", "memory-history"); operationPath = join(history, request.operationId);
    const existing = (): boolean => {
      if (!checkedPath(operationPath, "directory", true)) return false;
      const prior = jsonText(join(operationPath, "journal.json"), WORKSPACE_MEMORY_LIMITS.journalBytes);
      if (!isObject(prior) || prior.fingerprint !== result.fingerprint) throw new Conflict("operationId was already used for a different request.");
      if (prior.status !== "committed") throw new Conflict("Prior operation did not commit; recovery or a fresh operation ID is required.");
      result.status = "already-applied"; result.historyPath = operationPath; return true;
    };
    if (existing()) return result;
    validateSnapshot(initial, request);
    result.changes = request.updates.map(update => { const source = initial.sources.find(s => s.id === update.sourceId)!; return { sourceId: source.id, path: source.path, beforeSha256: update.expectedSha256, afterSha256: sha256(update.content), bytes: Buffer.byteLength(update.content) }; });
    if (!options.apply) { result.status = "preview"; return result; }
    privateDirectory(history); lockPath = join(history, "save.lock");
    try { lockFd = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
    catch (error) { throw new Conflict(`Cannot acquire exclusive save lock: ${message(error)}`); }
    writeFileSync(lockFd, JSON.stringify({ operationId: request.operationId, pid: process.pid, fingerprint: result.fingerprint }) + "\n"); fsyncSync(lockFd);
    if (existing()) return result;
    const assertLock = () => {
      checkedPath(lockPath, "file"); const held = fstatSync(lockFd!), named = lstatSync(lockPath);
      if (held.ino !== named.ino || held.dev !== named.dev) throw new Conflict("Save lock was replaced externally.");
    };
    assertLock(); validateSnapshot(readWorkspaceMemorySnapshot(initial.directory, options, request.operationId), request);
    // mkdir is deliberately exclusive: a competing or orphan operation cannot be overwritten.
    mkdirSync(operationPath, { mode: 0o700 }); result.historyPath = operationPath;
    journal = { version: 1, operationId: request.operationId, fingerprint: result.fingerprint, matterId: request.matterId, reason: request.reason, bindingHash: initial.bindingHash, contextHash: initial.contextHash, status: "prepared", createdAt: new Date().toISOString(), changes: result.changes };
    writeJournal(operationPath, journal); prepared = true;
    for (const source of initial.sources) {
      if (source.content !== null) createPrivate(join(operationPath, `${source.id}.before`), source.content);
    }
    for (const update of request.updates) {
      const source = initial.sources.find(s => s.id === update.sourceId)!;
      const current = readText(source.path, WORKSPACE_MEMORY_LIMITS.sourceBytes);
      if (current.sha256 !== source.sha256) throw new Conflict(`Source changed before staging: ${source.id}`);
      const stage = join(dirname(source.path), `.lawoss-memory-${request.operationId}-${source.id}-${randomUUID()}.tmp`);
      const replacement = { source, update, newHash: sha256(update.content), stage, mode: current.mode };
      replacements.push(replacement); createPrivate(stage, update.content);
    }
    journal.stages = replacements.map(r => ({ sourceId: r.source.id, path: r.source.path, stage: r.stage, before: `${r.source.id}.before`, beforeSha256: r.source.sha256, afterSha256: r.newHash }));
    writeJournal(operationPath, journal);
    assertLock(); validateSnapshot(readWorkspaceMemorySnapshot(initial.directory, options, request.operationId), request);
    // Revalidate every source before each rename, accounting for our already installed versions.
    const validateCurrent = () => {
      assertLock(); const current = readWorkspaceMemorySnapshot(initial.directory, options, request.operationId); requireComplete(current);
      if (current.bindingHash !== request.expectedBindingHash) throw new Conflict("Profile or grants changed during save.");
      for (const source of current.sources) {
        const expected = installed.find(r => r.source.id === source.id)?.newHash ?? initial.sources.find(s => s.id === source.id)!.sha256;
        if (source.sha256 !== expected) throw new Conflict(`Source changed during save: ${source.id}`);
      }
    };
    for (const replacement of replacements) {
      validateCurrent(); checkedPath(replacement.stage, "file");
      if (readText(replacement.stage, WORKSPACE_MEMORY_LIMITS.sourceBytes).sha256 !== replacement.newHash) throw new Conflict("Staged content changed.");
      // Preserve source permissions; private staging and history start at 0600.
      chmodSync(replacement.stage, replacement.mode);
      checkedPath(dirname(replacement.source.path), "directory"); checkedPath(replacement.source.path, "file");
      renameSync(replacement.stage, replacement.source.path); installed.push(replacement);
    }
    validateCurrent(); journal.status = "committed"; journal.completedAt = new Date().toISOString(); writeJournal(operationPath, journal);
    result.status = "committed";
  } catch (error) {
    result.status = error instanceof Conflict ? "conflict" : "error";
    result.problems.push({ code: error instanceof Conflict ? "save-conflict" : "save-error", message: message(error) });
    if (prepared) {
      let restored = true;
      for (const replacement of [...installed].reverse()) {
        try {
          const current = readText(replacement.source.path, WORKSPACE_MEMORY_LIMITS.sourceBytes);
          if (current.sha256 === replacement.source.sha256) continue;
          if (current.sha256 !== replacement.newHash) throw new Error(`External newer edit preserved: ${replacement.source.id}`);
          const restore = join(dirname(replacement.source.path), `.lawoss-memory-rollback-${randomUUID()}.tmp`);
          createPrivate(restore, replacement.source.content!);
          chmodSync(restore, replacement.mode);
          try {
            if (readText(replacement.source.path, WORKSPACE_MEMORY_LIMITS.sourceBytes).sha256 !== replacement.newHash) throw new Error(`External edit during rollback: ${replacement.source.id}`);
            checkedPath(dirname(replacement.source.path), "directory"); renameSync(restore, replacement.source.path);
          } finally { if (checkedPath(restore, "file", true)) unlinkSync(restore); }
        } catch (rollbackError) { restored = false; result.problems.push({ code: "rollback-conflict", message: message(rollbackError) }); }
      }
      result.rollback = restored ? "completed" : "incomplete";
      journal.status = restored ? "rolled-back" : "recovery-required"; journal.problems = result.problems;
      try { writeJournal(operationPath, journal); } catch (journalError) { result.rollback = "incomplete"; result.problems.push({ code: "journal-error", message: message(journalError) }); }
    }
  } finally {
    for (const replacement of replacements) {
      try { if (checkedPath(replacement.stage, "file", true) && readText(replacement.stage, WORKSPACE_MEMORY_LIMITS.sourceBytes).sha256 === replacement.newHash) unlinkSync(replacement.stage); }
      catch (error) { result.problems.push({ code: "stage-cleanup", message: message(error) }); }
    }
    if (lockFd !== undefined) {
      try { const held = fstatSync(lockFd), named = lstatSync(lockPath); if (!named.isSymbolicLink() && held.ino === named.ino && held.dev === named.dev) unlinkSync(lockPath); }
      catch (error) { result.problems.push({ code: "lock-cleanup", message: message(error) }); if (result.status === "committed" || result.status === "already-applied") result.status = "error"; }
      finally { closeSync(lockFd); }
    }
  }
  return result;
}
