import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.ts";
import { readStore } from "../src/store.ts";
import { serializeRecord } from "../src/record.ts";
import { newRecord, MEMORY_DIR } from "../src/index.ts";

function spis(): string {
  const dir = mkdtempSync(join(tmpdir(), "okf-bad-"));
  mkdirSync(join(dir, MEMORY_DIR));
  writeFileSync(join(dir, "_STATUS.md"), "# Status\n");
  writeFileSync(
    join(dir, MEMORY_DIR, "R-001-dobry.md"),
    serializeRecord(newRecord({
      id: "R-001", type: "decision", jurisdiction: "cz",
      title: "Dobrý", summary: "v pořádku", created: "2026-08-31", updated: "2026-08-31",
      truth: "t", timeline: [{ date: "2026-08-31", text: "x" }],
    })),
  );
  writeFileSync(
    join(dir, MEMORY_DIR, "R-002-rozbity.md"),
    "---\nokf: 1\nid: R-002\ntype: decision\ntitle: Rozbitý\njurisdiction: sk\n---\n\n## Truth\nx\n",
  );
  return dir;
}

test("rozbity zaznam neshodi citanie — ostatne sa nacitaju", () => {
  const s = readStore(spis());
  assert.equal(s.records.length, 1, "dobrý záznam sa má načítať");
  assert.equal(s.problems.length, 1);
  assert.match(s.problems[0]?.file ?? "", /R-002/);
});

test("validate rozbity subor pomenuje a skonci chybou, nie stack trace", () => {
  const r = runCli(["validate", spis()]);
  assert.equal(r.code, 1);
  assert.match(r.out, /R-002-rozbity\.md/);
  assert.doesNotMatch(r.out, /at parseRecord|node:internal/);
});

test("read rozbity subor nahlasi, ale zvysok vypise", () => {
  const r = runCli(["read", spis()]);
  assert.match(r.out, /R-001/);
  assert.match(r.out, /R-002-rozbity\.md/);
});

test("aml rozbity subor nezhodi", () => {
  const r = runCli(["aml", spis()]);
  assert.equal(r.code, 0);
  assert.match(r.out, /R-002-rozbity\.md/);
});

test("spis bez rozbitych suborov ziadne problemy nehlasi", () => {
  const dir = mkdtempSync(join(tmpdir(), "okf-ok-"));
  mkdirSync(join(dir, MEMORY_DIR));
  assert.deepEqual(readStore(dir).problems, []);
});
