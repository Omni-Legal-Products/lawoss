/**
 * Zápis schváleného plánu roztriedenia a jeho vrátenie. Len v overenom skúšobnom klone.
 *
 * Nič sa nemaže ani neprepisuje: dokument sa presúva v rámci klona (pevný odkaz a odstránenie
 * pôvodného mena, kde súborový systém pevné odkazy nevie, overená kópia), cieľ nesmie existovať.
 * Každý krok má záznam v `.lawoss/triage/runs/<runId>/events.jsonl` (fsync), takže prerušený beh
 * sa dá dokončiť rovnakým príkazom alebo vrátiť. Vrátenie obnoví presne pôvodný strom; ak niekto
 * medzitým zmenil presunutý dokument alebo pridal súbor do novej veci, nevráti nič a povie čo.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { appendFile, copyFile, link, lstat, mkdir, open, readdir, readFile, rmdir } from "node:fs/promises";
import { realpath } from "../canonical-path.ts";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { acquireOnboardingLock, parseOnboardingPlan, type CreateOperation } from "../onboarding/transaction.ts";
import { inspectOnboardingRoot, type InspectionHooks } from "../onboarding/classify.ts";
import { syncFile, unlinkFile } from "../onboarding/file-durability.ts";
import { planFingerprint, sha256 } from "./plan.ts";
import { TRIAGE_ROLES } from "./rules.ts";
import { onlyLockedIssues, TRIAGE_DIR, triageTreeDigest, verifyTriageTarget } from "./scan.ts";
import { PLAN_SCHEMA, type TriageMove, type TriagePlan } from "./types.ts";

export class TriageConflictError extends Error { readonly code = "triage_conflict"; }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";
const errorCode = (error: unknown) => error instanceof Error && "code" in error ? String(error.code) : "";
const RUN_ID = /^triage-[0-9]{8}-[0-9]{6}-[a-f0-9]{6}$/;
const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function invalid(message: string): never { throw new Error(`Neplatný plán roztriedenia: ${message}`); }
/** `.keep` drží prázdny pracovný priečinok novej veci; iný skrytý názov plán nesmie obsahovať. */
function safeRelative(value: unknown, where: string, allowKeep = false): string {
  if (typeof value !== "string" || !value || value.length > 1024 || value.includes("\0") || value.includes("\\") || isAbsolute(value) || /^[a-z]:/i.test(value)) invalid(`${where} nie je bezpečná relatívna cesta`);
  const parts = value.split("/");
  if (parts.some((part, index) => !part || part.length > 255 || part === "." || part === ".." || (part.startsWith(".") && !(allowKeep && part === ".keep" && index === parts.length - 1)) || /[<>:"|?*\u0000-\u001f\u007f-\u009f]/.test(part) || /[. ]$/.test(part) || reserved.test(part))) invalid(`${where} nie je bezpečná relatívna cesta`);
  return value;
}

/** Plán zo súboru alebo od volajúceho sa overí celý vrátane odtlačku; nič z neho sa nepoužije naslepo. */
export function parseTriagePlan(value: unknown): TriagePlan {
  if (!record(value) || value.schema !== PLAN_SCHEMA) invalid("schema");
  if (typeof value.runId !== "string" || !RUN_ID.test(value.runId)) invalid("runId");
  if (typeof value.root !== "string" || !isAbsolute(value.root) || resolve(value.root) !== value.root) invalid("root");
  if (typeof value.treeDigest !== "string" || !/^[a-f0-9]{64}$/.test(value.treeDigest)) invalid("treeDigest");
  if (typeof value.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.fingerprint)) invalid("fingerprint");
  if (!Array.isArray(value.create) || !Array.isArray(value.moves) || !Array.isArray(value.stays) || !Array.isArray(value.matters)) invalid("zoznamy");
  if (value.moves.length > 5000 || value.matters.length > 100) invalid("príliš veľa položiek");
  // Rovnaké pravidlá ciest, poradia rodičov a limitov obsahu ako pri zakladaní klienta a veci.
  const create = parseOnboardingPlan({ version: 1, root: value.root, treeDigest: value.treeDigest, operations: value.create }).operations;
  for (const operation of create) safeRelative(operation.path, "create.path", operation.kind === "file");
  const ids = new Set<string>(), sources = new Set<string>(), targets = new Set<string>();
  const created = new Set(create.map(operation => operation.path.toLocaleLowerCase()));
  for (const [index, move] of value.moves.entries()) {
    const where = `moves[${index}]`;
    if (!record(move) || typeof move.id !== "string" || !/^d[a-f0-9]{16}$/.test(move.id)) invalid(`${where}.id`);
    const from = safeRelative(move.from, `${where}.from`), to = safeRelative(move.to, `${where}.to`);
    if (typeof move.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(move.sha256) || !Number.isSafeInteger(move.size) || (move.size as number) < 0) invalid(`${where}.sha256`);
    if (!TRIAGE_ROLES.some(role => role === move.role)) invalid(`${where}.role`);
    if (ids.has(move.id) || sources.has(from.toLocaleLowerCase()) || targets.has(to.toLocaleLowerCase()) || created.has(to.toLocaleLowerCase())) invalid(`${where} sa opakuje`);
    ids.add(move.id); sources.add(from.toLocaleLowerCase()); targets.add(to.toLocaleLowerCase());
  }
  for (const target of targets) if (sources.has(target)) invalid("cieľ presunu je zároveň zdrojom iného presunu");
  // Typy sú overené vyššie; spätné zostavenie z JSON by len opakovalo tie isté kontroly.
  const plan = value as TriagePlan;
  if (planFingerprint(plan) !== plan.fingerprint) invalid("odtlačok nesedí; plán bol zmenený po náhľade");
  return plan;
}

type Event = { t: "intent" | "created" | "move_intent" | "moved" | "completed" | "undo_started" | "restore_intent" | "restored" | "remove_intent" | "removed" | "undone"; path?: string; id?: string };
const EVENT_TYPES = new Set<Event["t"]>(["intent", "created", "move_intent", "moved", "completed", "undo_started", "restore_intent", "restored", "remove_intent", "removed", "undone"]);

async function durableDirectory(path: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function appendEvent(path: string, event: Event): Promise<void> {
  const handle = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(`${JSON.stringify(event)}\n`); await handle.sync(); } finally { await handle.close(); }
}
/**
 * Riadok môže byť pri páde neúplný; taký sa ignoruje a rozhodne skutočný stav súborov.
 * Neúplný koniec sa pred ďalším zápisom uzavrie novým riadkom, aby sa nespojil s ďalšou udalosťou.
 */
async function readEvents(path: string): Promise<Event[]> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch (error) { if (missing(error)) return []; throw error; }
  if (raw && !raw.endsWith("\n")) await appendFile(path, "\n");
  const events: Event[] = [];
  for (const line of raw.split("\n").filter(Boolean)) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { continue; }
    if (!record(value) || typeof value.t !== "string" || !EVENT_TYPES.has(value.t as Event["t"])) throw new Error("Záznam roztriedenia je poškodený.");
    events.push({ t: value.t as Event["t"], ...(typeof value.path === "string" ? { path: value.path } : {}), ...(typeof value.id === "string" ? { id: value.id } : {}) });
  }
  return events;
}

