import { symlinkSkipReason } from "../../tests/symlink-capability.mts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.ts";
import { newRecord, serializeRecord, statusSkeleton, syncStatus, writeIndex, writeLog } from "../src/index.ts";
const fileSymlinkSkip = symlinkSkipReason("file");
const dirSymlinkSkip = symlinkSkipReason("dir");

function setup(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "okf-safe-projections-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const client = join(root, "Client");
  const matter = join(client, "Spisy", "Case");
  for (const dir of [client, matter]) mkdirSync(join(dir, "memory"), { recursive: true });
  writeFileSync(join(client, "client.md"), "---\ntype: client\n---\n");
  writeFileSync(join(matter, "memory", "Q-001.md"), serializeRecord(newRecord({
    id: "Q-001", type: "question", jurisdiction: "sk", title: "Question", description: "Context", truth: "Keep me.",
    created: "2026-09-20", updated: "2026-09-20", timeline: [{ date: "2026-09-20", text: "Created" }],
  })));
  const targets = [join(matter, "_STATUS.md"), join(matter, "memory", "index.md"), join(matter, "memory", "log.md"), join(client, "memory", "index.md"), join(client, "memory", "log.md")];
  for (const path of targets) writeFileSync(path, path.endsWith("_STATUS.md") ? statusSkeleton("sk") : "prior projection\n");
  const external = join(root, "external.md");
  writeFileSync(external, "External source must remain untouched.\n");
  return { client, matter, targets, external };
}

for (const targetIndex of [0, 1, 2, 3, 4]) {
  test(`sync rejects projection symlink ${targetIndex} before mutating any matter or client projection`, { skip: fileSymlinkSkip }, (t) => {
    const { matter, targets, external } = setup(t);
    const target = targets[targetIndex]!;
    rmSync(target);
    symlinkSync(external, target);
    const before = targets.map((path) => readFileSync(path, "utf8"));
    const result = runCli(["sync", matter, "--apply"]);
    assert.equal(readFileSync(external, "utf8"), "External source must remain untouched.\n");
    assert.equal(result.code, 1, result.out);
    assert.match(result.out, /symlink|symbolic|symbolick/i);
    assert.deepEqual(targets.map((path) => readFileSync(path, "utf8")), before);
  });
}

for (const projection of ["index.md", "log.md"]) {
  test(`sync rejects a client ${projection} directory before changing matter status`, (t) => {
    const { matter, client, targets } = setup(t);
    const target = join(client, "memory", projection);
    rmSync(target); mkdirSync(target);
    const before = readFileSync(targets[0]!, "utf8");
    assert.equal(runCli(["sync", matter, "--apply"]).code, 1);
    assert.equal(readFileSync(targets[0]!, "utf8"), before);
  });
}

test("sync rejects a symlinked memory directory before any writes", { skip: dirSymlinkSkip }, (t) => {
  const { matter, client, targets, external } = setup(t);
  const externalMemory = join(client, "external-memory");
  mkdirSync(externalMemory);
  writeFileSync(join(externalMemory, "index.md"), "outside index");
  writeFileSync(join(externalMemory, "log.md"), "outside log");
  rmSync(join(client, "memory"), { recursive: true });
  symlinkSync(externalMemory, join(client, "memory"), "dir");
  const before = readFileSync(targets[0]!, "utf8");
  assert.equal(runCli(["sync", matter, "--apply"]).code, 1);
  assert.equal(readFileSync(targets[0]!, "utf8"), before);
  assert.equal(readFileSync(join(externalMemory, "index.md"), "utf8"), "outside index");
  assert.equal(readFileSync(join(externalMemory, "log.md"), "utf8"), "outside log");
  assert.equal(readFileSync(external, "utf8"), "External source must remain untouched.\n");
});

for (const [name, write] of [["_STATUS.md", syncStatus], ["memory/index.md", writeIndex], ["memory/log.md", writeLog]] as const) {
  test(`standalone ${name} writer rejects dangling symlinks`, { skip: fileSymlinkSkip }, (t) => {
    const { matter, external } = setup(t);
    const missing = external + ".missing";
    const target = join(matter, name);
    rmSync(target); symlinkSync(missing, target);
    assert.throws(() => write(matter), /symlink|symbolic|symbolick/i);
  });
}

test("ordinary regular projection files continue to sync successfully", (t) => {
  const { matter, targets } = setup(t);
  const result = runCli(["sync", matter, "--apply"]);
  assert.equal(result.code, 0, result.out);
  assert.match(readFileSync(targets[0]!, "utf8"), /Q-001/);
  assert.match(readFileSync(targets[1]!, "utf8"), /Q-001/);
});

test("sync rejects an intermediate matter directory symlink beneath the client", { skip: dirSymlinkSkip }, (t) => {
  const { client, matter, targets } = setup(t);
  const externalSpisy = join(client, "ExternalSpisy");
  renameSync(join(client, "Spisy"), externalSpisy);
  symlinkSync(externalSpisy, join(client, "Spisy"), "dir");
  const before = targets.map((path) => readFileSync(path, "utf8"));
  const result = runCli(["sync", matter, "--apply"]);
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /symbolick/);
  assert.deepEqual(targets.map((path) => readFileSync(path, "utf8")), before);
});

test("sync refuses a legacy uppercase index symlink before deleting or updating projections", { skip: fileSymlinkSkip }, (t) => {
  const { matter, targets, external } = setup(t);
  rmSync(join(matter, "memory", "index.md"));
  symlinkSync(external, join(matter, "memory", "INDEX.md"));
  const before = readFileSync(targets[0]!, "utf8");
  const result = runCli(["sync", matter, "--apply"]);
  assert.equal(result.code, 1, result.out);
  assert.equal(readFileSync(targets[0]!, "utf8"), before);
  assert.equal(readFileSync(external, "utf8"), "External source must remain untouched.\n");
});
