// LAWOSS N-A7-10 (review PR #296): zápis záznamu nejde cez symbolický odkaz na `memory/` ani na súbor záznamu.
// Odmietne ho už čítanie pamäte (nečitateľný záznam); `applyRecordWrite` to pod zámkom overí ešte raz cez `lstat`.
import { symlinkSkipReason } from "../../tests/symlink-capability.mts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRecord } from "../src/cli.ts";
import { hasMatterCard } from "../src/store.ts";
import { newRecord, serializeRecord } from "../src/index.ts";

const dirSymlinkSkip = symlinkSkipReason("dir");
const fileSymlinkSkip = symlinkSkipReason("file");

const record = (id: string) => serializeRecord(newRecord({
  id, type: "matter", jurisdiction: "sk", title: "Stav SYN", description: "SYN", truth: "Klient preferuje e-mail.",
  created: "2026-10-28", updated: "2026-10-28", timeline: [{ date: "2026-10-28", text: "založené" }],
}));

function setup(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(join(tmpdir(), "okf-record-links-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const matter = join(root, "Klient", "Spisy", "M001"), external = join(root, "Inde");
  mkdirSync(matter, { recursive: true });
  mkdirSync(external);
  writeFileSync(join(matter, "matter.md"), "---\njurisdiction: sk\n---\n");
  return { matter, external };
}

test("memory/ that is a link to another folder is refused and nothing is written there", { skip: dirSymlinkSkip }, (t) => {
  const { matter, external } = setup(t);
  symlinkSync(external, join(matter, "memory"), "dir");
  const result = writeRecord(matter, record("M-020"), { reason: "SYN", apply: true });
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /^ODMIETNUTÉ/);
  assert.deepEqual(readdirSync(external), []);
});

test("a record file that is a link is refused", { skip: fileSymlinkSkip }, (t) => {
  const { matter, external } = setup(t);
  mkdirSync(join(matter, "memory"));
  symlinkSync(join(external, "M-021.md"), join(matter, "memory", "M-021.md"));
  const result = writeRecord(matter, record("M-021"), { reason: "SYN", apply: true });
  assert.equal(result.code, 1, result.out);
  assert.match(result.out, /^ODMIETNUTÉ/);
  assert.equal(existsSync(join(external, "M-021.md")), false);
});

test("a case is a folder with a matter card; a client root or memory/ is not", (t) => {
  const { matter } = setup(t);
  assert.equal(hasMatterCard(matter), true);
  assert.equal(hasMatterCard(join(matter, "..", "..")), false);
  mkdirSync(join(matter, "memory"));
  assert.equal(hasMatterCard(join(matter, "memory")), false);
});