/** Priečinok záznamov v klone; každá úroveň musí byť skutočný priečinok, nie odkaz von. */
async function runDirectory(root: string, runId: string, create: boolean): Promise<string> {
  let current = root;
  for (const part of [...TRIAGE_DIR.split("/"), "runs", runId]) {
    current = join(current, part);
    if (create) { try { await mkdir(current, { mode: 0o700 }); } catch (error) { if (errorCode(error) !== "EEXIST") throw error; } }
    const state = await lstat(current);
    if (!state.isDirectory() || state.isSymbolicLink() || await realpath(current) !== current) throw new Error("Priečinok záznamov roztriedenia nie je bezpečný.");
  }
  return current;
}

/** Rodič cieľa musí byť skutočný priečinok v klone; symbolický odkaz kdekoľvek na ceste sa odmietne. */
async function safeParent(root: string, relativePath: string): Promise<string> {
  const full = join(root, relativePath), parent = dirname(full);
  const state = await lstat(parent);
  if (!state.isDirectory() || state.isSymbolicLink() || await realpath(parent) !== parent) throw new TriageConflictError(`Cesta ${relativePath} vedie cez symbolický odkaz alebo neexistujúci priečinok.`);
  return full;
}
async function fileDigest(path: string): Promise<string | null> {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if (missing(error)) return null; if (errorCode(error) === "ELOOP") throw new TriageConflictError(`Symbolický odkaz: ${path}`); throw error; }
  try {
    if (!(await handle.stat()).isFile()) throw new TriageConflictError(`Nie je obyčajný súbor: ${path}`);
    const hash = createHash("sha256"), buffer = Buffer.alloc(65536);
    while (true) { const read = await handle.read(buffer, 0, buffer.length, null); if (!read.bytesRead) break; hash.update(buffer.subarray(0, read.bytesRead)); }
    return hash.digest("hex");
  } finally { await handle.close(); }
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if (missing(error)) return false; throw error; }
}

