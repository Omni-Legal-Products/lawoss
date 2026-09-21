import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../scripts/workspace-memory-pilot.ts", import.meta.url));
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
function fixture() {
  const base = mkdtempSync(join(realpathSync(tmpdir()), "synthetic-pilot-input-"));
  const workspace = join(base, "workspace"), vault = join(base, "vault");
  for (const path of [workspace, vault, join(workspace, ".lawoss")]) mkdirSync(path, { mode: 0o700 });
  const sources = [
    { id: "memory", root: "matter", path: "_memory.md", role: "case_memory", required: true, writable: true, anchors: ["SYNTHETIC-PILOT-01"] },
    { id: "card", root: "vault", path: "card.md", role: "case_card", required: true, writable: true },
    { id: "note", root: "vault", path: "note.md", role: "work_note", required: true, writable: true },
    { id: "log", root: "vault", path: "tasks.md", role: "task_log", required: true, writable: true },
    { id: "rules", root: "matter", path: "rules.md", role: "rules", required: true, writable: false },
    { id: "events", root: "vault", path: "raw.json", role: "evidence", required: true, writable: false },
  ];
  const initial = new Map<string, Buffer>();
  const expectations = sources.map(s => {
    const content = s.id === "events" ? '{"complete":false,"events":[{"id":1},{"id":1}],"original_date":"2020-01-02"}\n' : `---\noriginal_date: 2020-01-02\n---\nSYNTHETIC-PILOT-01 ${s.id}\n[[original-link]]\nUnverified allegation; pending work\n`;
    const path = join(s.root === "matter" ? workspace : vault, s.path);
    writeFileSync(path, content, { mode: 0o600 }); initial.set(path, Buffer.from(content));
    return { sourceId: s.id, sha256: hash(content), includes: ["2020-01-02", s.id === "events" ? '"complete":false' : "[[original-link]]"] };
  });
  const profile = join(workspace, ".lawoss/memory-profile.json");
  const profileText = JSON.stringify({ version: 1, matterId: "synthetic-pilot-01", roots: [{ id: "matter", path: "." }, { id: "vault", path: vault }], sources });
  writeFileSync(profile, profileText, { mode: 0o600 }); initial.set(profile, Buffer.from(profileText));
  writeFileSync(join(vault, "unlisted-secret.txt"), "SYNTHETIC UNLISTED DO NOT COPY", { mode: 0o600 });
  return { base, workspace, vault, initial, input: { id: "case-good", workspace, allowedRoots: [vault], classification: "synthetic", expectations } };
}
function invoke(manifest: string, extra: string[] = []) {
  const child = spawnSync(process.execPath, [runner, "--manifest", manifest, ...extra], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  assert.ifError(child.error); return child;
}
function retainedReport(output: string) {
  const path = output.match(/Private report retained: (.+)\n/)?.[1]; assert.ok(path, output);
  return { path, report: JSON.parse(readFileSync(path, "utf8")) };
}

test("real CLI/native pilot persists only copied full sources, snapshots and fresh-session context", () => {
  const f = fixture(), manifest = join(f.base, "manifest.json");
  writeFileSync(manifest, JSON.stringify({ version: 1, cases: [f.input] }));
  const child = invoke(manifest); assert.equal(child.status, 0, child.stdout + child.stderr); assert.equal(child.stderr, "");
  const { path, report } = retainedReport(child.stdout);
  assert.equal(report.status, "PASS"); assert.equal(report.totals.cases, 1); assert.equal(report.totals.sources, 6);
  assert.equal(report.totals.passedProbes, report.totals.probes); assert.equal(report.cases[0].originalsUnchanged, true);
  assert.equal(report.legal_review, "NOT_RUN"); assert.equal(report.gui, "NOT_RUN");
  assert.equal(lstatSync(path).mode & 0o777, 0o600); assert.equal(lstatSync(dirname(path)).mode & 0o777, 0o700);
  const copies = join(dirname(path), "case-good", "copies");
  assert.equal(existsSync(join(copies, "root1/unlisted-secret.txt")), false);
  assert.equal(existsSync(join(copies, "root0/memory")), false); assert.equal(existsSync(join(copies, "root0/_STATUS.md")), false);
  const updated = readFileSync(join(copies, "root0/_memory.md"), "utf8");
  assert.ok(updated.startsWith(f.initial.get(join(f.workspace, "_memory.md"))!.toString("utf8")));
  assert.equal(updated.split("test-only persistence annotation").length - 1, 1);
  const checkpoint = readFileSync(join(copies, "workspace/.lawoss/handoff/pilot_fresh.md"), "utf8");
  assert.ok(checkpoint.includes(updated));
  assert.deepEqual(readFileSync(join(copies, "root1/raw.json")), f.initial.get(join(f.vault, "raw.json")));
  assert.deepEqual(readFileSync(join(copies, "workspace/.lawoss/memory-history/pilot-save/memory.before")), f.initial.get(join(f.workspace, "_memory.md")));
  for (const [source, original] of f.initial) assert.deepEqual(readFileSync(source), original);
});

test("expectation failure is nonzero, retains private diagnostics, checks originals and continues other cases", () => {
  const f = fixture(), manifest = join(f.base, "manifest.json");
  const bad = { ...f.input, id: "case-bad", expectations: f.input.expectations.map((e, i) => i === 0 ? { ...e, includes: ["SYNTHETIC-ABSENT-ANCHOR"] } : e) };
  writeFileSync(manifest, JSON.stringify({ version: 1, cases: [bad, f.input] }));
  const child = invoke(manifest); assert.equal(child.status, 1); assert.equal(child.stderr, "");
  assert.equal(child.stdout.includes(f.workspace), false); assert.equal(child.stdout.includes("SYNTHETIC-ABSENT-ANCHOR"), false);
  const { path, report } = retainedReport(child.stdout);
  assert.equal(report.status, "FAIL"); assert.equal(report.totals.cases, 2); assert.equal(report.totals.passedCases, 1);
  assert.equal(report.cases[0].status, "FAIL"); assert.equal(report.cases[0].originalsUnchanged, true);
  assert.equal(report.cases[0].probes.find((p: { name: string }) => p.name === "input-expectations").status, "FAIL");
  assert.ok(report.cases[0].error.includes("Expected source text absent"));
  assert.equal(existsSync(join(dirname(path), "case-bad/copies")), false);
  for (const [source, original] of f.initial) assert.deepEqual(readFileSync(source), original);
});

test("output inside Git or source roots is refused before creating a run", () => {
  const f = fixture(), manifest = join(f.base, "manifest.json");
  writeFileSync(manifest, JSON.stringify({ version: 1, cases: [f.input] }));
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  for (const output of [packageRoot, f.workspace, f.vault]) {
    const before = readdirSync(output).sort();
    const child = invoke(manifest, ["--output-root", output]); assert.equal(child.status, 1);
    assert.deepEqual(readdirSync(output).sort(), before); assert.equal(child.stderr.includes(output), false);
  }
  for (const [source, original] of f.initial) assert.deepEqual(readFileSync(source), original);
});
