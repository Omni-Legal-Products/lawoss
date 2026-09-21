import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readManualStatus } from "../src/manual-status.ts";
import { renderStatus, statusSkeleton } from "../src/render.ts";
import { runCli } from "../src/cli.ts";
import { newRecord } from "../src/index.ts";
import { serializeRecord } from "../src/record.ts";

test("read keeps stale manual state and its date across real projection sync", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "okf-manual-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "memory"));
  writeFileSync(join(dir, "matter.md"), "---\ntype: matter\njurisdiction: sk\n---\n");
  const status = join(dir, "_STATUS.md");
  writeFileSync(status, "---\ntype: status\nupdated: 2026-09-20\nmanual_updated: 2026-09-01\n---\n\n# Status\n\n> **Fáza:** Čakáme.\n> **Ďalší krok:** Zavolať klientovi.\n\n## Vlastná poznámka\nDôležitý ručný fakt.\n");
  utimesSync(status, new Date("2026-09-01"), new Date("2026-09-01"));
  writeFileSync(join(dir, "memory/R-001.md"), serializeRecord(newRecord({ id: "R-001", type: "decision", jurisdiction: "sk", title: "New decision", description: "synthetic", created: "2026-09-02", updated: "2026-09-02", truth: "New fact", timeline: [{ date: "2026-09-02", text: "Created" }] })));
  const before = runCli(["read", dir]);
  assert.equal(before.code, 0, before.out);
  assert.match(before.out, /Čakáme\./);
  assert.match(before.out, /Dôležitý ručný fakt/);
  assert.match(before.out, /manual_updated: 2026-09-01/);
  assert.match(before.out, /starší než pamäť/);
  const old = statSync(status);
  assert.equal(runCli(["sync", dir, "--apply"]).code, 0);
  assert.ok(statSync(status).mtimeMs > old.mtimeMs);
  assert.equal(runCli(["read", dir]).out, before.out);
  assert.match(readFileSync(status, "utf8"), /manual_updated: 2026-09-01/);
});

test("legacy updated or filesystem time cannot stand in for manual_updated", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "okf-manual-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "_STATUS.md"), "---\ntype: status\nupdated: 2099-01-01\n---\n\n> **Fáza:** Old manual text\n");
  const result = runCli(["read", dir]);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /aktuálnosť neznáma/);
  assert.match(result.out, /Old manual text/);
});

test("same-size projection update still changes the native mtime:size revision", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "okf-revision-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "memory"));
  writeFileSync(join(dir, "_STATUS.md"), statusSkeleton("sk"));
  const source = join(dir, "memory/R-001.md");
  const record = newRecord({ id: "R-001", type: "evidence", jurisdiction: "sk", title: "AAAA", description: "synthetic", created: "2026-09-01", updated: "2026-09-01", truth: "Fact", timeline: [] });
  writeFileSync(source, serializeRecord(record));
  assert.equal(runCli(["sync", dir, "--apply"]).code, 0);
  const status = join(dir, "_STATUS.md");
  utimesSync(status, new Date("2026-09-01"), new Date("2026-09-01"));
  const before = statSync(status);
  assert.match(readFileSync(status, "utf8"), /AAAA/);
  writeFileSync(source, serializeRecord({ ...record, title: "BBBB" }));
  assert.equal(runCli(["sync", dir, "--apply"]).code, 0);
  const after = statSync(status);
  assert.match(readFileSync(status, "utf8"), /BBBB/);
  assert.equal(after.size, before.size);
  assert.notEqual(`${Math.floor(after.mtimeMs)}:${after.size}`, `${Math.floor(before.mtimeMs)}:${before.size}`);
});

for (const value of ['""', '2026-02-30', '2099-01-01', 'yesterday', 'true']) {
  test(`invalid manual date ${value} remains unknown`, () => {
    const result = readManualStatus(`---\ntype: status\nmanual_updated: ${value}\n---\n> **Fáza:** Waiting`, [], "2026-09-21");
    assert.equal(result.state, "unknown");
    assert.equal(result.updated, undefined);
    assert.match(result.content, /Waiting/);
  });
}

test("malformed status markers fail visibly rather than hide manual content", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "okf-bad-markers-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "_STATUS.md"), "# Status\n<!-- okf:render:facts:start -->\nManual note\n");
  const result = runCli(["read", dir]);
  assert.equal(result.code, 1);
  assert.match(result.out, /_STATUS.md/);
});

test("manual notes below numbered generated headings survive projection updates", () => {
  const text = "# Status\n\n## 2. Fakty veci\n<!-- okf:render:facts:start -->\nOld projection\n<!-- okf:render:facts:end -->\n\nManual note under facts.\n\n## Personal context\nUnusual fact.\n";
  const before = readManualStatus(text, []);
  assert.match(before.content, /Manual note under facts/);
  assert.match(before.content, /Unusual fact/);
  assert.doesNotMatch(before.content, /Old projection/);
  assert.deepEqual(readManualStatus(renderStatus(text, [], "sk"), []), before);
});

test("a manual heading matching a later projection heading keeps its context", () => {
  const result = readManualStatus("## Lehoty\n\nManually agreed dates.\n\n## Lehoty\n<!-- okf:render:deadlines:start -->\nGenerated\n<!-- okf:render:deadlines:end -->\n", []);
  assert.equal(result.content, "## Lehoty\n\nManually agreed dates.");
});
