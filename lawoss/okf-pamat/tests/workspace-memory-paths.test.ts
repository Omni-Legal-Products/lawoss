import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkedDirectory, physicalPathWithin } from "../src/workspace-memory-fs.ts";
import { symlinkSkipReason } from "../../tests/symlink-capability.mts";

test("physical child resolution verifies missing tails, types and traversal without creating files", t => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "memory-paths-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "file"), "evidence");
  assert.equal(physicalPathWithin(root, "new/nested/file", "file", true), join(root, "new/nested/file"));
  assert.equal(existsSync(join(root, "new")), false);
  assert.throws(() => physicalPathWithin(root, "../outside", "file", true), /Traversal/);
  assert.throws(() => physicalPathWithin(root, "new/../file", "file", true), /Traversal/);
  assert.throws(() => physicalPathWithin(root, "file", "directory"));
  assert.throws(() => physicalPathWithin(root, "file/nested", "file", true));
});

test("authority aliases permit internal missing children but reject escaped and dangling ancestors", { skip: symlinkSkipReason("dir") }, t => {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), "memory-paths-alias-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "root"), outside = join(base, "outside"), alias = join(base, "alias");
  mkdirSync(root); mkdirSync(outside); mkdirSync(join(root, "inside"));
  symlinkSync(root, alias, "dir"); symlinkSync(join(root, "inside"), join(root, "linked"), "dir");
  symlinkSync(outside, join(root, "escape"), "dir"); symlinkSync(join(root, "absent"), join(root, "dangling"), "dir");
  assert.equal(checkedDirectory(alias), root);
  assert.equal(physicalPathWithin(alias, "linked/new/file", "file", true), join(root, "inside/new/file"));
  assert.throws(() => physicalPathWithin(alias, "escape/new/file", "file", true), /outside authority/);
  assert.throws(() => physicalPathWithin(alias, "dangling/new/file", "file", true), /Dangling/);
  assert.equal(existsSync(join(root, "inside/new")), false);
  assert.equal(existsSync(join(outside, "new")), false);
  assert.equal(existsSync(join(root, "absent")), false);
});
