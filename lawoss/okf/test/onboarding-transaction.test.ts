import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { appendFile, lstat, mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { hostname } from "node:os";
import { join } from "node:path";
import { inspectOnboardingRoot } from "../src/onboarding/classify.ts";
import { applyOnboardingPlan, recoverOnboardingPlan, type OnboardingPlan } from "../src/onboarding/transaction.ts";

const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
async function directory(prefix: string) {
  const value = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  paths.push(value);
  return value;
}
async function setup() {
  const root = await directory("okf-root-");
  const journal = await directory("okf-journal-");
  const inspection = await inspectOnboardingRoot(root);
  if (!inspection.digest) throw new Error("Fixture inspection failed.");
  return { root, journal, digest: inspection.digest };
}
async function coordinator(root: string) {
  const base = await realpath(tmpdir());
  const user = typeof process.getuid === "function" ? String(process.getuid()) : "current-user";
  const directory = join(base, `.okf-onboarding-coordinator-${user}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lockPath = join(directory, sha(root));
  paths.push(lockPath);
  return lockPath;
}
const plan = (root: string, treeDigest: string, operations: OnboardingPlan["operations"]): OnboardingPlan => ({ version: 1, root, treeDigest, operations });
async function journalRecord(value: OnboardingPlan) {
  const inspection = await inspectOnboardingRoot(value.root);
  if (!inspection.complete || !inspection.digest) throw new Error("Fixture inspection failed.");
  const identity = sha(JSON.stringify(value));
  return { version: 1 as const, identity, plan: value, baseline: inspection.entries };
}

test("applies once, records ownership, and verifies completed journal files", async () => {
  const { root, journal, digest } = await setup();
  const value = plan(root, digest, [{ path: "matter", kind: "directory" }, { path: "matter/card.md", kind: "file", content: "hello" }]);
  expect(await applyOnboardingPlan(value, journal)).toEqual({ status: "applied", created: ["matter", "matter/card.md"] });
  expect(await readFile(join(root, "matter/card.md"), "utf8")).toBe("hello");
  expect(await applyOnboardingPlan(value, journal)).toEqual({ status: "already_applied", created: ["matter", "matter/card.md"] });
  await writeFile(join(root, "matter/card.md"), "changed");
  await expect(applyOnboardingPlan(value, journal)).rejects.toThrow("Owned entry changed");
});

test("rejects stale scans, existing targets, unsafe paths, and journal overlap", async () => {
  const { root, journal, digest } = await setup();
  await writeFile(join(root, "note.txt"), "new state");
  await expect(applyOnboardingPlan(plan(root, digest, [{ path: "new.md", kind: "file", content: "x" }]), journal)).rejects.toThrow("changed since planning");
  const fresh = await inspectOnboardingRoot(root);
  if (!fresh.digest) throw new Error("Fixture inspection failed.");
  await writeFile(join(root, "exists.md"), "old");
  const current = await inspectOnboardingRoot(root);
  if (!current.digest) throw new Error("Fixture inspection failed.");
  await expect(applyOnboardingPlan(plan(root, current.digest, [{ path: "exists.md", kind: "file", content: "new" }]), journal)).rejects.toThrow("Target already exists");
  await expect(applyOnboardingPlan(plan(root, current.digest, [{ path: "../escape", kind: "file", content: "x" }]), journal)).rejects.toThrow("unsafe operation path");
  await expect(applyOnboardingPlan(plan(root, current.digest, [{ path: "C:/escape", kind: "file", content: "x" }]), journal)).rejects.toThrow("unsafe operation path");
  for (const path of ["wild*card", "newline\nname", "CON.txt", "trailing."]) await expect(applyOnboardingPlan(plan(root, current.digest, [{ path, kind: "file", content: "x" }]), journal)).rejects.toThrow("unsafe operation path");
  await expect(applyOnboardingPlan(plan(root, current.digest, [{ path: "folder", kind: "directory" }, { path: "folder/item.md", kind: "file", content: "x" }]), root)).rejects.toThrow("must not overlap");
});

test("finish recovers a known partial transaction and rollback refuses interrupted ambiguity", async () => {
  const { root, journal, digest } = await setup();
  const value = plan(root, digest, [{ path: "folder", kind: "directory" }, { path: "folder/card.md", kind: "file", content: "hello" }]);
  const record = await journalRecord(value);
  await writeFile(join(journal, `${record.identity}.json`), JSON.stringify(record));
  await mkdir(join(root, "folder"));
  const folderIdentity = await lstat(join(root, "folder"), { bigint: true });
  await writeFile(join(journal, `${record.identity}.events.jsonl`), `${JSON.stringify({ type: "intent", path: "folder", kind: "directory" })}\n${JSON.stringify({ type: "created", path: "folder", kind: "directory", digest: "directory", identity: `${folderIdentity.dev}:${folderIdentity.ino}` })}\n`);
  expect(await recoverOnboardingPlan(value, journal, "finish")).toEqual({ status: "applied", created: ["folder", "folder/card.md"] });
  const uncertain = plan(root, (await inspectOnboardingRoot(root)).digest!, [{ path: "uncertain.md", kind: "file", content: "x" }]);
  const uncertainRecord = await journalRecord(uncertain);
  await writeFile(join(journal, `${uncertainRecord.identity}.json`), JSON.stringify(uncertainRecord));
  await writeFile(join(journal, `${uncertainRecord.identity}.events.jsonl`), `${JSON.stringify({ type: "intent", path: "uncertain.md", kind: "file" })}\n`);
  await expect(recoverOnboardingPlan(uncertain, journal, "rollback")).rejects.toThrow("Interrupted create is uncertain");
});

test("same-root concurrency has one winner and rejects modified rollback ownership", async () => {
  const { root, journal, digest } = await setup();
  const first = plan(root, digest, [{ path: "a.md", kind: "file", content: "a" }]);
  const second = plan(root, digest, [{ path: "b.md", kind: "file", content: "b" }]);
  const results = await Promise.allSettled([applyOnboardingPlan(first, journal), applyOnboardingPlan(second, journal)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  const value = plan(root, (await inspectOnboardingRoot(root)).digest!, [{ path: "owned.md", kind: "file", content: "mine" }]);
  const record = await journalRecord(value);
  await writeFile(join(journal, `${record.identity}.json`), JSON.stringify(record));
  await writeFile(join(root, "owned.md"), "modified");
  await writeFile(join(journal, `${record.identity}.events.jsonl`), `${JSON.stringify({ type: "intent", path: "owned.md", kind: "file" })}\n${JSON.stringify({ type: "created", path: "owned.md", kind: "file", digest: sha("mine"), identity: "0:0:0" })}\n`);
  await expect(recoverOnboardingPlan(value, journal, "rollback")).rejects.toThrow("Owned entry changed");
});

test("creates beneath an inspected existing directory without claiming it", async () => {
  const { root, journal } = await setup();
  await mkdir(join(root, "existing"));
  const inspection = await inspectOnboardingRoot(root);
  if (!inspection.digest) throw new Error("Fixture inspection failed.");
  const value = plan(root, inspection.digest, [{ path: "existing/card.md", kind: "file", content: "new" }]);
  expect(await applyOnboardingPlan(value, journal)).toEqual({ status: "applied", created: ["existing/card.md"] });
  expect(await readFile(join(root, "existing/card.md"), "utf8")).toBe("new");
});

test("an empty crash journal still rejects a changed baseline before writing", async () => {
  const { root, journal, digest } = await setup();
  const value = plan(root, digest, [{ path: "new.md", kind: "file", content: "new" }]);
  const record = await journalRecord(value);
  await writeFile(join(journal, `${record.identity}.json`), JSON.stringify(record));
  await writeFile(join(root, "foreign.md"), "changed after journal");
  await expect(applyOnboardingPlan(value, journal)).rejects.toThrow("changed during transaction");
  await expect(readFile(join(root, "new.md"), "utf8")).rejects.toThrow();
});

test("dead locks are reclaimed but a live same-host lock blocks the root", async () => {
  const { root, journal, digest } = await setup();
  const lockPath = await coordinator(root);
  await writeFile(lockPath, JSON.stringify({ pid: 2_000_000_000, host: hostname(), token: "dead" }));
  const dead = plan(root, digest, [{ path: "dead.md", kind: "file", content: "ok" }]);
  await expect(applyOnboardingPlan(dead, journal)).resolves.toMatchObject({ status: "applied" });
  const other = await setup();
  await writeFile(await coordinator(other.root), JSON.stringify({ pid: process.pid, host: hostname(), token: "live" }));
  await expect(applyOnboardingPlan(plan(other.root, other.digest, [{ path: "blocked.md", kind: "file", content: "x" }]), other.journal)).rejects.toThrow("active");
});

test("preflight finds a later collision without creating an earlier entry", async () => {
  const { root, journal } = await setup();
  await writeFile(join(root, "later.md"), "foreign");
  const inspection = await inspectOnboardingRoot(root);
  if (!inspection.digest) throw new Error("Fixture inspection failed.");
  const value = plan(root, inspection.digest, [{ path: "early.md", kind: "file", content: "new" }, { path: "later.md", kind: "file", content: "new" }]);
  await expect(applyOnboardingPlan(value, journal)).rejects.toThrow("Target already exists");
  await expect(readFile(join(root, "early.md"), "utf8")).rejects.toThrow();
});

async function partialTransaction() {
  const f = await setup();
  await writeFile(join(f.root, "original.txt"), "Original bytes");
  const snapshot = await inspectOnboardingRoot(f.root);
  if (!snapshot.digest) throw new Error("Fixture inspection failed.");
  const value = plan(f.root, snapshot.digest, [{ path: "folder", kind: "directory" }, { path: "folder/new.md", kind: "file", content: "New bytes" }, { path: "later.md", kind: "file", content: "Not written yet" }]);
  const record = await journalRecord(value), events = join(f.journal, `${record.identity}.events.jsonl`);
  await writeFile(join(f.journal, `${record.identity}.json`), JSON.stringify(record));
  await mkdir(join(f.root, "folder"));
  await writeFile(join(f.root, "folder/new.md"), "New bytes");
  for (const operation of value.operations.slice(0, 2)) {
    const state = await lstat(join(f.root, operation.path), { bigint: true });
    const identity = operation.kind === "directory" ? `${state.dev}:${state.ino}` : `${state.dev}:${state.ino}:${state.ctimeNs}`;
    await appendFile(events, JSON.stringify({ type: "intent", path: operation.path, kind: operation.kind }) + "\n" + JSON.stringify({ type: "created", path: operation.path, kind: operation.kind, digest: operation.kind === "directory" ? "directory" : sha(operation.content!), identity }) + "\n");
  }
  return { ...f, value, events, baseline: snapshot.digest };
}

test("rollback removes only owned additions, restores baseline, and remains idempotent", async () => {
  const f = await partialTransaction();
  expect(await recoverOnboardingPlan(f.value, f.journal, "rollback")).toEqual({ status: "rolled_back", created: [] });
  expect((await inspectOnboardingRoot(f.root)).digest).toEqual(f.baseline);
  expect(await recoverOnboardingPlan(f.value, f.journal, "rollback")).toEqual({ status: "rolled_back", created: [] });
  await expect(recoverOnboardingPlan(f.value, f.journal, "finish")).rejects.toThrow();
  expect(await readFile(join(f.root, "original.txt"), "utf8")).toBe("Original bytes");
});

test("rollback resumes after deletion before its completion event", async () => {
  const f = await partialTransaction();
  await appendFile(f.events, JSON.stringify({ type: "rollback_started" }) + "\n" + JSON.stringify({ type: "remove_intent", path: "folder/new.md", kind: "file" }) + "\n");
  await rm(join(f.root, "folder/new.md"));
  await expect(recoverOnboardingPlan(f.value, f.journal, "finish")).rejects.toThrow("Rollback has started");
  expect(await recoverOnboardingPlan(f.value, f.journal, "rollback")).toEqual({ status: "rolled_back", created: [] });
  expect((await inspectOnboardingRoot(f.root)).digest).toEqual(f.baseline);
});

test("same-byte replacement is foreign and cannot be removed by rollback", async () => {
  const f = await partialTransaction();
  await writeFile(join(f.root, "replacement"), "New bytes");
  await rename(join(f.root, "replacement"), join(f.root, "folder/new.md"));
  await expect(recoverOnboardingPlan(f.value, f.journal, "rollback")).rejects.toThrow("Owned entry changed");
  expect(await readFile(join(f.root, "folder/new.md"), "utf8")).toBe("New bytes");
});

test("recovery refuses changed originals before creating or deleting any additions", async () => {
  const f = await partialTransaction();
  await writeFile(join(f.root, "original.txt"), "User changed original");
  for (const action of ["finish", "rollback"] as const) await expect(recoverOnboardingPlan(f.value, f.journal, action)).rejects.toThrow("changed during transaction");
  expect(await readFile(join(f.root, "folder/new.md"), "utf8")).toBe("New bytes");
  expect(await readFile(join(f.root, "original.txt"), "utf8")).toBe("User changed original");
});

test("different journals still serialize a single root", async () => {
  const { root, journal, digest } = await setup();
  const otherJournal = await directory("okf-other-journal-");
  const first = plan(root, digest, [{ path: "first.md", kind: "file", content: "first" }]);
  const second = plan(root, digest, [{ path: "second.md", kind: "file", content: "second" }]);
  const outcomes = await Promise.allSettled([applyOnboardingPlan(first, journal), applyOnboardingPlan(second, otherJournal)]);
  expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
  expect(outcomes.filter(outcome => outcome.status === "rejected")).toHaveLength(1);
});
