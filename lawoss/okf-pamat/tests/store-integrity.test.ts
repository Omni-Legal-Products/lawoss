import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readStore } from "../src/store.ts";

test("memory path that cannot be read is a problem, not an empty successful store", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "okf-unreadable-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "memory"), "This should be a directory");
  const store = readStore(dir);
  assert.equal(store.problems.length, 1);
  assert.match(store.problems[0]?.message ?? "", /ENOTDIR/);
});

test("permission denied reading memory is reported", { skip: process.platform === "win32" || process.getuid?.() === 0 }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "okf-denied-"));
  const memory = join(dir, "memory");
  mkdirSync(memory);
  t.after(() => { chmodSync(memory, 0o700); rmSync(dir, { recursive: true, force: true }); });
  chmodSync(memory, 0o000);
  const store = readStore(dir);
  assert.equal(store.problems.length, 1);
  assert.match(store.problems[0]?.message ?? "", /EACCES|EPERM/);
});

test("unsupported nested memory directories are reported instead of silently omitted", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "okf-nested-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "memory", "nested"), { recursive: true });
  writeFileSync(join(dir, "memory", "nested", "D-001.md"), "nested record");
  const store = readStore(dir);
  assert.equal(store.problems.length, 1);
  assert.equal(store.problems[0]?.file, "nested");
});
