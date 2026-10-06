import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, open, readFile, rename, rmdir } from "node:fs/promises";
import { realpath } from "../canonical-path.ts";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { inspectOnboardingRoot, type OnboardingInspection, type TreeEntry } from "./classify.ts";
import { acquireOnboardingLock, applyOnboardingPlan, parseOnboardingPlan, recoverOnboardingPlan, type OnboardingPlan } from "./transaction.ts";
import { syncFile, unlinkFile } from "./file-durability.ts";

export type TrialClone = { source: string; sourceDigest: string; target: string; conversionPlan?: OnboardingPlan };
type Owned = { path: string; kind: "file" | "directory"; identity: string; digest: string | null; size: number };
type Journal = { version: 1; fingerprint: string; preview: TrialClone; sourceEntries: TreeEntry[]; owned: Owned[]; intent?: string; removal?: string; conversionPlan?: OnboardingPlan; phase: "copying" | "converting" | "complete" | "rollback" | "rolled_back" };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const within = (root: string, path: string) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`); };
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";
async function identity(path: string, kind: Owned["kind"]): Promise<string> {
  const stat = await lstat(path, { bigint: true });
  if (stat.isSymbolicLink() || (kind === "directory" ? !stat.isDirectory() : !stat.isFile())) throw new Error("Trial entry type changed.");
  return `${stat.dev}:${stat.ino}${kind === "file" ? `:${stat.ctimeNs}` : ""}`;
}
async function fileDigest(path: string): Promise<string> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const h = createHash("sha256"), buffer = Buffer.alloc(65536); while (true) { const result = await file.read(buffer, 0, buffer.length, null); if (!result.bytesRead) break; h.update(buffer.subarray(0, result.bytesRead)); } return h.digest("hex"); }
  finally { await file.close(); }
}
async function durableWrite(path: string, content: string, replace = false): Promise<void> {
  const temporary = replace ? `${path}.${randomUUID()}.tmp` : path;
  const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
  if (replace) await rename(temporary, path);
}
async function context(preview: TrialClone, journalDirectory: string) {
  for (const path of [preview.source, dirname(preview.target), journalDirectory]) {
    if (!isAbsolute(path) || await realpath(path) !== resolve(path) || !(await lstat(path)).isDirectory()) throw new Error("Trial cloning requires existing canonical directories.");
  }
  if (within(preview.source, preview.target) || within(preview.target, preview.source) || within(preview.source, journalDirectory) || within(journalDirectory, preview.source) || within(preview.target, journalDirectory) || within(journalDirectory, preview.target)) throw new Error("Trial source, target and journal must not overlap.");
  if (!/^[a-f0-9]{64}$/.test(preview.sourceDigest)) throw new Error("Invalid trial source digest.");
  const fingerprint = hash(JSON.stringify(preview));
  return { fingerprint, journalPath: join(journalDirectory, `trial-${fingerprint}.json`) };
}
async function readJournal(path: string, fingerprint: string): Promise<Journal | null> {
  try {
    if (!(await lstat(path)).isFile() || (await lstat(path)).isSymbolicLink()) throw new Error("Unsafe trial journal.");
    const value = JSON.parse(await readFile(path, "utf8")) as Journal;
    if (value.version !== 1 || value.fingerprint !== fingerprint || hash(JSON.stringify(value.preview)) !== fingerprint || !Array.isArray(value.owned)) throw new Error("Invalid trial journal.");
    return value;
  } catch (error) { if (missing(error)) return null; throw error; }
}
async function verifyOwned(preview: TrialClone, journal: Journal, allowConversion = false): Promise<OnboardingInspection> {
  const current = await inspectOnboardingRoot(preview.target);
  if (!current.complete || !current.digest) throw new Error("Trial output cannot be inspected safely.");
  const expected = new Set(journal.owned.map(entry => entry.path));
  const conversionPaths = new Set(allowConversion ? journal.conversionPlan?.operations.map(operation => operation.path) ?? [] : []);
  if (current.entries.some(entry => !expected.has(entry.path) && !conversionPaths.has(entry.path))) throw new Error("Trial contains an unowned entry; preserve it for manual recovery.");
  for (const owned of journal.owned) {
    const path = owned.path ? join(preview.target, owned.path) : preview.target;
    if (await identity(path, owned.kind) !== owned.identity || owned.kind === "file" && await fileDigest(path) !== owned.digest) throw new Error(`Trial entry changed; preserving ${owned.path || "root"}.`);
  }
  return current;
}
/**
 * Rollback maže aj priečinky klonu. Prchavý súbor Windows či Office (`Spisy/~$zmluva.docx` otvoreného
 * dokumentu, `Thumbs.db`) inšpekcia vynechá, no rmdir by na ňom zlyhal až po zmazaní časti klonu.
 * Preto stop pred prvým zmazaním; kopírovanie a apply ich naďalej ignorujú.
 */
function assertNoVolatileEntries(inspection: OnboardingInspection): void {
  const ignored = inspection.ignored ?? [];
  if (ignored.length) throw new Error(`Close open documents in the trial clone and remove leftover Windows or Office files, then retry rollback: ${ignored.slice(0, 5).join(", ")}${ignored.length > 5 ? ` (+${ignored.length - 5} more)` : ""}.`);
}

/** Copy each binary entry exclusively and journal its identity before proceeding. */
export async function applyTrialClone(preview: TrialClone, journalDirectory: string, resume = false): Promise<void> {
  const { fingerprint, journalPath } = await context(preview, journalDirectory);
  const unlock = await acquireOnboardingLock(`${preview.target}.trial-operation`);
  try {
    let journal = await readJournal(journalPath, fingerprint);
    if (journal?.phase === "rolled_back" || journal?.phase === "rollback") throw new Error("Trial rollback started; create a new preview or finish rollback.");
    if (journal?.phase === "complete") {
      await verifyOwned(preview, journal, true);
      if (journal.conversionPlan) await recoverOnboardingPlan(journal.conversionPlan, journalDirectory, "finish");
      return;
    }
    if (journal && !resume) throw new Error("Trial copy was interrupted. Recover with finish or rollback.");
    const source = await inspectOnboardingRoot(preview.source);
    if (!source.complete || source.digest !== preview.sourceDigest) throw new Error("Trial clone source changed since planning.");
    if (!journal) {
      if (source.entries.some(entry => entry.path === ".lawoss-trial.json")) throw new Error("Source is already a trial clone.");
      try { await lstat(preview.target); throw new Error("Trial destination already exists."); } catch (error) { if (!missing(error)) throw error; }
      journal = { version: 1, fingerprint, preview, sourceEntries: source.entries, owned: [], phase: "copying" };
      await durableWrite(journalPath, JSON.stringify(journal));
    }
    const save = () => durableWrite(journalPath, JSON.stringify(journal), true);
    if (journal.owned.length) await verifyOwned(preview, journal, journal.phase === "converting");
    // An intent without a recorded identity is never permission to remove an existing entry.
    if (journal.intent !== undefined && !journal.owned.some(entry => entry.path === journal.intent)) {
      try { await lstat(join(preview.target, journal.intent)); throw new Error("Uncertain trial entry ownership; preserve for manual recovery."); } catch (error) { if (!missing(error)) throw error; }
    }
    if (journal.phase === "copying") {
      const entries: TreeEntry[] = [{ path: "", kind: "directory", digest: null, size: 0 }, ...journal.sourceEntries];
      for (const entry of entries) {
        if (journal.owned.some(owned => owned.path === entry.path)) continue;
        if (entry.kind !== "directory" && entry.kind !== "file") throw new Error("Unsupported trial entry.");
        const target = join(preview.target, entry.path);
        journal.intent = entry.path; await save();
        if (entry.kind === "directory") await mkdir(target);
        else {
          const sourcePath = join(preview.source, entry.path);
          if (await realpath(sourcePath) !== sourcePath || !(await lstat(sourcePath)).isFile()) throw new Error("Trial source entry changed.");
          await copyFile(sourcePath, target, constants.COPYFILE_EXCL);
          if (await fileDigest(target) !== entry.digest) throw new Error("Trial copy digest mismatch.");
          await syncFile(target);
        }
        journal.owned.push({ path: entry.path, kind: entry.kind, identity: await identity(target, entry.kind), digest: entry.digest, size: entry.size });
        delete journal.intent; await save();
      }
      const after = await inspectOnboardingRoot(preview.source);
      if (!after.complete || after.digest !== preview.sourceDigest) throw new Error("Trial clone source changed during copy.");
      const marker = JSON.stringify({ version: 1, trial: true, source: preview.source, sourceDigest: preview.sourceDigest, fingerprint });
      journal.intent = ".lawoss-trial.json"; await save();
      await durableWrite(join(preview.target, journal.intent), marker);
      journal.owned.push({ path: journal.intent, kind: "file", identity: await identity(join(preview.target, journal.intent), "file"), digest: hash(marker), size: Buffer.byteLength(marker) });
      delete journal.intent;
      if (preview.conversionPlan) {
        const inspected = await inspectOnboardingRoot(preview.target);
        if (!inspected.digest) throw new Error("Trial output changed before conversion.");
        journal.conversionPlan = parseOnboardingPlan({ ...preview.conversionPlan, root: preview.target, treeDigest: inspected.digest });
      }
      journal.phase = "converting"; await save();
    }
    if (journal.conversionPlan) {
      if (!resume) await applyOnboardingPlan(journal.conversionPlan, journalDirectory);
      else {
        const conversionJournal = join(journalDirectory, `${hash(JSON.stringify(journal.conversionPlan))}.json`);
        let hasConversionJournal = true;
        try { await lstat(conversionJournal); }
        catch (error) { if (missing(error)) hasConversionJournal = false; else throw error; }
        if (hasConversionJournal) await recoverOnboardingPlan(journal.conversionPlan, journalDirectory, "finish");
        else await applyOnboardingPlan(journal.conversionPlan, journalDirectory);
      }
    }
    journal.phase = "complete"; await save();
  } finally { await unlock(); }
}

export async function recoverTrialClone(preview: TrialClone, journalDirectory: string, action: "finish" | "rollback"): Promise<void> {
  if (action === "finish") return applyTrialClone(preview, journalDirectory, true);
  const { fingerprint, journalPath } = await context(preview, journalDirectory), unlock = await acquireOnboardingLock(`${preview.target}.trial-operation`);
  try {
    const journal = await readJournal(journalPath, fingerprint);
    if (!journal) throw new Error("No trial journal exists.");
    if (journal.phase === "rolled_back") return;
    const save = () => durableWrite(journalPath, JSON.stringify(journal), true);
    if (journal.removal !== undefined) {
      try { await lstat(join(preview.target, journal.removal)); }
      catch (error) { if (!missing(error)) throw error; journal.owned = journal.owned.filter(entry => entry.path !== journal.removal); delete journal.removal; await save(); }
    }
    if (!journal.owned.length) { try { await lstat(preview.target); throw new Error("Uncertain trial root ownership."); } catch (error) { if (!missing(error)) throw error; } }
    else assertNoVolatileEntries(await verifyOwned(preview, journal, true));
    if (journal.conversionPlan) await recoverOnboardingPlan(journal.conversionPlan, journalDirectory, "rollback");
    journal.phase = "rollback"; await save();
    if (journal.owned.length) assertNoVolatileEntries(await verifyOwned(preview, journal));
    while (journal.owned.length) {
      const owned = journal.owned[journal.owned.length - 1]!;
      journal.removal = owned.path; await save();
      const path = join(preview.target, owned.path);
      if (await identity(path, owned.kind) !== owned.identity || owned.kind === "file" && await fileDigest(path) !== owned.digest) throw new Error("Changed trial output; rollback stopped.");
      if (owned.kind === "directory") await rmdir(path); else await unlinkFile(path);
      journal.owned.pop(); delete journal.removal; await save();
    }
    journal.phase = "rolled_back"; await save();
  } finally { await unlock(); }
}
