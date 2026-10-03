/** Local acceptance runner. Inputs are read-only; every SAVE targets fresh copies. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHandoff } from "../../okf-handoff/checkpoint.mjs";
import type { WorkspaceMemoryReport, WorkspaceMemorySaveRequest, WorkspaceMemorySaveReport } from "../src/workspace-memory-types.ts";

interface Expectation { sourceId: string; sha256: string; includes: string[] }
interface PilotCase { id: string; workspace: string; allowedRoots: string[]; expectations: Expectation[] }
interface Manifest { version: 1; cases: PilotCase[] }
interface Probe { name: string; status: "PASS" | "FAIL" }
interface CaseResult { id: string; status: "PASS" | "FAIL"; sources: number; writableSources: number; sourceBytes: number; checkpointBytes: number; originalsUnchanged: boolean; probes: Probe[]; error?: string }
const cliPath = fileURLToPath(new URL("../bin/okf-memory.ts", import.meta.url));
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const inside = (root: string, path: string) => path === root || path.startsWith(root + sep);
const safeId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function privateWrite(path: string, value: string | Buffer) { writeFileSync(path, value, { mode: 0o600 }); }
function privateJSON(path: string, value: unknown) { privateWrite(path, JSON.stringify(value, null, 2) + "\n"); }
function folder(path: string) { mkdirSync(path, { recursive: true, mode: 0o700 }); }
function manifestFrom(value: unknown): Manifest {
  assert.ok(object(value) && value.version === 1 && Array.isArray(value.cases) && value.cases.length > 0, "Invalid manifest");
  const ids = new Set<string>();
  const cases: PilotCase[] = value.cases.map((item: unknown) => {
    assert.ok(object(item) && safeId(item.id) && !ids.has(item.id.toLowerCase()), "Invalid case ID"); ids.add(item.id.toLowerCase());
    assert.ok(typeof item.workspace === "string" && isAbsolute(item.workspace), "Workspace must be absolute");
    assert.ok(Array.isArray(item.allowedRoots) && item.allowedRoots.every((p: unknown) => typeof p === "string" && isAbsolute(p)), "Grants must be absolute");
    assert.ok(Array.isArray(item.expectations) && item.expectations.length > 0, "Missing expectations");
    const sourceIds = new Set<string>();
    const expectations: Expectation[] = item.expectations.map((entry: unknown) => {
      assert.ok(object(entry) && safeId(entry.sourceId) && !sourceIds.has(entry.sourceId.toLowerCase()), "Invalid expectation ID"); sourceIds.add(entry.sourceId.toLowerCase());
      assert.ok(typeof entry.sha256 === "string" && /^[a-f0-9]{64}$/.test(entry.sha256), "Invalid expected hash");
      assert.ok(Array.isArray(entry.includes) && entry.includes.every((s: unknown) => typeof s === "string"), "Invalid expected text");
      return { sourceId: entry.sourceId, sha256: entry.sha256, includes: entry.includes };
    });
    return { id: item.id, workspace: item.workspace, allowedRoots: item.allowedRoots, expectations };
  });
  return { version: 1, cases };
}
function outsideGit(path: string) {
  // Ignore caller Git overrides: test the physical destination, not an unrelated GIT_DIR.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const check = spawnSync("git", ["-C", path, "rev-parse", "--is-inside-work-tree", "--is-bare-repository"], { encoding: "utf8", env });
  assert.ifError(check.error);
  assert.ok(check.status === 128 && /not a git repository/i.test(check.stderr), "Output must be outside a Git repository");
}
function outputRun(manifest: Manifest, requested?: string) {
  const parent = realpathSync(requested ?? tmpdir());
  assert.ok(lstatSync(parent).isDirectory(), "Output parent must exist"); outsideGit(parent);
  const inputs = manifest.cases.flatMap(c => [c.workspace, ...c.allowedRoots]).map(p => realpathSync(p));
  assert.ok(inputs.every(p => !inside(p, parent)), "Output overlaps input roots");
  const run = mkdtempSync(join(parent, "workspace-memory-pilot-"));
  assert.ok(inputs.every(p => !inside(p, run) && !inside(run, p)), "Run overlaps input roots");
  return run;
}
function inventory(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function walk(path: string) {
    for (const name of readdirSync(path).sort()) {
      const child = join(path, name), stat = lstatSync(child), key = relative(root, child);
      assert.ok(!stat.isSymbolicLink(), "Unexpected link in isolated copy");
      if (stat.isDirectory()) { result[key + sep] = "directory"; walk(child); }
      else { assert.ok(stat.isFile(), "Unexpected non-file"); result[key] = hash(readFileSync(child)); }
    }
  }
  walk(root); return result;
}
async function runCase(input: PilotCase, run: string): Promise<CaseResult> {
  const evidence = join(run, input.id); folder(evidence);
  const result: CaseResult = { id: input.id, status: "FAIL", sources: 0, writableSources: 0, sourceBytes: 0, checkpointBytes: 0, originalsUnchanged: false, probes: [] };
  const originalHashes = new Map<string, string>();
  let sequence = 0;
  let activeProbe = "input-read";
  const pass = (name: string) => { result.probes.push({ name, status: "PASS" }); };
  const start = (name: string) => { activeProbe = name; };
  function cli(args: string[], label: string) {
    const prefix = join(evidence, `${String(++sequence).padStart(2, "0")}-${label}`);
    const child = spawnSync(process.execPath, [cliPath, ...args], { maxBuffer: 64 * 1024 * 1024 });
    privateWrite(prefix + ".stdout", child.stdout ?? Buffer.alloc(0)); privateWrite(prefix + ".stderr", child.stderr ?? Buffer.alloc(0));
    privateJSON(prefix + ".process.json", { args, code: child.status, signal: child.signal, error: child.error?.message });
    assert.ifError(child.error); assert.equal(child.signal, null); assert.equal(child.stderr.length, 0);
    return { code: child.status, out: child.stdout.toString("utf8") };
  }
  function read(workspace: string, grants: string[], label: string) {
    const response = cli(["workspace-read", workspace, ...grants, "--json"], label);
    assert.equal(response.code, 0, "CLI read failed");
    // The real CLI owns this report schema; assert completeness before trusting file paths.
    const report = JSON.parse(response.out) as WorkspaceMemoryReport;
    assert.equal(report.complete, true); assert.equal(report.present, true);
    assert.ok(report.sources.length > 0 && report.sources.every(s => s.status === "loaded" && s.content !== null && s.sha256 !== null), "Pilot requires every listed source loaded");
    assert.equal(new Set(report.sources.map(s => s.id)).size, report.sources.length);
    const physical = report.sources.map(s => { const st = lstatSync(s.path); assert.ok(st.isFile() && !st.isSymbolicLink()); return `${st.dev}:${st.ino}`; });
    assert.equal(new Set(physical).size, report.sources.length);
    return report;
  }
  function rendered(workspace: string, grants: string[], report: WorkspaceMemoryReport, label: string) {
    const response = cli(["read", workspace, ...grants, "--matter", report.matterId!], label); assert.equal(response.code, 0);
    for (const s of report.sources) { assert.ok(response.out.includes(s.content!)); assert.ok(response.out.includes(s.sha256!)); }
    return response.out;
  }
  const previousEnv = process.env.LAWOSS_MEMORY_ALLOWED_ROOTS;
  try {
    const profilePath = join(input.workspace, ".lawoss/memory-profile.json");
    const profileBytes = readFileSync(profilePath); originalHashes.set(profilePath, hash(profileBytes));
    const sourceGrants = input.allowedRoots.flatMap(p => ["--allow-root", p]);
    const beforeInput = read(input.workspace, sourceGrants, "input-read");
    assert.equal(beforeInput.profileHash, hash(profileBytes));
    for (const s of beforeInput.sources) originalHashes.set(s.path, s.sha256!);
    result.sources = beforeInput.sources.length; result.sourceBytes = beforeInput.sources.reduce((sum, s) => sum + s.bytes, 0);
    start("input-expectations");
    assert.equal(input.expectations.length, beforeInput.sources.length, "Expectations must cover every source");
    for (const expected of input.expectations) {
      const s = beforeInput.sources.find(s => s.id === expected.sourceId); assert.ok(s);
      assert.equal(s.sha256, expected.sha256); assert.equal(hash(Buffer.from(s.content!)), expected.sha256);
      for (const text of expected.includes) assert.ok(s.content!.includes(text), "Expected source text absent");
    }
    rendered(input.workspace, sourceGrants, beforeInput, "input-render"); pass("input-expectations");
    start("isolated-copy");
    // Mapping has already passed the actual CLI's profile and path validator.
    const profile = JSON.parse(profileBytes.toString("utf8")) as { version: 1; matterId: string; roots: { id: string; path: string }[]; sources: { id: string; root: string; path: string }[] };
    const copies = join(evidence, "copies"); folder(copies);
    const rootMap = new Map(profile.roots.map((r, i) => [r.id, join(copies, `root${i}`)]));
    for (const p of rootMap.values()) folder(p);
    const workspace = join(copies, "workspace"); folder(workspace);
    for (const s of beforeInput.sources) {
      const mapping = profile.sources.find(item => item.id === s.id); assert.ok(mapping);
      const destination = join(rootMap.get(mapping.root)!, mapping.path);
      assert.ok(inside(rootMap.get(mapping.root)!, destination)); folder(dirname(destination));
      // Copy the validated snapshot bytes, never arbitrary linked/adjacent evidence.
      privateWrite(destination, Buffer.from(s.content!, "utf8"));
    }
    profile.roots = profile.roots.map(r => ({ ...r, path: rootMap.get(r.id)! }));
    folder(join(workspace, ".lawoss")); privateJSON(join(workspace, ".lawoss/memory-profile.json"), profile);
    const copiedGrants = [...rootMap.values()];
    const grants = copiedGrants.flatMap(p => ["--allow-root", p]);
    const initial = read(workspace, grants, "copy-read");
    assert.equal(initial.sources.length, beforeInput.sources.length);
    for (const s of initial.sources) assert.equal(s.sha256, originalHashes.get(beforeInput.sources.find(o => o.id === s.id)!.path));
    rendered(workspace, grants, initial, "copy-render"); pass("isolated-copy");
    start("identity-and-grants");
    assert.equal(cli(["workspace-read", workspace, ...grants, "--matter", initial.matterId + "-wrong", "--json"], "wrong-matter").code, 1);
    assert.ok(copiedGrants.length > 0 && initial.sources.some(s => !inside(workspace, s.path)), "Pilot requires a used external root");
    assert.equal(cli(["workspace-read", workspace, "--json"], "denied-grant").code, 1); pass("identity-and-grants");
    start("first-native-checkpoint");
    process.env.LAWOSS_MEMORY_ALLOWED_ROOTS = JSON.stringify(copiedGrants);
    const firstFactory = createHandoff(workspace); assert.ok(firstFactory);
    const first = await firstFactory.checkpoint("pilot_initial", "idle"); privateJSON(join(evidence, "native-initial.json"), first);
    assert.equal(first.ok, true); assert.ok(first.path);
    const firstText = readFileSync(first.path, "utf8");
    for (const s of initial.sources) { assert.ok(firstText.includes(s.content!)); assert.ok(firstText.includes(s.sha256!)); }
    pass("first-native-checkpoint");
    start("preview-nonmutation");
    const annotation = `\n<!-- LAWOSS local pilot: ${new Date().toISOString().slice(0, 10)}; test-only persistence annotation; no legal verification. -->\n`;
    const writable = initial.sources.filter(s => s.writable); result.writableSources = writable.length;
    assert.deepEqual([...new Set(writable.map(s => s.role))].sort(), ["case_card", "case_memory", "task_log", "work_note"]);
    assert.ok(initial.sources.every(s => !s.content!.includes(annotation)), "Annotation already present");
    const request: WorkspaceMemorySaveRequest = { version: 1, matterId: initial.matterId!, operationId: "pilot-save", reason: "Isolated local test-only persistence probe", expectedBindingHash: initial.bindingHash!, expectedContextHash: initial.contextHash!, updates: writable.map(s => ({ sourceId: s.id, expectedSha256: s.sha256!, content: s.content! + annotation })) };
    const requestFile = join(evidence, "save-request.json"); privateJSON(requestFile, request);
    function save(label: string, apply: boolean) {
      privateWrite(join(evidence, `${label}.request.json`), readFileSync(requestFile));
      const response = cli(["workspace-save", workspace, ...grants, "--file", requestFile, "--json", ...(apply ? ["--apply"] : [])], label);
      return { code: response.code, report: JSON.parse(response.out) as WorkspaceMemorySaveReport };
    }
    const beforePreview = inventory(copies), preview = save("preview", false);
    assert.equal(preview.code, 0); assert.equal(preview.report.status, "preview"); assert.deepEqual(inventory(copies), beforePreview);
    assert.equal(existsSync(join(workspace, ".lawoss/memory-history")), false); pass("preview-nonmutation");
    start("save-idempotency-and-conflicts");
    const applied = save("apply", true); assert.equal(applied.code, 0); assert.equal(applied.report.status, "committed");
    const committedInventory = inventory(copies);
    const repeat = save("identical-operation", true); assert.equal(repeat.code, 0); assert.equal(repeat.report.status, "already-applied"); assert.deepEqual(inventory(copies), committedInventory);
    privateJSON(requestFile, { ...request, updates: request.updates.map(u => ({ ...u, content: u.content + "different test content\n" })) });
    const reused = save("reused-operation", true); assert.equal(reused.code, 1); assert.equal(reused.report.status, "conflict");
    privateJSON(requestFile, { ...request, operationId: "pilot-stale" });
    const stale = save("stale-context", true); assert.equal(stale.code, 1); assert.equal(stale.report.status, "conflict");
    assert.deepEqual(inventory(copies), committedInventory); pass("save-idempotency-and-conflicts");
    start("fresh-cli-and-snapshots");
    const updated = read(workspace, grants, "updated-read"); rendered(workspace, grants, updated, "updated-render");
    assert.equal(updated.bindingHash, initial.bindingHash); assert.notEqual(updated.contextHash, initial.contextHash);
    assert.deepEqual(updated.sources.map(s => [s.id, s.path, s.role]), initial.sources.map(s => [s.id, s.path, s.role]));
    for (const s of updated.sources) {
      const old = initial.sources.find(o => o.id === s.id)!;
      assert.equal(s.content, old.content! + (s.writable ? annotation : ""));
      assert.equal(s.content!.split(annotation).length - 1, s.writable ? 1 : 0);
      if (!s.writable) assert.equal(s.sha256, old.sha256);
    }
    const history = join(workspace, ".lawoss/memory-history"), historyFiles = inventory(history);
    // Compare actual snapshot bytes; do not couple acceptance to journal internals.
    for (const s of writable) assert.ok(Object.values(historyFiles).includes(s.sha256!), "Old full source snapshot missing");
    const afterSave = inventory(copies);
    for (const key of Object.keys(afterSave)) if (!(key in beforePreview)) assert.ok(key.startsWith(join("workspace", ".lawoss", "memory-history")), "Unexpected new card or projection");
    pass("fresh-cli-and-snapshots");
    start("fresh-native-session");
    const freshFactory = createHandoff(workspace); assert.ok(freshFactory);
    const fresh = await freshFactory.checkpoint("pilot_fresh", "before-turn"); privateJSON(join(evidence, "native-fresh.json"), fresh);
    assert.equal(fresh.ok, true); assert.ok(fresh.path);
    const freshBytes = readFileSync(fresh.path); result.checkpointBytes = freshBytes.length;
    for (const s of updated.sources) { assert.ok(freshBytes.toString("utf8").includes(s.content!)); assert.ok(freshBytes.toString("utf8").includes(s.sha256!)); }
    assert.ok(freshBytes.length <= 2 * 1024 * 1024 + 4096, "Checkpoint unexpectedly exceeds native bound");
    pass("fresh-native-session");
    start("incomplete-preserves-checkpoint");
    const removed = updated.sources.find(s => s.required)!; const restoreBytes = readFileSync(removed.path);
    try {
      unlinkSync(removed.path);
      assert.equal(cli(["workspace-read", workspace, ...grants, "--json"], "incomplete-read").code, 1);
      const failure = await freshFactory.checkpoint("pilot_fresh", "before-compaction"); privateJSON(join(evidence, "native-incomplete.json"), failure);
      assert.equal(failure.ok, false); assert.deepEqual(readFileSync(fresh.path), freshBytes);
    } finally { privateWrite(removed.path, restoreBytes); }
    const restored = read(workspace, grants, "restored-read"); assert.equal(restored.contextHash, updated.contextHash);
    for (const key of Object.keys(inventory(copies))) if (!(key in beforePreview)) {
      assert.ok(["memory-history", "handoff"].some(name => key.startsWith(join("workspace", ".lawoss", name))), "Unexpected new source or projection");
    }
    pass("incomplete-preserves-checkpoint"); result.status = "PASS";
  } catch (error) {
    result.probes.push({ name: activeProbe, status: "FAIL" });
    result.error = error instanceof Error ? error.stack : String(error);
  } finally {
    if (previousEnv === undefined) delete process.env.LAWOSS_MEMORY_ALLOWED_ROOTS; else process.env.LAWOSS_MEMORY_ALLOWED_ROOTS = previousEnv;
    const originals = [...originalHashes].map(([path, expected]) => {
      try { const actual = hash(readFileSync(path)); return { path, expected, actual, unchanged: actual === expected }; }
      catch (error) { return { path, expected, unchanged: false, error: String(error) }; }
    });
    result.originalsUnchanged = originals.length === input.expectations.length + 1 && originals.every(s => s.unchanged);
    if (!result.originalsUnchanged) result.status = "FAIL";
    result.probes.push({ name: "originals-unchanged", status: result.originalsUnchanged ? "PASS" : "FAIL" });
    privateJSON(join(evidence, "original-hashes.json"), originals); privateJSON(join(evidence, "result.json"), result);
  }
  return result;
}
async function main() {
  const args = process.argv.slice(2), flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    assert.ok(key && ["--manifest", "--output-root"].includes(key) && !flags.has(key) && value && isAbsolute(value), "Use --manifest absolute.json [--output-root existing-absolute-directory]"); flags.set(key, value);
  }
  const manifestPath = flags.get("--manifest"); assert.ok(manifestPath, "Manifest required");
  const manifest = manifestFrom(JSON.parse(readFileSync(manifestPath, "utf8")));
  const run = outputRun(manifest, flags.get("--output-root"));
  const startedAt = new Date().toISOString();
  const results: CaseResult[] = [];
  for (const entry of manifest.cases) {
    const result = await runCase(entry, run); results.push(result);
    process.stdout.write(`${result.id}: ${result.status}; ${result.probes.filter(p => p.status === "PASS").length}/${result.probes.length} probes\n`);
  }
  const status = results.every(r => r.status === "PASS") ? "PASS" : "FAIL";
  privateJSON(join(run, "report.json"), { version: 1, status, run, startedAt, finishedAt: new Date().toISOString(), node: process.version, cases: results, totals: { cases: results.length, passedCases: results.filter(r => r.status === "PASS").length, sources: results.reduce((sum, r) => sum + r.sources, 0), probes: results.reduce((sum, r) => sum + r.probes.length, 0), passedProbes: results.reduce((sum, r) => sum + r.probes.filter(p => p.status === "PASS").length, 0) }, legal_review: "NOT_RUN", gui: "NOT_RUN", limits: { sourceBytes: 2 * 1024 * 1024, allSourceBytes: 16 * 1024 * 1024, nativeRenderedContextBytes: 2 * 1024 * 1024, nativeInlineContextBytes: 64 * 1024, overLimit: "Explicit failure; no successful truncation. Inline injection is not exercised by this runner." } });
  process.stdout.write(`Pilot ${status}. Private report retained: ${join(run, "report.json")}\n`);
  if (status !== "PASS") process.exitCode = 1;
}
const previousUmask = process.umask(0o077);
try { await main(); }
catch { process.stderr.write("Pilot failed before completion; inspect the manifest and output location. No private error details printed.\n"); process.exitCode = 1; }
finally { process.umask(previousUmask); }
