import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, readdir, rm, rmdir } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { inspectOnboardingParent, inspectOnboardingRoot, type OnboardingInspection, type TreeEntry } from "./classify.ts";

export type CreateOperation = { path: string; kind: "file" | "directory"; content?: string };
/**
 * `scope: "parent"`: plán len pridáva nové položky do priečinka (kancelária, klient,
 * subjekt, vec), otlačok aj kontrola počas zápisu sú plytké (`inspectOnboardingParent`).
 * Bez `scope` platí rekurzívny otlačok celého stromu (prevod, klon).
 */
export type OnboardingPlan = { version: 1; root: string; treeDigest: string; operations: CreateOperation[]; scope?: "parent" };
export type ApplyResult = { status: "applied" | "already_applied" | "rolled_back"; created: string[] };
type Journal = { version: 1; identity: string; plan: OnboardingPlan; baseline: TreeEntry[] };
type Event = { type: "intent" | "created" | "remove_intent" | "removed" | "completed" | "rollback_started" | "rolled_back"; path?: string; kind?: CreateOperation["kind"]; digest?: string; identity?: string };

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const pathInside = (parent: string, child: string) => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
};
const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function fail(message: string): never { throw new Error(`Invalid onboarding plan: ${message}`); }
function safePath(value: string): string {
  if (typeof value !== "string" || !value || value.length > 1024 || value.includes("\0") || value.includes("\\") || isAbsolute(value) || /^[a-z]:/i.test(value)) fail("unsafe operation path");
  const parts = value.split("/");
  if (parts.some(part => !part || part.length > 255 || part === "." || part === ".." || /[<>:"|?*\u0000-\u001f\u007f-\u009f]/.test(part) || /[. ]$/.test(part) || reserved.test(part))) fail("unsafe operation path");
  return parts.join("/");
}
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

export function parseOnboardingPlan(value: unknown): OnboardingPlan {
  if (!isRecord(value) || value.version !== 1 || typeof value.root !== "string" || !isAbsolute(value.root) || typeof value.treeDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.treeDigest) || !Array.isArray(value.operations)) fail("schema");
  if (value.scope !== undefined && value.scope !== "parent") fail("scope");
  const operations: CreateOperation[] = [];
  if (value.operations.length > 10_000) fail("too many operations");
  const seen = new Map<string, number>();
  let bytes = 0;
  value.operations.forEach((candidate, index) => {
    if (!isRecord(candidate) || (candidate.kind !== "file" && candidate.kind !== "directory")) fail("operation schema");
    if (typeof candidate.path !== "string") fail("operation schema");
    const path = safePath(candidate.path);
    const content = candidate.content;
    if (candidate.kind === "file" && typeof content !== "string") fail("operation content");
    if (candidate.kind === "directory" && content !== undefined) fail("operation content");
    if (seen.has(path) || [...seen.keys()].some(existing => existing.toLowerCase() === path.toLowerCase())) fail("duplicate operation path");
    const parent = dirname(path);
    if (parent !== ".") {
      const parentIndex = seen.get(parent);
      if (parentIndex !== undefined && (parentIndex >= index || operations[parentIndex]?.kind !== "directory")) fail("directory parents must be explicit and ordered");
    }
    seen.set(path, index);
    if (candidate.kind === "file") {
      if (typeof content !== "string") fail("operation content");
      bytes += Buffer.byteLength(content);
      if (bytes > 4 * 1024 * 1024) fail("planned content exceeds byte limit");
      operations.push({ path, kind: "file", content });
    } else operations.push({ path, kind: "directory" });
  });
  return { version: 1, root: value.root, treeDigest: value.treeDigest, operations, ...(value.scope === "parent" ? { scope: "parent" as const } : {}) };
}
async function canonicalDirectory(value: string, label: string): Promise<string> {
  if (!isAbsolute(value)) throw new Error(`${label} must be absolute.`);
  const resolved = resolve(value);
  try {
    if (await realpath(value) !== resolved || !(await lstat(resolved)).isDirectory()) throw new Error(`${label} must be a canonical directory.`);
  } catch { throw new Error(`${label} must be a canonical directory.`); }
  return resolved;
}
async function context(plan: OnboardingPlan, journalDirectory: string) {
  plan = parseOnboardingPlan(plan);
  const root = await canonicalDirectory(plan.root, "Plan root");
  if (root !== plan.root) throw new Error("Plan root must be canonical.");
  const journal = await canonicalDirectory(journalDirectory, "Journal directory");
  if (pathInside(root, journal) || pathInside(journal, root)) throw new Error("Journal directory must not overlap the plan root.");
  return { root, journal, plan, identity: sha(JSON.stringify(plan)) };
}
async function appendEvent(path: string, event: Event): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(`${JSON.stringify(event)}\n`); await handle.sync(); } finally { await handle.close(); }
  await durableDirectory(dirname(path));
}
async function readEvents(path: string): Promise<Event[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw.split("\n").filter(Boolean).map(line => {
      const value: unknown = JSON.parse(line);
      if (!isRecord(value) || (value.type !== "intent" && value.type !== "created" && value.type !== "remove_intent" && value.type !== "removed" && value.type !== "completed" && value.type !== "rollback_started" && value.type !== "rolled_back")) throw new Error("Invalid journal event.");
      if (value.type === "completed" || value.type === "rolled_back" || value.type === "rollback_started") return { type: value.type };
      if (typeof value.path !== "string" || (value.kind !== "file" && value.kind !== "directory")) throw new Error("Invalid journal event.");
      const digest = value.digest, identity = value.identity;
      if (value.type === "created" && (typeof digest !== "string" || typeof identity !== "string")) throw new Error("Invalid journal event.");
      if (value.type === "created") {
        if (typeof digest !== "string" || typeof identity !== "string") throw new Error("Invalid journal event.");
        return { type: "created", path: value.path, kind: value.kind, digest, identity };
      }
      return { type: value.type, path: value.path, kind: value.kind };
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}
async function createJournal(journalPath: string, journal: Journal): Promise<void> {
  try {
    const handle = await open(journalPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(JSON.stringify(journal)); await handle.sync(); } finally { await handle.close(); }
    await durableDirectory(dirname(journalPath));
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
    const existing = parseJournal(JSON.parse(await readFile(journalPath, "utf8")));
    if (existing.identity !== journal.identity || JSON.stringify(existing.plan) !== JSON.stringify(journal.plan)) throw new Error("Journal identity collision.");
  }
}
function parseJournal(value: unknown): Journal {
  if (!isRecord(value) || value.version !== 1 || typeof value.identity !== "string" || !/^[a-f0-9]{64}$/.test(value.identity) || !Array.isArray(value.baseline)) throw new Error("Invalid journal.");
  const baseline = value.baseline.filter(isRecord).map(entry => ({ path: entry.path, kind: entry.kind, digest: entry.digest, size: entry.size })).filter((entry): entry is TreeEntry => typeof entry.path === "string" && (entry.kind === "file" || entry.kind === "directory" || entry.kind === "symlink" || entry.kind === "unsupported") && (typeof entry.digest === "string" || entry.digest === null) && typeof entry.size === "number");
  if (baseline.length !== value.baseline.length) throw new Error("Invalid journal baseline.");
  return { version: 1, identity: value.identity, plan: parseOnboardingPlan(value.plan), baseline };
}
async function noSymlinkRoot(root: string): Promise<void> {
  if (await realpath(root) !== root || (await lstat(root)).isSymbolicLink()) throw new Error("Root changed or is a symlink.");
}
async function targetState(root: string, operation: CreateOperation): Promise<"missing" | "correct" | "conflict"> {
  const target = join(root, operation.path);
  try {
    const parent = dirname(target);
    if (await realpath(parent) !== parent || (await lstat(parent)).isSymbolicLink()) return "conflict";
    const state = await lstat(target);
    if (state.isSymbolicLink() || (operation.kind === "file" ? !state.isFile() : !state.isDirectory())) return "conflict";
    if (operation.kind === "file") return sha(await readFile(target, "utf8")) === sha(operation.content ?? "") ? "correct" : "conflict";
    return "correct";
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "missing";
    throw error;
  }
}
async function create(root: string, operation: CreateOperation): Promise<void> {
  const full = join(root, operation.path);
  const parent = dirname(full);
  const parentState = await lstat(parent);
  if (!parentState.isDirectory() || parentState.isSymbolicLink() || await realpath(parent) !== parent) throw new Error("Unsafe parent directory.");
  if (operation.kind === "directory") {
    await mkdir(full);
    const state = await lstat(full);
    if (!state.isDirectory() || state.isSymbolicLink()) throw new Error("Created directory changed.");
    await durableDirectory(parent);
    return;
  }
  const handle = await open(full, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(operation.content ?? ""); await handle.sync(); } finally { await handle.close(); }
  await durableDirectory(parent);
}
async function entryIdentity(path: string, kind: CreateOperation["kind"]): Promise<string> {
  const state = await lstat(path, { bigint: true });
  return kind === "directory" ? `${state.dev}:${state.ino}` : `${state.dev}:${state.ino}:${state.ctimeNs}`;
}
async function verifyCreated(root: string, operations: readonly CreateOperation[], created: Map<string, Event>): Promise<void> {
  for (const operation of operations) {
    const event = created.get(operation.path);
    if (!event) continue;
    if (await targetState(root, operation) !== "correct" || event.identity !== await entryIdentity(join(root, operation.path), operation.kind)) throw new Error(`Owned entry changed: ${operation.path}`);
  }
}
async function verifyBaseline(root: string, baseline: readonly TreeEntry[], owned: ReadonlySet<string>, scope?: OnboardingPlan["scope"]): Promise<void> {
  const inspection = await inspectDigest(root, scope);
  if (!inspection.complete) throw new Error("Root changed or contains unsafe entries.");
  const actual = inspection.entries.filter(entry => !owned.has(entry.path));
  if (JSON.stringify(actual) !== JSON.stringify(baseline)) throw new Error("Onboarding root changed during transaction.");
}
async function preflight(root: string, plan: OnboardingPlan, baseline: readonly TreeEntry[]): Promise<void> {
  const baselinePaths = new Set(baseline.map(entry => entry.path.toLowerCase()));
  for (const [index, operation] of plan.operations.entries()) {
    if (baselinePaths.has(operation.path.toLowerCase())) throw new Error(`Target already exists: ${operation.path}`);
    if (await targetState(root, operation) !== "missing") throw new Error(`Target already exists: ${operation.path}`);
    const parentPath = dirname(operation.path);
    const parent = dirname(join(root, operation.path));
    try {
      const state = await lstat(parent);
      if (!state.isDirectory() || state.isSymbolicLink() || await realpath(parent) !== parent) throw new Error(`Unsafe parent directory: ${operation.path}`);
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
      const parentIndex = plan.operations.findIndex(item => item.path === parentPath && item.kind === "directory");
      if (parentPath === "." || parentIndex < 0 || parentIndex >= index) throw new Error(`Missing planned parent directory: ${operation.path}`);
    }
  }
}
async function durableDirectory(path: string): Promise<void> {
  // Windows does not permit opening directories for fsync. Its guarantee is process-crash recovery,
  // while power-loss durability depends on the filesystem's own metadata flushing behavior.
  if (process.platform === "win32") return;
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function coordinatorDirectory(): Promise<string> {
  const base = await realpath(tmpdir());
  const baseState = await lstat(base);
  if (!baseState.isDirectory() || baseState.isSymbolicLink()) throw new Error("OS temporary directory must be a directory.");
  const user = typeof process.getuid === "function" ? String(process.getuid()) : "current-user";
  const locks = join(base, `.okf-onboarding-coordinator-${user}`);
  try { await mkdir(locks, { mode: 0o700 }); } catch (error) { if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error; }
  const state = await lstat(locks);
  if (await realpath(locks) !== locks || !state.isDirectory() || state.isSymbolicLink() || (typeof process.getuid === "function" && (state.uid !== process.getuid() || (state.mode & 0o077) !== 0))) throw new Error("Unsafe onboarding lock coordinator.");
  return locks;
}
/** Coordinates same-root writers for this OS user, independently of journal selection. */
async function lock(root: string): Promise<() => Promise<void>> {
  const locks = await coordinatorDirectory();
  const path = join(locks, sha(root));
  const owner = { pid: process.pid, host: hostname(), token: sha(`${process.pid}:${Date.now()}:${Math.random()}`) };
  let handle;
  try { handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
    const before = await lstat(path, { bigint: true });
    let incumbent: unknown;
    try { incumbent = JSON.parse(await readFile(path, "utf8")); } catch { throw new Error("Another onboarding transaction is active for this root."); }
    if (!isRecord(incumbent) || typeof incumbent.pid !== "number" || !Number.isSafeInteger(incumbent.pid) || typeof incumbent.host !== "string" || typeof incumbent.token !== "string" || incumbent.host !== hostname()) throw new Error("Another onboarding transaction is active for this root.");
    let dead = false;
    try { process.kill(incumbent.pid, 0); }
    catch (check) { if (check && typeof check === "object" && "code" in check && check.code === "ESRCH") dead = true; else throw new Error("Another onboarding transaction is active for this root."); }
    if (!dead) throw new Error("Another onboarding transaction is active for this root.");
    const after = await lstat(path, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.ctimeNs !== after.ctimeNs || await readFile(path, "utf8") !== JSON.stringify(incumbent)) throw new Error("Another onboarding transaction is active for this root.");
    await rm(path);
    handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  }
  try { await handle.writeFile(JSON.stringify(owner)); await handle.sync(); await durableDirectory(locks); } catch (error) { await handle.close(); await rm(path, { force: true }); throw error; }
  return async () => { await handle.close(); const current = JSON.parse(await readFile(path, "utf8")); if (isRecord(current) && current.token === owner.token) await rm(path, { force: true }); };
}
async function inspectDigest(root: string, scope?: OnboardingPlan["scope"]): Promise<OnboardingInspection> { return scope === "parent" ? inspectOnboardingParent(root) : inspectOnboardingRoot(root); }

/**
 * Filesystem checks narrow races but cannot make a hostile filesystem race-proof.
 * Callers should keep roots private and on a trusted local filesystem.
 */
export async function applyOnboardingPlan(plan: OnboardingPlan, journalDirectory: string): Promise<ApplyResult> {
  const prepared = await context(plan, journalDirectory);
  const { root, journal, identity } = prepared;
  plan = prepared.plan;
  const release = await lock(root);
  try {
    await noSymlinkRoot(root);
    const journalPath = join(journal, `${identity}.json`);
    const eventsPath = join(journal, `${identity}.events.jsonl`);
    let stored: Journal | null = null;
    try { stored = parseJournal(JSON.parse(await readFile(journalPath, "utf8"))); }
    catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT") throw error;
    }
    if (stored) {
      if (stored.identity !== identity || JSON.stringify(stored.plan) !== JSON.stringify(plan)) throw new Error("Journal identity mismatch.");
    } else {
      const inspection = await inspectDigest(root, plan.scope);
      if (!inspection.complete || inspection.digest !== plan.treeDigest) throw new Error("Onboarding root changed since planning.");
      stored = { version: 1, identity, plan, baseline: inspection.entries };
      await createJournal(journalPath, stored);
    }
    const events = await readEvents(eventsPath);
    const removed = new Set(events.filter(event => event.type === "removed" && event.path).map(event => event.path!));
    const created = new Map(events.filter(event => event.type === "created" && event.path && !removed.has(event.path)).map(event => [event.path!, event]));
    if (events.some(event => event.type === "rolled_back")) throw new Error("Onboarding transaction was rolled back.");
    if (events.some(event => event.type === "completed")) { await verifyCreated(root, plan.operations, created); if (created.size !== plan.operations.length) throw new Error("Incomplete completed journal."); return { status: "already_applied", created: [...created.keys()] }; }
    if (events.length) throw new Error("Incomplete onboarding transaction requires recovery.");
    if (!stored) throw new Error("Journal was not initialized.");
    await verifyBaseline(root, stored.baseline, new Set(created.keys()), plan.scope);
    await preflight(root, plan, stored.baseline);
    for (const operation of plan.operations) {
      await noSymlinkRoot(root);
      if (await targetState(root, operation) !== "missing") throw new Error(`Target already exists: ${operation.path}`);
      await appendEvent(eventsPath, { type: "intent", path: operation.path, kind: operation.kind });
      await create(root, operation);
      const ownedIdentity = await entryIdentity(join(root, operation.path), operation.kind);
      await appendEvent(eventsPath, { type: "created", path: operation.path, kind: operation.kind, digest: operation.kind === "file" ? sha(operation.content ?? "") : "directory", identity: ownedIdentity });
      created.set(operation.path, { type: "created", path: operation.path, kind: operation.kind, digest: operation.kind === "file" ? sha(operation.content ?? "") : "directory", identity: ownedIdentity });
    }
    await appendEvent(eventsPath, { type: "completed" });
    return { status: "applied", created: [...created.keys()] };
  } finally { await release(); }
}

export async function recoverOnboardingPlan(plan: OnboardingPlan, journalDirectory: string, action: "finish" | "rollback"): Promise<ApplyResult> {
  if (action !== "finish" && action !== "rollback") throw new Error("Recovery action must be finish or rollback.");
  const prepared = await context(plan, journalDirectory);
  const { root, journal, identity } = prepared;
  plan = prepared.plan;
  const release = await lock(root);
  try {
    const journalPath = join(journal, `${identity}.json`);
    const eventsPath = join(journal, `${identity}.events.jsonl`);
    const stored = parseJournal(JSON.parse(await readFile(journalPath, "utf8")));
    if (stored.identity !== identity || JSON.stringify(stored.plan) !== JSON.stringify(plan)) throw new Error("Journal identity mismatch.");
    const events = await readEvents(eventsPath);
    const intents = new Set(events.filter(event => event.type === "intent" && event.path).map(event => event.path!));
    const removed = new Set(events.filter(event => event.type === "removed" && event.path).map(event => event.path!));
    const created = new Map(events.filter(event => event.type === "created" && event.path && !removed.has(event.path)).map(event => [event.path!, event]));
    await noSymlinkRoot(root);
    const rollingBack = events.some(event => event.type === "rollback_started" || event.type === "remove_intent" || event.type === "removed");
    if (rollingBack && action !== "rollback") throw new Error("Rollback has started; continue rollback instead of finish.");
    // A durable removal intent plus absence lets a crashed rollback resume without deleting anything.
    for (const operation of plan.operations) {
      if (!created.has(operation.path) || !events.some(event => event.type === "remove_intent" && event.path === operation.path)) continue;
      if (await targetState(root, operation) === "missing") {
        await appendEvent(eventsPath, { type: "removed", path: operation.path, kind: operation.kind });
        created.delete(operation.path); removed.add(operation.path);
      }
    }
    await verifyCreated(root, plan.operations, created);
    await verifyBaseline(root, stored.baseline, new Set(created.keys()), plan.scope);
    if (events.some(event => event.type === "rolled_back")) {
      if (action === "rollback") return { status: "rolled_back", created: [] };
      throw new Error("Onboarding transaction was rolled back.");
    }
    if (events.some(event => event.type === "completed")) { if (created.size !== plan.operations.length) throw new Error("Incomplete completed journal."); return { status: "already_applied", created: [...created.keys()] }; }
    if (action === "rollback") {
      for (const operation of [...plan.operations].reverse()) {
        if (!created.has(operation.path)) { if (intents.has(operation.path) && !removed.has(operation.path)) throw new Error(`Interrupted create is uncertain: ${operation.path}`); continue; }
        if (operation.kind === "directory") {
          const foreign = (await readdir(join(root, operation.path))).some(name => !created.has(`${operation.path}/${name}`));
          if (foreign) throw new Error(`Owned directory is no longer empty: ${operation.path}`);
        }
      }
      if (!rollingBack) await appendEvent(eventsPath, { type: "rollback_started" });
      for (const operation of [...plan.operations].reverse()) {
        if (!created.has(operation.path)) continue;
        const full = join(root, operation.path);
        const owned = created.get(operation.path);
        if (!owned || await targetState(root, operation) !== "correct" || owned.identity !== await entryIdentity(full, operation.kind)) throw new Error(`Owned entry changed: ${operation.path}`);
        await appendEvent(eventsPath, { type: "remove_intent", path: operation.path, kind: operation.kind });
        if (await targetState(root, operation) !== "correct" || owned.identity !== await entryIdentity(full, operation.kind)) throw new Error(`Owned entry changed: ${operation.path}`);
        if (operation.kind === "file") await rm(full);
        else {
          await rmdir(full);
        }
        await durableDirectory(dirname(full));
        await appendEvent(eventsPath, { type: "removed", path: operation.path, kind: operation.kind });
        created.delete(operation.path);
      }
      await appendEvent(eventsPath, { type: "rolled_back" });
      return { status: "rolled_back", created: [] };
    }
    for (const operation of plan.operations) {
      if (created.has(operation.path)) continue;
      if (intents.has(operation.path) && await targetState(root, operation) !== "missing") throw new Error(`Interrupted create is uncertain: ${operation.path}`);
      if (await targetState(root, operation) !== "missing") throw new Error(`Target already exists: ${operation.path}`);
      if (!intents.has(operation.path)) await appendEvent(eventsPath, { type: "intent", path: operation.path, kind: operation.kind });
      await create(root, operation);
      const ownedIdentity = await entryIdentity(join(root, operation.path), operation.kind);
      await appendEvent(eventsPath, { type: "created", path: operation.path, kind: operation.kind, digest: operation.kind === "file" ? sha(operation.content ?? "") : "directory", identity: ownedIdentity });
      created.set(operation.path, { type: "created", path: operation.path, kind: operation.kind, digest: operation.kind === "file" ? sha(operation.content ?? "") : "directory", identity: ownedIdentity });
    }
    await appendEvent(eventsPath, { type: "completed" });
    return { status: "applied", created: [...created.keys()] };
  } finally { await release(); }
}

export type { OnboardingInspection, TreeEntry };
// Binary trial copying uses the same process-safe root coordinator.
export { lock as acquireOnboardingLock };