/** Presun bez prepisu: pevný odkaz zlyhá, ak cieľ existuje. Bez podpory pevných odkazov overená výhradná kópia. */
async function moveExclusive(source: string, target: string, digest: string): Promise<void> {
  try { await link(source, target); }
  catch (error) {
    const code = errorCode(error);
    if (code === "EEXIST") throw new TriageConflictError(`Cieľ už existuje: ${target}`);
    if (!["EXDEV", "EPERM", "ENOTSUP", "EOPNOTSUPP", "EMLINK", "ENOSYS", "EACCES"].includes(code)) throw error;
    await copyFile(source, target, constants.COPYFILE_EXCL);
    await syncFile(target);
  }
  if (await fileDigest(target) !== digest) throw new TriageConflictError(`Kópia ${target} nesedí s originálom.`);
  await durableDirectory(dirname(target));
  if (await fileDigest(source) !== digest) throw new TriageConflictError(`Zdroj ${source} sa zmenil počas presunu.`);
  await unlinkFile(source);
  await durableDirectory(dirname(source));
}

async function createOperation(root: string, operation: CreateOperation): Promise<void> {
  const full = await safeParent(root, operation.path);
  if (operation.kind === "directory") await mkdir(full);
  else {
    const handle = await open(full, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
    try { await handle.writeFile(operation.content ?? ""); await handle.sync(); } finally { await handle.close(); }
  }
  await durableDirectory(dirname(full));
}
/** Stav cieľa operácie: chýba, je presne ten náš, alebo je tam niečo iné. */
async function operationState(root: string, operation: CreateOperation): Promise<"missing" | "ours" | "other"> {
  const full = join(root, operation.path);
  let state;
  try { state = await lstat(full); } catch (error) { if (missing(error)) return "missing"; throw error; }
  if (state.isSymbolicLink()) return "other";
  if (operation.kind === "directory") return state.isDirectory() ? "ours" : "other";
  return state.isFile() && await fileDigest(full) === sha256(operation.content ?? "") ? "ours" : "other";
}

export type TriageApplyResult = { status: "applied" | "already_applied"; runId: string; moved: number; created: number; journal: string };
export type TriageUndoResult = { status: "undone" | "already_undone"; runId: string; restored: number; removed: number };

/** Zapíše schválený plán. Opakované volanie s tým istým plánom dokončí prerušený beh. */
export async function applyTriagePlan(input: unknown, options: { trialJournalDirectory?: string; hooks?: InspectionHooks } = {}): Promise<TriageApplyResult> {
  const plan = parseTriagePlan(input);
  const clone = await verifyTriageTarget(plan.root, options.trialJournalDirectory);
  const root = clone.root;
  const unlock = await acquireOnboardingLock(root);
  try {
    const dir = await runDirectory(root, plan.runId, true);
    const planPath = join(dir, "plan.json"), eventsPath = join(dir, "events.jsonl");
    let stored: unknown;
    try { stored = JSON.parse(await readFile(planPath, "utf8")); } catch (error) { if (!missing(error)) throw error; }
    let events = await readEvents(eventsPath);
    if (stored !== undefined) {
      if (!record(stored) || stored.fingerprint !== plan.fingerprint) throw new TriageConflictError("Pod týmto označením už existuje iný beh roztriedenia.");
      if (events.some(event => event.t === "undo_started" || event.t === "undone")) throw new TriageConflictError("Tento beh roztriedenia bol vrátený. Pripravte nový náhľad.");
      if (events.some(event => event.t === "completed")) {
        for (const move of plan.moves) if (await fileDigest(join(root, move.to)) !== move.sha256) throw new TriageConflictError(`Roztriedený dokument sa odvtedy zmenil: ${move.to}`);
        return { status: "already_applied", runId: plan.runId, moved: plan.moves.length, created: plan.create.length, journal: dir };
      }
    } else {
      // Prvý zápis: strom klona musí byť presne ten, z ktorého vznikol náhľad.
      const inspection = await inspectOnboardingRoot(root, {}, options.hooks);
      if ((!inspection.complete && !onlyLockedIssues(inspection)) || triageTreeDigest(inspection.entries) !== plan.treeDigest) throw new TriageConflictError("Priečinok sa od náhľadu zmenil. Pripravte nový náhľad.");
      const paths = new Map(inspection.entries.map(entry => [entry.path.toLocaleLowerCase(), entry]));
      const plannedDirectories = new Set(plan.create.filter(operation => operation.kind === "directory").map(operation => operation.path.toLocaleLowerCase()));
      for (const operation of plan.create) if (paths.has(operation.path.toLocaleLowerCase())) throw new TriageConflictError(`Cieľ už existuje: ${operation.path}`);
      for (const move of plan.moves) {
        const source = paths.get(move.from.toLocaleLowerCase());
        if (!source || source.kind !== "file" || source.path !== move.from || source.digest !== move.sha256) throw new TriageConflictError(`Dokument sa zmenil alebo chýba: ${move.from}`);
        if (paths.has(move.to.toLocaleLowerCase())) throw new TriageConflictError(`Cieľ už existuje: ${move.to}`);
        const parent = move.to.split("/").slice(0, -1).join("/").toLocaleLowerCase();
        if (parent && paths.get(parent)?.kind !== "directory" && !plannedDirectories.has(parent)) throw new TriageConflictError(`Chýba cieľový priečinok: ${move.to}`);
      }
      const handle = await open(planPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(JSON.stringify(plan, null, 2) + "\n"); await handle.sync(); } finally { await handle.close(); }
      await durableDirectory(dir);
      events = [];
    }
    const createdPaths = new Set(events.filter(event => event.t === "created").map(event => event.path));
    const intents = new Set(events.filter(event => event.t === "intent").map(event => event.path));
    for (const operation of plan.create) {
      if (createdPaths.has(operation.path)) continue;
      const state = await operationState(root, operation);
      if (state === "other" || (state === "ours" && !intents.has(operation.path))) throw new TriageConflictError(`Cieľ už existuje: ${operation.path}`);
      if (!intents.has(operation.path)) await appendEvent(eventsPath, { t: "intent", path: operation.path });
      if (state === "missing") await createOperation(root, operation);
      await appendEvent(eventsPath, { t: "created", path: operation.path });
    }
    const moved = new Set(events.filter(event => event.t === "moved").map(event => event.id));
    const moveIntents = new Set(events.filter(event => event.t === "move_intent").map(event => event.id));
    for (const move of plan.moves) {
      if (moved.has(move.id)) continue;
      const source = await safeParent(root, move.from), target = await safeParent(root, move.to);
      const [from, to] = [await fileDigest(source), await fileDigest(target)];
      const started = moveIntents.has(move.id);
      if (from === move.sha256 && to === null) {
        if (!started) await appendEvent(eventsPath, { t: "move_intent", id: move.id });
        await moveExclusive(source, target, move.sha256);
      } else if (started && from === move.sha256 && to === move.sha256) { await unlinkFile(source); await durableDirectory(dirname(source)); }
      else if (!(started && from === null && to === move.sha256)) throw new TriageConflictError(to !== null && !started ? `Cieľ už existuje: ${move.to}` : `Dokument sa zmenil alebo chýba: ${move.from}`);
      await appendEvent(eventsPath, { t: "moved", id: move.id });
    }
    await appendEvent(eventsPath, { t: "completed" });
    return { status: "applied", runId: plan.runId, moved: plan.moves.length, created: plan.create.length, journal: dir };
  } finally { await unlock(); }
}

async function readRun(root: string, runId: string): Promise<{ plan: TriagePlan; events: Event[]; eventsPath: string; dir: string }> {
  if (!RUN_ID.test(runId)) throw new Error("Neplatné označenie behu roztriedenia.");
  let dir;
  try { dir = await runDirectory(root, runId, false); } catch (error) { if (missing(error)) throw new Error("Takýto beh roztriedenia v klone nie je."); throw error; }
  const plan = parseTriagePlan(JSON.parse(await readFile(join(dir, "plan.json"), "utf8")));
  if (plan.root !== root || plan.runId !== runId) throw new Error("Záznam roztriedenia patrí inému priečinku.");
  const eventsPath = join(dir, "events.jsonl");
  return { plan, events: await readEvents(eventsPath), eventsPath, dir };
}

/**
 * Vráti celý beh: dokumenty na pôvodné miesta, potom odstráni len to, čo beh sám vytvoril.
 * Najprv overí všetko; ak by vrátenie čokoľvek cudzie zmenilo, neurobí nič.
 */
export async function undoTriage(rootInput: string, runId: string, options: { trialJournalDirectory?: string } = {}): Promise<TriageUndoResult> {
  const clone = await verifyTriageTarget(rootInput, options.trialJournalDirectory);
  const root = clone.root;
  const unlock = await acquireOnboardingLock(root);
  try {
    const { plan, events, eventsPath } = await readRun(root, runId);
    if (events.some(event => event.t === "undone")) return { status: "already_undone", runId, restored: 0, removed: 0 };
    const restored = new Set(events.filter(event => event.t === "restored").map(event => event.id));
    const removed = new Set(events.filter(event => event.t === "removed").map(event => event.path));
    const moveIntents = new Set(events.filter(event => event.t === "move_intent").map(event => event.id));
    const createIntents = new Set(events.filter(event => event.t === "intent").map(event => event.path));
    // Presuny, ktoré sa začali (aj prerušené), a ich skutočný stav na disku.
    type Pending = { move: TriageMove; from: string | null; to: string | null };
    const pending: Pending[] = [];
    const problems: string[] = [];
    for (const move of plan.moves) {
      if (!moveIntents.has(move.id) || restored.has(move.id)) continue;
      const from = await fileDigest(join(root, move.from)), to = await fileDigest(join(root, move.to));
      if (to !== null && to !== move.sha256) problems.push(move.to);
      else if (from !== null && from !== move.sha256) problems.push(move.from);
      else if (from === null && to === null) problems.push(move.to);
      else pending.push({ move, from, to });
    }
    const owned = new Set<string>([...pending.filter(item => item.to !== null).map(item => item.move.to.toLocaleLowerCase())]);
    const toRemove = plan.create.filter(operation => createIntents.has(operation.path) && !removed.has(operation.path));
    for (const operation of toRemove) owned.add(operation.path.toLocaleLowerCase());
    for (const operation of toRemove) {
      const state = await operationState(root, operation);
      if (state === "other") problems.push(operation.path);
      if (state === "ours" && operation.kind === "directory") {
        for (const name of await readdir(join(root, operation.path))) if (!owned.has(`${operation.path}/${name}`.toLocaleLowerCase())) problems.push(`${operation.path}/${name}`);
      }
    }
    for (const item of pending) if (item.from === null && !(await lstat(dirname(join(root, item.move.from))).then(state => state.isDirectory() && !state.isSymbolicLink()).catch(() => false))) problems.push(dirname(item.move.from));
    if (problems.length) throw new TriageConflictError(`Roztriedenie sa nedá vrátiť bez zásahu do zmenených súborov: ${[...new Set(problems)].slice(0, 10).join(", ")}${problems.length > 10 ? " …" : ""}`);
    if (!events.some(event => event.t === "undo_started")) await appendEvent(eventsPath, { t: "undo_started" });
    let restoredCount = 0, removedCount = 0;
    for (const { move, from, to } of [...pending].reverse()) {
      const source = await safeParent(root, move.to), target = await safeParent(root, move.from);
      await appendEvent(eventsPath, { t: "restore_intent", id: move.id });
      if (from === null && to !== null) await moveExclusive(source, target, move.sha256);
      else if (from !== null && to !== null) { await unlinkFile(source); await durableDirectory(dirname(source)); }
      await appendEvent(eventsPath, { t: "restored", id: move.id });
      restoredCount++;
    }
    for (const operation of [...toRemove].reverse()) {
      const full = join(root, operation.path);
      await appendEvent(eventsPath, { t: "remove_intent", path: operation.path });
      const state = await operationState(root, operation);
      if (state === "ours") { if (operation.kind === "directory") await rmdir(full); else await unlinkFile(full); await durableDirectory(dirname(full)); }
      else if (state === "other") throw new TriageConflictError(`Zmenené počas vrátenia: ${operation.path}`);
      await appendEvent(eventsPath, { t: "removed", path: operation.path });
      removedCount++;
    }
    await appendEvent(eventsPath, { t: "undone" });
    return { status: "undone", runId, restored: restoredCount, removed: removedCount };
  } finally { await unlock(); }
}

export type TriageRunStatus = { runId: string; createdAt: string; state: "applied" | "interrupted" | "undone" | "undoing" | "planned"; moves: number; matters: number; fingerprint: string };

/** Behy roztriedenia v klone, najnovší prvý. Iba čítanie. */
export async function listTriageRuns(rootInput: string): Promise<TriageRunStatus[]> {
  const root = resolve(rootInput);
  const runs = join(root, TRIAGE_DIR, "runs");
  let names: string[];
  try {
    const state = await lstat(runs);
    if (!state.isDirectory() || state.isSymbolicLink()) return [];
    names = await readdir(runs);
  } catch (error) { if (missing(error)) return []; throw error; }
  const result: TriageRunStatus[] = [];
  for (const name of names.filter(item => RUN_ID.test(item))) {
    try {
      const { plan, events } = await readRun(root, name);
      const state = events.some(event => event.t === "undone") ? "undone" : events.some(event => event.t === "undo_started") ? "undoing" : events.some(event => event.t === "completed") ? "applied" : events.length ? "interrupted" : "planned";
      result.push({ runId: name, createdAt: plan.createdAt, state, moves: plan.moves.length, matters: plan.matters.length, fingerprint: plan.fingerprint });
    } catch { /* Poškodený alebo cudzí záznam sa v zozname neukáže; ostáva na disku na posúdenie. */ }
  }
  return result.sort((a, b) => b.runId.localeCompare(a.runId));
}

/** Označenie behu z času a náhody; zoradí sa podľa času. */
export function newRunId(now: Date = new Date(), random: string = sha256(`${now.toISOString()}:${Math.random()}`)): string {
  const iso = now.toISOString();
  return `triage-${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 19).replace(/:/g, "")}-${random.slice(0, 6)}`;
}
export { exists as pathExists };
