import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watch } from "node:fs";
import * as watches from "node:fs";
import * as files from "node:fs/promises";
import { once } from "node:events";

async function implementation() {
  return import("./windows-skill-locks.js").catch(error => { if (error.code === "ERR_MODULE_NOT_FOUND") return null; throw error; });
}

test("Windows lock receipts discard private metadata and validate fixed owner counts", async () => {
  const module = await implementation();
  expect(typeof module?.projectWindowsSkillLocks).toBe("function");
  const receipt = module!.projectWindowsSkillLocks({ status: "complete", win32Status: 0, files: 1,
    owners: { ownTest: 1, bun: 0, node: 0, antimalware: 0, indexer: 0, shell: 0, other: 2, secretProcess: 999 },
    path: "private-profile", commandLine: "credential-secret", pid: 123, error: "private error" });
  expect(receipt).toEqual({ status: "complete", win32Status: 0, files: 1,
    owners: { ownTest: 1, bun: 0, node: 0, antimalware: 0, indexer: 0, shell: 0, other: 2 } });
  expect(JSON.stringify(receipt)).not.toMatch(/private|secret|credential|commandLine|pid|path/);
  expect(module!.projectWindowsSkillLocks({ status: "complete", files: 999, win32Status: 0 })).toEqual({ status: "invalid" });
});

test("diagnostic children have a strict deadline and never expose stderr", async () => {
  const module = await implementation();
  expect(typeof module?.runBoundedLockProbe).toBe("function");
  const result = await module!.runBoundedLockProbe(process.execPath,
    ["-e", "process.stderr.write('credential-secret');setInterval(()=>{},1000)"], "{}", 50);
  expect(result).toEqual({ status: "timeout" });
  expect(JSON.stringify(result)).not.toMatch(/credential|secret/);
});

test("passive promotion observation preserves real rename arguments and its original failure", async () => {
  const module = await implementation();
  expect(typeof module?.observeSyntheticSkillPromotion).toBe("function");
  const root = await mkdtemp(join(tmpdir(), "lawoss-auth-boundary-"));
  const source = join(root, "workspace/.opencode/skills/synthetic"), destination = join(root, "workspace/.opencode/skills/workflow-assistant-synthetic");
  await mkdir(source, { recursive: true }); await mkdir(destination, { recursive: true });
  await mkdir(join(source, "resources"));
  await writeFile(join(source, "SKILL.md"), "synthetic source"); await writeFile(join(destination, "keep.md"), "destination stays");
  let original: unknown;
  const observer = module!.observeSyntheticSkillPromotion(root, async (_snapshot, error) => { original = error; throw new Error("diagnostic failure must not replace rename failure"); });
  const sourceWatch = watch(source, { persistent: false }), descendantWatch = watch(join(source, "resources"), { persistent: false });
  try {
    expect(observer.snapshot().watchers).toEqual({ source: 1, descendants: 1, ancestors: 0 });
    const failure = await rename(source, destination).then(() => null, error => error);
    expect(failure).toBe(original);
    expect(observer.snapshot().renameAttempts).toBe(1);
    expect(observer.snapshot().active).toEqual([]);
    expect(JSON.stringify(observer.snapshot())).not.toContain(root);
    expect(await readFile(join(source, "SKILL.md"), "utf8")).toBe("synthetic source");
    expect(await readFile(join(destination, "keep.md"), "utf8")).toBe("destination stays");
    const closed = Promise.all([once(sourceWatch, "close"), once(descendantWatch, "close")]);
    sourceWatch.close(); descendantWatch.close(); await closed;
    expect(observer.snapshot().watchers).toEqual({ source: 0, descendants: 0, ancestors: 0 });
    await rm(destination, { recursive: true });
    await rename(source, destination);
    expect(await readFile(join(destination, "SKILL.md"), "utf8")).toBe("synthetic source");
    expect(observer.snapshot().renameAttempts).toBe(2);
  } finally { sourceWatch.close(); descendantWatch.close(); observer.restore(); await rm(root, { recursive: true, force: true }); }
});

test("rename-only diagnosis leaves watch and reads untouched and preserves each real rename", async () => {
  const module = await implementation();
  const root = await mkdtemp(join(tmpdir(), "lawoss-auth-boundary-"));
  const source = join(root, "workspace/.opencode/skills/synthetic"), destination = join(root, "workspace/.opencode/skills/workflow-assistant-synthetic");
  await mkdir(source, { recursive: true }); await mkdir(destination, { recursive: true });
  await writeFile(join(source, "SKILL.md"), "source bytes"); await writeFile(join(destination, "keep.md"), "keep bytes");
  const originalWatch = watches.watch, originalReadFile = files.readFile, originalReaddir = files.readdir;
  let original: unknown;
  const observer = module!.observeSyntheticSkillPromotion(root, async (_snapshot, error) => { original = error; throw new Error("probe failure"); }, "rename-only");
  try {
    expect(watches.watch).toBe(originalWatch);
    expect(files.readFile).toBe(originalReadFile);
    expect(files.readdir).toBe(originalReaddir);
    const failure = await files.rename(source, destination).then(() => null, error => error);
    expect(failure).toBe(original);
    expect(observer.snapshot()).toEqual({ observation: "rename-only", renameAttempts: 1, watchers: null, active: null });
    expect(await readFile(join(source, "SKILL.md"), "utf8")).toBe("source bytes");
    expect(await readFile(join(destination, "keep.md"), "utf8")).toBe("keep bytes");
    await rm(destination, { recursive: true });
    await files.rename(source, destination);
    expect(observer.snapshot().renameAttempts).toBe(2);
    expect(await readFile(join(destination, "SKILL.md"), "utf8")).toBe("source bytes");
  } finally { observer.restore(); await rm(root, { recursive: true, force: true }); }
});
