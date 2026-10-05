import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { inspectOnboardingRoot } from "../src/onboarding/classify.ts";
import { applyOnboarding, parseOnboardingRequest, planOnboarding } from "../src/onboarding/onboarding.ts";
import { applyTrialClone, recoverTrialClone, type TrialClone } from "../src/onboarding/trial-clone.ts";
import type { OnboardingPlan } from "../src/onboarding/transaction.ts";
import { syncFile, unlinkFile } from "../src/onboarding/file-durability.ts";

const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory(prefix: string): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  paths.push(path);
  return path;
}
async function digest(path: string): Promise<string> {
  const inspection = await inspectOnboardingRoot(path);
  if (!inspection.complete || !inspection.digest) throw new Error("Fixture inspection failed.");
  return inspection.digest;
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const trialRequest = (root: string, cloneParent: string) => parseOnboardingRequest({
  action: "existing", root, mode: "trial_clone", cloneParent,
  title: "Trial client", clientType: "po", language: "sk", jurisdiction: "sk", date: "2026-10-03", confirmUnknownClient: true,
});
async function options() { return { journalDirectory: await directory("okf-trial-journal-"), externalProfileDirectory: await directory("okf-trial-external-") }; }

async function simplePreview(source: string, parent: string, name = "trial"): Promise<TrialClone> {
  return { source, sourceDigest: await digest(source), target: join(parent, name) };
}

test("trial clone copies a >4 MiB binary, applies conversion metadata, and is idempotent", async () => {
  const source = await directory("okf-trial-source-");
  const cloneParent = await directory("okf-trial-parent-");
  const binary = Buffer.alloc(4 * 1024 * 1024 + 37);
  for (let index = 0; index < binary.length; index += 8191) binary[index] = index % 251;
  await writeFile(join(source, "evidence.bin"), binary);
  await writeFile(join(source, "notes.txt"), "original notes");
  const before = await digest(source);
  const preview = await planOnboarding(trialRequest(source, cloneParent));
  if (preview.mode !== "trial_clone") throw new Error("Expected trial clone.");
  const runtime = await options();
  await applyOnboarding(preview, runtime);
  expect(await readFile(join(preview.target, "evidence.bin"))).toEqual(binary);
  expect(await readFile(join(preview.target, "client.md"), "utf8")).toContain("client_type: po");
  expect(await readFile(join(preview.target, ".lawoss-trial.json"), "utf8")).toContain(`"source":${JSON.stringify(source)}`);
  expect(await digest(source)).toBe(before);
  await applyOnboarding(preview, runtime);
  expect(await digest(source)).toBe(before);
  expect(await readFile(join(preview.target, "evidence.bin"))).toEqual(binary);
});

test("trial clone leaves out volatile Windows and Office artefacts", async () => {
  const source = await directory("okf-trial-source-volatile-");
  const parent = await directory("okf-trial-parent-volatile-");
  const journal = await directory("okf-trial-journal-volatile-");
  await mkdir(join(source, "Spisy"));
  for (const [path, content] of [["zmluva.docx", "docx"], ["~$zmluva.docx", "owner"], ["Thumbs.db", "thumbs"], ["Spisy/desktop.ini", "ini"], ["Spisy/podanie.pdf", "pdf"]]) await writeFile(join(source, path!), content!);
  const preview = await simplePreview(source, parent, "volatile");
  await applyTrialClone(preview, journal);
  expect(await readFile(join(preview.target, "zmluva.docx"), "utf8")).toBe("docx");
  expect(await readFile(join(preview.target, "Spisy/podanie.pdf"), "utf8")).toBe("pdf");
  for (const path of ["~$zmluva.docx", "Thumbs.db", "Spisy/desktop.ini"]) await expect(lstat(join(preview.target, path))).rejects.toThrow();
  expect(await digest(source)).toBe(preview.sourceDigest);
});

test("trial clone never overwrites an existing target and rejects every containment overlap", async () => {
  const source = await directory("okf-trial-source-");
  const parent = await directory("okf-trial-parent-");
  const journal = await directory("okf-trial-journal-");
  await writeFile(join(source, "source.txt"), "source");
  const preview = await simplePreview(source, parent, "occupied");
  await mkdir(preview.target);
  await writeFile(join(preview.target, "keep.txt"), "keep");
  await expect(applyTrialClone(preview, journal)).rejects.toThrow("destination already exists");
  expect(await readFile(join(preview.target, "keep.txt"), "utf8")).toBe("keep");
  const nestedTarget: TrialClone = { ...preview, target: join(source, "nested") };
  await expect(applyTrialClone(nestedTarget, journal)).rejects.toThrow("must not overlap");
  const journalInsideSource = join(source, "journal");
  await mkdir(journalInsideSource);
  await expect(applyTrialClone({ ...preview, target: join(parent, "other") }, journalInsideSource)).rejects.toThrow("must not overlap");
  await expect(applyTrialClone({ ...preview, target: join(parent, "third") }, parent)).rejects.toThrow("must not overlap");
});

test("trial rollback removes only unchanged owned output and stops for a foreign insertion", async () => {
  const source = await directory("okf-trial-source-");
  const parent = await directory("okf-trial-parent-");
  const journal = await directory("okf-trial-journal-");
  await writeFile(join(source, "original.txt"), "original");
  const removable = await simplePreview(source, parent, "removable");
  await applyTrialClone(removable, journal);
  await recoverTrialClone(removable, journal, "rollback");
  await expect(lstat(removable.target)).rejects.toThrow();
  expect(await readFile(join(source, "original.txt"), "utf8")).toBe("original");

  const guarded = await simplePreview(source, parent, "guarded");
  await applyTrialClone(guarded, journal);
  await writeFile(join(guarded.target, "foreign.txt"), "foreign");
  await expect(recoverTrialClone(guarded, journal, "rollback")).rejects.toThrow("unowned entry");
  expect(await readFile(join(guarded.target, "foreign.txt"), "utf8")).toBe("foreign");
  expect(await readFile(join(guarded.target, "original.txt"), "utf8")).toBe("original");
});

// Windows: CopyFileW skopíruje aj atribút „iba na čítanie“ a fsync potrebuje handle s
// právom zápisu; DeleteFileW taký súbor odmietne. Na Windows test spustí portable-windows.
test("trial clone and rollback handle a read-only document", async () => {
  const source = await directory("okf-trial-source-ro-");
  const parent = await directory("okf-trial-parent-ro-");
  const journal = await directory("okf-trial-journal-ro-");
  await writeFile(join(source, "rozsudok-final.pdf"), "pdf");
  await chmod(join(source, "rozsudok-final.pdf"), 0o444);
  try {
    const preview = await simplePreview(source, parent, "readonly");
    await applyTrialClone(preview, journal);
    const copied = await lstat(join(preview.target, "rozsudok-final.pdf"));
    expect(copied.mode & 0o200).toBe(0);
    expect(await readFile(join(preview.target, "rozsudok-final.pdf"), "utf8")).toBe("pdf");
    await recoverTrialClone(preview, journal, "rollback");
    await expect(lstat(preview.target)).rejects.toThrow();
    expect(await readFile(join(source, "rozsudok-final.pdf"), "utf8")).toBe("pdf");
  } finally { await chmod(join(source, "rozsudok-final.pdf"), 0o644); }
});

test("syncFile and unlinkFile on Windows keep and then clear the read-only attribute", async () => {
  const dir = await directory("okf-durable-");
  const file = join(dir, "a.pdf");
  await writeFile(file, "a");
  await chmod(file, 0o444);
  await syncFile(file, "win32");
  expect((await lstat(file)).mode & 0o200).toBe(0);
  await unlinkFile(file, "win32");
  await expect(lstat(file)).rejects.toThrow();
});

test("trial recovery is conservative for an interrupted unowned root and resumes conversion with no transaction journal", async () => {
  const source = await directory("okf-trial-source-");
  const parent = await directory("okf-trial-parent-");
  const journalDirectory = await directory("okf-trial-journal-");
  await writeFile(join(source, "original.txt"), "original");
  const interrupted = await simplePreview(source, parent, "interrupted");
  const fingerprint = hash(JSON.stringify(interrupted));
  await mkdir(interrupted.target);
  const sourceInspection = await inspectOnboardingRoot(source);
  await writeFile(join(journalDirectory, `trial-${fingerprint}.json`), JSON.stringify({
    version: 1, fingerprint, preview: interrupted, sourceEntries: sourceInspection.entries, owned: [], intent: "", phase: "copying",
  }));
  await expect(recoverTrialClone(interrupted, journalDirectory, "finish")).rejects.toThrow("Uncertain trial entry ownership");
  await expect(recoverTrialClone(interrupted, journalDirectory, "rollback")).rejects.toThrow("Uncertain trial root ownership");
  expect(await lstat(interrupted.target)).toBeDefined();

  const conversionSource = await directory("okf-trial-conversion-source-");
  await writeFile(join(conversionSource, "original.txt"), "original");
  const conversion = await simplePreview(conversionSource, parent, "converting");
  const conversionPlan: OnboardingPlan = { version: 1, root: conversionSource, treeDigest: await digest(conversionSource), operations: [{ path: "client.md", kind: "file", content: "converted" }] };
  conversion.conversionPlan = conversionPlan;
  await applyTrialClone(conversion, journalDirectory);
  const conversionFingerprint = hash(JSON.stringify(conversion));
  const trialJournalPath = join(journalDirectory, `trial-${conversionFingerprint}.json`);
  const trialJournal = JSON.parse(await readFile(trialJournalPath, "utf8"));
  const appliedPlan = trialJournal.conversionPlan as OnboardingPlan;
  await rm(join(conversion.target, "client.md"));
  const conversionIdentity = hash(JSON.stringify(appliedPlan));
  await rm(join(journalDirectory, `${conversionIdentity}.json`));
  await rm(join(journalDirectory, `${conversionIdentity}.events.jsonl`));
  trialJournal.phase = "converting";
  await writeFile(trialJournalPath, JSON.stringify(trialJournal));
  await recoverTrialClone(conversion, journalDirectory, "finish");
  expect(await readFile(join(conversion.target, "client.md"), "utf8")).toBe("converted");
});
