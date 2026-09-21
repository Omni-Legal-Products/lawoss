/** Bounded binary filesystem execution. Cooperative-writer CAS, not an OS sandbox. */
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, realpathSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { checkedPath, contained } from "../../okf-pamat/src/workspace-memory-fs.ts";
import { parseWorkspaceMemoryProfileText } from "../../okf-pamat/src/workspace-memory-profile.ts";
import { parseWorkingProfile, PROFILE_FILE } from "./profile.ts";
import { exactKeys, fold, hash, NAMING_LIMITS, NamingConflict, namingFingerprint, NamingSchemaError, normalizedMetadata, object, parseNamingRequest, renderDocumentName, rewriteSelectedMarkdownLinks, safeRelativePath, type FilePin, type NamingPlanV1, type NamingRequestV1 } from "./naming-core.ts";

const PROFILE_LIMIT = 256 * 1024, JSON_LIMIT = 4 * 1024 * 1024;
const reserved = /^(?:memory|spisy|office|_kancelaria|agents\.md|claude\.md|brain\.md|memory\.md|_memory\.md|client\.md|klient\.md|matter\.md|spis\.md|project\.md|projekt\.md|index\.md|log\.md|_status\.md|vstupy\.md|pracovny-profil\.md|komunikacne-kanaly\.md|okf\.config)$/i;
type Binary = { data: Buffer; sha256: string; bytes: number; physical: string; mode: number };
export type NamingApplyReport = { status: "applied" | "already-applied" | "conflict" | "recovery-required"; operationId: string; fingerprint: string; message?: string; journal?: string };
/** Test-only injection seam; CLI never accepts hooks or environment fault flags. */
export type NamingApplyHooks = { checkpoint?: (stage: "prepared" | "target-created" | "markdown-installed" | "source-removed" | "before-commit", path?: string) => void };
const physical = (stat: { dev: number; ino: number }) => `${stat.dev}:${stat.ino}`;
const utf8 = (data: Buffer) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
function conflict(message: string): never { throw new NamingConflict(message); }
function exists(path: string, kind: "file" | "directory" = "file"): boolean { return checkedPath(path, kind, true); }
function rootDirectory(directory: string): { path: string; identity: string } {
  checkedPath(directory, "directory"); const path = realpathSync(directory); return { path, identity: physical(lstatSync(path)) };
}
function assertRoot(root: { path: string; identity: string }): void { checkedPath(root.path, "directory"); if (realpathSync(root.path) !== root.path || physical(lstatSync(root.path)) !== root.identity) conflict("Matter root changed"); }
/** No decoding, bounded allocation/read even if the file grows, and no multiply-linked inputs. */
export function readNamingBinary(path: string, limit: number): Binary {
  checkedPath(path, "file");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1) conflict(`Regular single-link file required: ${path}`);
    if (before.size > limit) conflict(`Byte limit exceeded: ${path}`);
    const data = Buffer.alloc(Math.min(before.size + 1, limit + 1)); let count = 0;
    while (count < data.length) { const n = readSync(fd, data, count, data.length - count, null); if (!n) break; count += n; }
    const after = fstatSync(fd), named = lstatSync(path);
    if (count !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || physical(before) !== physical(after) || physical(before) !== physical(named) || named.isSymbolicLink() || named.nlink !== 1) conflict(`File changed during read: ${path}`);
    const bytes = data.subarray(0, count); return { data: bytes, bytes: count, sha256: hash(bytes), physical: physical(before), mode: before.mode & 0o777 };
  } finally { closeSync(fd); }
}
export function readNamingJson(path: string, limit = JSON_LIMIT): unknown { return JSON.parse(utf8(readNamingBinary(path, limit).data)); }
function pin(path: string, read: Binary): FilePin { return { path, sha256: read.sha256, bytes: read.bytes, physical: read.physical }; }
function assertPin(root: string, expected: FilePin, limit: number): Binary {
  const read = readNamingBinary(join(root, expected.path), limit);
  if (read.sha256 !== expected.sha256 || read.bytes !== expected.bytes || read.physical !== expected.physical) conflict(`Changed source: ${expected.path}`);
  return read;
}
/** Stream a single directory, never recurse; bound enumeration and reject case aliases on every OS. */
function checkCase(path: string, shouldExist: boolean): void {
  const directory = opendirSync(dirname(path)); let found = false, count = 0;
  try {
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      if (++count > 20000) conflict("Destination/path directory exceeds bounded case-check limit (20000 entries)");
      if (fold(entry.name) === fold(basename(path))) {
        if (entry.name !== basename(path) || !shouldExist) conflict(`Case-fold collision: ${path}`);
        found = true;
      }
    }
  } finally { directory.closeSync(); }
  if (shouldExist && !found) conflict(`Missing exact path: ${path}`);
}
function contentPath(root: string, path: string, mapped: Set<string>): string {
  if (!safeRelativePath(path) || path.split("/").some(p => reserved.test(p)) || mapped.has(fold(path))) throw new NamingSchemaError(`Protected or unsafe path: ${path}`);
  const result = resolve(root, path); if (!contained(root, result)) throw new NamingSchemaError("Path outside matter");
  let component = root;
  for (const part of path.split("/").slice(0, -1)) { component = join(component, part); checkedPath(component, "directory"); checkCase(component, true); }
  return result;
}
function memoryProtection(root: string): { source: FilePin | null; mapped: Set<string> } {
  const path = ".lawoss/memory-profile.json", absolute = join(root, path), mapped = new Set<string>();
  if (!exists(absolute)) return { source: null, mapped };
  const read = readNamingBinary(absolute, PROFILE_LIMIT), profile = parseWorkspaceMemoryProfileText(utf8(read.data));
  for (const source of profile.sources) {
    const location = profile.roots.find(r => r.id === source.root)!;
    // Resolve lexically only. No read/stat of any external mapped root or vault.
    const full = resolve(root, location.path, source.path);
    if (contained(root, full)) mapped.add(fold(relative(root, full).split(sep).join("/")));
  }
  return { source: pin(path, read), mapped };
}
function targetAbsent(root: string, target: NamingPlanV1["documents"][number]["target"]): void {
  const path = join(root, target.path); checkedPath(dirname(path), "directory");
  if (physical(lstatSync(dirname(path))) !== target.parentPhysical) conflict(`Target directory changed: ${target.path}`);
  checkCase(path, false); if (exists(path)) conflict(`Target exists: ${target.path}`);
}
export function planDocumentNaming(matterDir: string, input: NamingRequestV1): NamingPlanV1 {
  const request = parseNamingRequest(input), root = rootDirectory(matterDir);
  const profileRead = readNamingBinary(join(root.path, PROFILE_FILE), PROFILE_LIMIT), profile = parseWorkingProfile(utf8(profileRead.data));
  const protection = memoryProtection(root.path), selected = new Set([...request.documents.map(d => fold(d.path)), ...request.markdownFiles.map(fold)]), targets = new Set<string>(), identities = new Set<string>();
  let totalBytes = profileRead.bytes + (protection.source?.bytes ?? 0);
  const documents: NamingPlanV1["documents"] = request.documents.map(document => {
    const sourcePath = contentPath(root.path, document.path, protection.mapped); checkCase(sourcePath, true);
    const sourceRead = readNamingBinary(sourcePath, NAMING_LIMITS.documentBytes);
    if (identities.has(sourceRead.physical)) conflict("Selected physical file identity overlaps"); identities.add(sourceRead.physical);
    const rolePath = profile.roles[document.destinationRole]; if (!rolePath) throw new NamingSchemaError(`Missing saved-profile role: ${document.destinationRole}`);
    const targetPath = `${rolePath}/${renderDocumentName(profile, document.metadata, extname(document.path))}`;
    const absoluteTarget = contentPath(root.path, targetPath, protection.mapped);
    if (selected.has(fold(targetPath)) || targets.has(fold(targetPath))) conflict(`Source/target or target overlap: ${targetPath}`); targets.add(fold(targetPath));
    const target = { path: targetPath, mustBeAbsent: true as const, parentPhysical: physical(lstatSync(dirname(absoluteTarget))) };
    targetAbsent(root.path, target); totalBytes += sourceRead.bytes;
    if (totalBytes > NAMING_LIMITS.totalBytes) conflict("Total byte limit exceeded");
    return { id: document.id, treatment: document.treatment, source: pin(document.path, sourceRead), target, normalizedMetadata: normalizedMetadata(document.metadata) };
  });
  const moves = documents.filter(d => d.treatment === "rename-working").map(d => ({ from: d.source.path, to: d.target.path }));
  const markdown: NamingPlanV1["markdown"] = request.markdownFiles.map(path => {
    const full = contentPath(root.path, path, protection.mapped); checkCase(full, true); const read = readNamingBinary(full, NAMING_LIMITS.markdownBytes);
    if (identities.has(read.physical)) conflict("Selected physical file identity overlaps"); identities.add(read.physical);
    const rewritten = rewriteSelectedMarkdownLinks(path, utf8(read.data), moves);
    if (Buffer.byteLength(rewritten.content) > NAMING_LIMITS.markdownBytes) conflict("Rewritten Markdown exceeds byte limit");
    totalBytes += read.bytes; if (totalBytes > NAMING_LIMITS.totalBytes) conflict("Total byte limit exceeded");
    return { source: pin(path, read), afterSha256: hash(rewritten.content), rewrites: rewritten.rewrites };
  });
  assertRoot(root);
  const body: Omit<NamingPlanV1, "fingerprint"> = { schema: "lawoss.document-naming.plan/v1", operationId: request.operationId, matterRootPhysical: root.path, rootIdentity: root.identity, request, profile: { ...pin(PROFILE_FILE, profileRead), naming: profile.naming, roles: profile.roles }, memoryProfile: protection.source, documents, markdown, limits: NAMING_LIMITS, totalBytes, linkScope: "selected-files-only; unselected links are not verified" };
  const result = { ...body, fingerprint: namingFingerprint(body) };
  if (Buffer.byteLength(JSON.stringify(result, null, 2) + "\n") > JSON_LIMIT) conflict("Plan exceeds 4 MiB; reduce selected link scope");
  return result;
}
function isPin(v: unknown): v is FilePin {
  return object(v) && typeof v.path === "string" && typeof v.sha256 === "string" && /^[a-f0-9]{64}$/.test(v.sha256) && typeof v.bytes === "number" && Number.isSafeInteger(v.bytes) && v.bytes >= 0 && typeof v.physical === "string" && /^[0-9]+:[0-9]+$/.test(v.physical);
}
/** Validate all executable fields, then integrity; first apply also re-derives the entire plan. */
export function parseNamingPlan(value: unknown): NamingPlanV1 {
  if (!object(value)) throw new NamingSchemaError("Invalid naming plan");
  exactKeys(value, ["schema", "operationId", "fingerprint", "matterRootPhysical", "rootIdentity", "request", "profile", "memoryProfile", "documents", "markdown", "limits", "totalBytes", "linkScope"]);
  const request = parseNamingRequest(value.request);
  if (value.schema !== "lawoss.document-naming.plan/v1" || value.operationId !== request.operationId || typeof value.fingerprint !== "string" || typeof value.matterRootPhysical !== "string" || !isAbsolute(value.matterRootPhysical) || typeof value.rootIdentity !== "string" || !/^[0-9]+:[0-9]+$/.test(value.rootIdentity) || !object(value.profile) || typeof value.profile.naming !== "string" || !object(value.profile.roles) || !isPin(value.profile) || value.profile.path !== PROFILE_FILE || (value.memoryProfile !== null && (!isPin(value.memoryProfile) || value.memoryProfile.path !== ".lawoss/memory-profile.json")) || !Array.isArray(value.documents) || value.documents.length !== request.documents.length || !Array.isArray(value.markdown) || value.markdown.length !== request.markdownFiles.length || namingFingerprint(value.limits) !== namingFingerprint(NAMING_LIMITS) || typeof value.totalBytes !== "number" || !Number.isSafeInteger(value.totalBytes) || value.totalBytes < 0 || value.totalBytes > NAMING_LIMITS.totalBytes || value.linkScope !== "selected-files-only; unselected links are not verified") throw new NamingSchemaError("Invalid naming plan fields");
  for (const [i, d] of value.documents.entries()) {
    const document = request.documents[i]!;
    if (!object(d) || d.id !== document.id || d.treatment !== document.treatment || !isPin(d.source) || d.source.path !== document.path || d.source.bytes > NAMING_LIMITS.documentBytes || !object(d.target) || !safeRelativePath(d.target.path) || d.target.mustBeAbsent !== true || typeof d.target.parentPhysical !== "string" || !/^[0-9]+:[0-9]+$/.test(d.target.parentPhysical) || !object(d.normalizedMetadata)) throw new NamingSchemaError("Invalid planned document");
  }
  for (const [i, m] of value.markdown.entries()) {
    if (!object(m) || !isPin(m.source) || m.source.path !== request.markdownFiles[i] || m.source.bytes > NAMING_LIMITS.markdownBytes || typeof m.afterSha256 !== "string" || !/^[a-f0-9]{64}$/.test(m.afterSha256) || !Array.isArray(m.rewrites)) throw new NamingSchemaError("Invalid planned Markdown");
  }
  const { fingerprint, ...body } = value;
  if (namingFingerprint(body) !== fingerprint) throw new NamingSchemaError("Plan fingerprint changed; obtain a new preview and approval");
  // Every runtime field above is checked; full semantic equivalence is checked against a new plan before writes.
  return value as NamingPlanV1;
}
function exclusive(path: string, data: Buffer | string, mode = 0o600): string {
  checkedPath(dirname(path), "directory");
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
  try { const buffer = typeof data === "string" ? Buffer.from(data) : data; let count = 0; while (count < buffer.length) count += writeSync(fd, buffer, count, buffer.length - count); fsyncSync(fd); return physical(fstatSync(fd)); }
  finally { closeSync(fd); }
}
function controlDirectory(path: string): void { try { mkdirSync(path, { mode: 0o700 }); } catch (error) { if (!object(error) || error.code !== "EEXIST") throw error; } checkedPath(path, "directory"); }
function profileCAS(root: string, plan: NamingPlanV1): void {
  assertPin(root, plan.profile, PROFILE_LIMIT); const current = memoryProtection(root);
  if (namingFingerprint(current.source) !== namingFingerprint(plan.memoryProfile)) conflict("Memory profile presence/content/identity changed");
}
function finalStates(root: string, plan: NamingPlanV1): FilePin[] {
  profileCAS(root, plan); const files: FilePin[] = [];
  for (const doc of plan.documents) {
    const targetPath = join(root, doc.target.path);
    checkedPath(dirname(targetPath), "directory");
    if (physical(lstatSync(dirname(targetPath))) !== doc.target.parentPhysical) conflict("Final target directory changed");
    checkCase(targetPath, true);
    const target = readNamingBinary(targetPath, NAMING_LIMITS.documentBytes);
    files.push(pin(doc.target.path, target));
    if (target.sha256 !== doc.source.sha256 || target.bytes !== doc.source.bytes) conflict(`Final target changed: ${doc.target.path}`);
    if (doc.treatment === "copy-original-to-drafts") files.push(pin(doc.source.path, assertPin(root, doc.source, NAMING_LIMITS.documentBytes)));
    else if (exists(join(root, doc.source.path))) conflict(`Working source reappeared: ${doc.source.path}`);
  }
  for (const m of plan.markdown) {
    const read = readNamingBinary(join(root, m.source.path), NAMING_LIMITS.markdownBytes);
    if (read.sha256 !== m.afterSha256) conflict(`Final Markdown changed: ${m.source.path}`);
    files.push(pin(m.source.path, read));
  }
  return files;
}

