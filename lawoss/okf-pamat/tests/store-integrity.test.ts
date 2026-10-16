import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { applyRecordWrite, readStore } from "../src/store.ts";
import { parseRecord, serializeRecord } from "../src/record.ts";
import { planWrite } from "../src/write.ts";

test("memory path that cannot be read is a problem, not an empty successful store", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "okf-unreadable-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "memory"), "This should be a directory");
  const store = readStore(dir);
  assert.equal(store.problems.length, 1);
  assert.match(store.problems[0]?.message ?? "", /ENOTDIR/);
});

test("permission denied reading memory is reported", { skip: process.platform === "win32" ? "POSIX chmod permission denial does not model Windows ACLs" : process.getuid?.() === 0 ? "root bypasses POSIX read permissions" : false }, (t) => {
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

test("memory symlinks cannot import another matter and a selected root alias still works", (t) => {
  const base = mkdtempSync(join(tmpdir(), "okf-memory-boundary-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, "matter"), other = join(base, "other");
  mkdirSync(join(dir, "memory"), { recursive: true });
  mkdirSync(join(other, "memory"), { recursive: true });
  const record = parseRecord(`---\nokf: 1\nid: R-001\ntype: decision\ntitle: Synthetic boundary\ndescription: Test only\nlayer: L2\njurisdiction: cz\nstatus: active\ncreated: 2026-10-09\nupdated: 2026-10-09\n---\n\n## Truth\n\nSynthetic outside sentinel.\n\n## History\n`);
  const source = join(other, "memory", "R-001.md");
  writeFileSync(source, serializeRecord(record));
  symlinkSync(source, join(dir, "memory", "R-001.md"));
  const linked = readStore(dir);
  assert.deepEqual(linked.records, []);
  assert.equal(linked.problems.length, 1);
  assert.match(linked.problems[0]?.message ?? "", /Symbolický odkaz/);
  assert.throws(() => applyRecordWrite(dir, planWrite(undefined, record, "synthetic test"), undefined));
  assert.equal(readFileSync(source, "utf8"), serializeRecord(record));
  rmSync(join(dir, "memory"), { recursive: true });
  symlinkSync(join(other, "memory"), join(dir, "memory"), "junction");
  const linkedDirectory = readStore(dir);
  assert.deepEqual(linkedDirectory.records, []);
  assert.equal(linkedDirectory.problems.length, 1);
  assert.match(linkedDirectory.problems[0]?.message ?? "", /Symbolický odkaz/);
  const alias = join(base, "matter-alias");
  symlinkSync(other, alias, "junction");
  assert.equal(readStore(alias).records[0]?.id, "R-001");
  assert.deepEqual(readStore(alias).problems, []);
});
