import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { newRecord } from "../src/index.ts";
import { serializeRecord } from "../src/record.ts";
import { applyRecordWrite, readStore, STANDING } from "../src/store.ts";
import { planWrite } from "../src/write.ts";
import { runCli } from "../src/cli.ts";

const record = (id: string) => newRecord({ id, type: "question", jurisdiction: "sk", title: "target", description: "synthetic",
  created: "2026-09-20", updated: "2026-09-20", truth: "Synthetic content", timeline: [] });

for (const id of ["../outside", "..\\outside", "/absolute", "C:\\absolute", ".", "..", "", "Q\u0000bad", "Q:stream"]) {
  test(`unsafe ID rejected before creating a directory: ${JSON.stringify(id)}`, (t) => {
    const base = mkdtempSync(join(tmpdir(), "okf-id-"));
    t.after(() => rmSync(base, { recursive: true, force: true }));
    const dir = join(base, "matter");
    assert.throws(() => applyRecordWrite(dir, planWrite(undefined, record(id), "Synthetic create"), STANDING), /ID/);
    assert.deepEqual(readdirSync(base), []);
  });
}

for (const field of ["id", "before", "after"] as const) {
  test(`update checks ${field} ID before authorization or file operations`, (t) => {
    const base = mkdtempSync(join(tmpdir(), "okf-id-update-"));
    t.after(() => rmSync(base, { recursive: true, force: true }));
    const safe = record("Q-001");
    const diff = planWrite(safe, safe, "Synthetic update");
    const unsafe = field === "id" ? { ...diff, id: "../outside" } : { ...diff, [field]: record("../outside") };
    assert.throws(() => applyRecordWrite(join(base, "matter"), unsafe, STANDING), /ID/);
    assert.deepEqual(readdirSync(base), []);
  });
}

test("deletion checks the old ID even without authorization", (t) => {
  const base = mkdtempSync(join(tmpdir(), "okf-id-delete-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  assert.throws(() => applyRecordWrite(join(base, "matter"), planWrite(record("../outside"), undefined, "Synthetic delete"), undefined), /ID/);
  assert.deepEqual(readdirSync(base), []);
});

test("normal IDs remain writable and CLI rejects traversal without an outside file", (t) => {
  const base = mkdtempSync(join(tmpdir(), "okf-id-cli-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, "matter");
  for (const id of ["Q-001", "29139643", "Client_A-2", "Otázka-3"]) {
    applyRecordWrite(dir, planWrite(undefined, record(id), "Synthetic create"), undefined);
  }
  assert.equal(readStore(dir).records.length, 4);
  const proposal = join(base, "proposal.md");
  writeFileSync(proposal, serializeRecord(record("../outside")));
  const result = runCli(["write", dir, "--file", proposal, "--reason", "Synthetic create", "--apply"]);
  assert.equal(result.code, 1);
  assert.match(result.out, /ID/);
  assert.equal(existsSync(join(dir, "outside-target.md")), false);
  assert.equal(readStore(dir).records.length, 4);
});

test("creation never replaces a file occupied by another record ID", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "okf-id-collision-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  applyRecordWrite(dir, planWrite(undefined, record("Q-CASE"), "First record"), undefined);
  const target = join(dir, "memory", "Q-CASE-target.md");
  writeFileSync(target, serializeRecord(record("OTHER-ID")));
  assert.throws(() => applyRecordWrite(dir, planWrite(undefined, record("Q-CASE"), "Conflicting create"), undefined), /existuje|kolízi|obsaden/);
  assert.equal(readStore(dir).records[0]?.id, "OTHER-ID");
});

test("case-insensitive filename collisions preserve the first record", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "okf-id-case-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  applyRecordWrite(dir, planWrite(undefined, record("Q-CASE"), "First record"), undefined);
  if (!existsSync(join(dir, "memory", "q-case-target.md"))) return t.skip("Requires a case-insensitive filesystem");
  assert.throws(() => applyRecordWrite(dir, planWrite(undefined, record("q-case"), "Case collision"), undefined), /existuje|kolízi|obsaden/);
  assert.deepEqual(readStore(dir).records.map((r) => r.id), ["Q-CASE"]);
});

test("update must verify the ID inside its selected filename", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "okf-id-update-target-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const before = record("Q-TARGET");
  applyRecordWrite(dir, planWrite(undefined, before, "First record"), undefined);
  // Imported file has the right ID under an arbitrary name; the conventional filename belongs to another ID.
  writeFileSync(join(dir, "memory", "imported.md"), serializeRecord(before));
  writeFileSync(join(dir, "memory", "Q-TARGET-target.md"), serializeRecord(record("OTHER-ID")));
  assert.throws(() => applyRecordWrite(dir, planWrite(before, before, "Synthetic update"), undefined), /ID/);
  assert.deepEqual(readStore(dir).records.map((r) => r.id).sort(), ["OTHER-ID", "Q-TARGET"]);
});