export function applyDocumentNaming(matterDir: string, input: NamingPlanV1, hooks: NamingApplyHooks = {}): NamingApplyReport {
  const plan = parseNamingPlan(input), root = rootDirectory(matterDir);
  const report = (status: NamingApplyReport["status"], message?: string): NamingApplyReport => ({ status, operationId: plan.operationId, fingerprint: plan.fingerprint, ...(message ? { message } : {}) });
  if (root.path !== plan.matterRootPhysical || root.identity !== plan.rootIdentity) return report("conflict", "Matter root physical identity differs");
  const history = join(root.path, ".lawoss/naming-history"), operation = join(history, plan.operationId), journal = join(operation, "journal.json"), lock = join(history, "apply.lock");
  let lockIdentity: string | undefined;
  const created: { path: string; physical: string; sha256: string }[] = [], installed: { path: string; physical: string; sha256: string; backup: string; mode: number; beforeSha256: string }[] = [], removed: { path: string; backup: string; sha256: string; mode: number }[] = [];
  let prepared = false;
  try {
    // Check before creating control artifacts; a stale preview causes no content mutations.
    if (!exists(operation, "directory")) {
      const fresh = planDocumentNaming(root.path, plan.request); if (fresh.fingerprint !== plan.fingerprint) conflict("Preview is stale; create and approve a new plan");
    }
    controlDirectory(join(root.path, ".lawoss")); controlDirectory(history);
    checkCase(operation, exists(operation, "directory"));
    lockIdentity = exclusive(lock, JSON.stringify({ operationId: plan.operationId, fingerprint: plan.fingerprint }));
    assertRoot(root);
    if (exists(operation, "directory")) {
      if (!exists(journal)) return { ...report("recovery-required", "Existing operation has no complete journal"), journal };
      const prior = readNamingJson(journal, 2 * JSON_LIMIT);
      if (!object(prior) || prior.fingerprint !== plan.fingerprint || namingFingerprint(prior.plan) !== namingFingerprint(plan)) return report("conflict", "Operation ID belongs to a different plan or invalid journal");
      if (!exists(join(operation, "committed.json"))) return { ...report("recovery-required", "Incomplete operation; retain journal and snapshots for human recovery"), journal };
      const committed = readNamingJson(join(operation, "committed.json"));
      if (!object(committed) || committed.fingerprint !== plan.fingerprint) conflict("Invalid committed receipt");
      if (namingFingerprint(finalStates(root.path, plan)) !== namingFingerprint(committed.finalFiles)) conflict("Committed physical final states changed");
      return { ...report("already-applied"), journal };
    }
    const fresh = planDocumentNaming(root.path, plan.request); if (fresh.fingerprint !== plan.fingerprint) conflict("Preview changed while acquiring lock");
    mkdirSync(operation, { mode: 0o700 }); prepared = true;
    exclusive(journal, JSON.stringify({ version: 1, status: "prepared", fingerprint: plan.fingerprint, plan }, null, 2));
    const snapshots = new Map<string, { backup: string; mode: number; beforeSha256: string }>();
    for (const [i, source] of [...plan.documents.map(d => d.source), ...plan.markdown.map(m => m.source)].entries()) {
      const read = assertPin(root.path, source, i < plan.documents.length ? NAMING_LIMITS.documentBytes : NAMING_LIMITS.markdownBytes);
      const backup = join(operation, `before-${i}.bin`); exclusive(backup, read.data); snapshots.set(source.path, { backup, mode: read.mode, beforeSha256: read.sha256 });
    }
    hooks.checkpoint?.("prepared"); profileCAS(root.path, plan);
    for (const document of plan.documents) {
      assertRoot(root); profileCAS(root.path, plan); targetAbsent(root.path, document.target);
      const source = assertPin(root.path, document.source, NAMING_LIMITS.documentBytes), path = join(root.path, document.target.path);
      const identity = exclusive(path, source.data, source.mode); created.push({ path, physical: identity, sha256: source.sha256 });
      if (readNamingBinary(path, NAMING_LIMITS.documentBytes).sha256 !== source.sha256) conflict("Target copy verification failed");
      exclusive(join(operation, `target-${created.length}.json`), JSON.stringify(created.at(-1)));
      hooks.checkpoint?.("target-created", document.target.path);
    }
    const moves = plan.documents.filter(d => d.treatment === "rename-working").map(d => ({ from: d.source.path, to: d.target.path }));
    for (const [i, markdown] of plan.markdown.entries()) {
      const before = assertPin(root.path, markdown.source, NAMING_LIMITS.markdownBytes);
      const rewritten = rewriteSelectedMarkdownLinks(markdown.source.path, utf8(before.data), moves);
      if (hash(rewritten.content) !== markdown.afterSha256) conflict("Link rewrite differs from approved plan");
      if (markdown.source.sha256 === markdown.afterSha256) continue;
      const staged = join(operation, `markdown-${i}.stage`), identity = exclusive(staged, rewritten.content, before.mode);
      if (readNamingBinary(staged, NAMING_LIMITS.markdownBytes).sha256 !== markdown.afterSha256) conflict("Staged Markdown differs");
      assertRoot(root); profileCAS(root.path, plan); assertPin(root.path, markdown.source, NAMING_LIMITS.markdownBytes);
      const path = join(root.path, markdown.source.path);
      exclusive(join(operation, `markdown-${i}-intent.json`), JSON.stringify({ path: markdown.source.path, stagedPhysical: identity }));
      renameSync(staged, path); installed.push({ path, physical: identity, sha256: markdown.afterSha256, ...snapshots.get(markdown.source.path)! });
      hooks.checkpoint?.("markdown-installed", markdown.source.path);
    }
    for (const document of plan.documents.filter(d => d.treatment === "rename-working")) {
      assertRoot(root); profileCAS(root.path, plan);
      for (const m of plan.markdown) if (readNamingBinary(join(root.path, m.source.path), NAMING_LIMITS.markdownBytes).sha256 !== m.afterSha256) conflict("Selected links changed before source removal");
      const target = readNamingBinary(join(root.path, document.target.path), NAMING_LIMITS.documentBytes);
      if (target.sha256 !== document.source.sha256) conflict("Target changed before source removal");
      assertPin(root.path, document.source, NAMING_LIMITS.documentBytes);
      const path = join(root.path, document.source.path), snapshot = snapshots.get(document.source.path)!;
      exclusive(join(operation, `remove-${removed.length}-intent.json`), JSON.stringify({ path: document.source.path, ...snapshot }));
      unlinkSync(path); removed.push({ path, sha256: document.source.sha256, ...snapshot });
      hooks.checkpoint?.("source-removed", document.source.path);
    }
    hooks.checkpoint?.("before-commit"); assertRoot(root);
    const finalFiles = finalStates(root.path, plan);
    for (const file of [...created, ...installed]) if (readNamingBinary(file.path, NAMING_LIMITS.documentBytes).physical !== file.physical) conflict("Written file physical identity changed before commit");
    exclusive(join(operation, "committed.json"), JSON.stringify({ version: 1, status: "committed", fingerprint: plan.fingerprint, finalFiles }));
    return { ...report("applied"), journal };
  } catch (error) {
    const recovery = prepared;
    let completeRollback = true;
    // Exclusive restoration and identity+hash CAS: external newer edits are retained, never overwritten.
    if (prepared) {
      for (const source of [...removed].reverse()) try {
        assertRoot(root);
        if (exists(source.path)) { completeRollback = false; continue; }
        if (!exists(source.path)) { const backup = readNamingBinary(source.backup, NAMING_LIMITS.documentBytes); if (backup.sha256 !== source.sha256) conflict("Backup changed"); exclusive(source.path, backup.data, source.mode); }
      } catch { completeRollback = false; }
      for (const markdown of [...installed].reverse()) try {
        assertRoot(root); const current = readNamingBinary(markdown.path, NAMING_LIMITS.markdownBytes);
        if (current.physical !== markdown.physical || current.sha256 !== markdown.sha256) { completeRollback = false; continue; }
        const snapshot = readNamingBinary(markdown.backup, NAMING_LIMITS.markdownBytes), stage = `${markdown.backup}.restore`;
        if (snapshot.sha256 !== markdown.beforeSha256) conflict("Markdown backup changed");
        exclusive(stage, snapshot.data, markdown.mode);
        const check = readNamingBinary(markdown.path, NAMING_LIMITS.markdownBytes);
        if (check.physical !== markdown.physical || check.sha256 !== markdown.sha256) { completeRollback = false; continue; }
        renameSync(stage, markdown.path);
      } catch { completeRollback = false; }
      // Retain every copy if any source/link restoration is uncertain. Newer links may depend on it.
      if (completeRollback) for (const target of [...created].reverse()) try {
        assertRoot(root); const current = readNamingBinary(target.path, NAMING_LIMITS.documentBytes);
        if (current.physical === target.physical && current.sha256 === target.sha256) unlinkSync(target.path);
      } catch { completeRollback = false; }
      try { exclusive(join(operation, "failure.json"), JSON.stringify({ status: "recovery-required", error: error instanceof Error ? error.message : String(error), created, installed, removed })); } catch { /* Never erase earlier recovery evidence. */ }
    }
    return { ...report(recovery ? "recovery-required" : "conflict", error instanceof Error ? error.message : String(error)), ...(prepared ? { journal } : {}) };
  } finally {
    if (lockIdentity) try { checkedPath(lock, "file"); if (physical(lstatSync(lock)) === lockIdentity) unlinkSync(lock); } catch { /* A replaced lock belongs to another writer. */ }
  }
}

/** Preview output is an explicitly requested new artifact outside the matter, never an overwrite. */
export function writeNamingPlanOutsideMatter(matterDir: string, output: string, plan: NamingPlanV1): void {
  const root = rootDirectory(matterDir), path = resolve(output); checkedPath(dirname(path), "directory");
  const parent = realpathSync(dirname(path)), physicalOutput = join(parent, basename(path));
  if (contained(root.path, physicalOutput) || !safeRelativePath(basename(path))) throw new NamingSchemaError("--out must be a new portable filename outside the matter root");
  checkCase(physicalOutput, false); exclusive(physicalOutput, JSON.stringify(plan, null, 2) + "\n");
}
