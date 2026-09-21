import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readWorkspaceMemory, renderWorkspaceMemory, type WorkspaceMemoryReport } from "../src/index.ts";

const roots: string[] = [];
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "workspace-cli-"))); roots.push(base);
  const root = join(base, "matter"), vault = join(base, "vault"), notes = join(base, "notes");
  for (const folder of [root, vault, notes, join(root, ".lawoss")]) mkdirSync(folder);
  const sources = [
    { id: "memory", root: "matter", path: "_memory.md", role: "case_memory", required: true, writable: true, anchors: ["SYNTHETIC-01"] },
    { id: "card", root: "vault", path: "card.md", role: "case_card", required: true, writable: true },
    { id: "note", root: "notes", path: "note.md", role: "work_note", required: true, writable: true },
    { id: "log", root: "vault", path: "log.md", role: "task_log", required: true, writable: true },
  ];
  const profile = { version: 1, matterId: "synthetic-01", roots: [{ id: "matter", path: "." }, { id: "vault", path: vault }, { id: "notes", path: notes }], sources };
  writeFileSync(join(root, ".lawoss/memory-profile.json"), JSON.stringify(profile));
  for (const [folder, name] of [[root, "_memory.md"], [vault, "card.md"], [notes, "note.md"], [vault, "log.md"]]) writeFileSync(join(folder!, name!), `---\noriginal_date: 2020-01-02\n---\nSYNTHETIC-01 ${name}\n[[preserved-link]]\n`);
  return { root, vault, notes, profile, grants: ["--allow-root", vault, "--allow-root", notes] };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const sourceCli = fileURLToPath(new URL("../bin/okf-memory.ts", import.meta.url));
const bundleCli = fileURLToPath(new URL("../bundle/okf-memory.js", import.meta.url));
function cli(args: string[], bundle = false) {
  const result = spawnSync(process.execPath, [bundle ? bundleCli : sourceCli, ...args], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  assert.ifError(result.error); assert.equal(result.stderr, "");
  return { code: result.status, out: result.stdout };
}
function snapshot(root: string, grants: string[]) {
  const result = cli(["workspace-read", root, ...grants, "--json"]); assert.equal(result.code, 0, result.out);
  return JSON.parse(result.out) as WorkspaceMemoryReport;
}

test("actual Node read selects complete profile with all repeated caller grants and full provenance", () => {
  const f = fixture();
  assert.equal(cli(["read", f.root]).code, 1);
  assert.equal(cli(["read", f.root, "--allow-root", f.vault]).code, 1);
  const report = snapshot(f.root, f.grants); assert.equal(report.sources.length, 4);
  const read = cli(["read", f.root, ...f.grants, "--matter", "synthetic-01"]);
  assert.equal(read.code, 0, read.out);
  for (const s of report.sources) { assert.ok(read.out.includes(s.content!)); assert.ok(read.out.includes(s.sha256!)); }
  assert.equal(cli(["read", f.root, ...f.grants, "--matter", "other"]).code, 1);
  assert.equal(existsSync(join(f.root, "memory")), false);
});

test("strict CLI rejects missing values, relative grants, duplicates and unknown options", () => {
  const f = fixture();
  for (const args of [["--allow-root"], ["--allow-root", "--json"], ["--allow-root", "relative"], ["--matter"], ["--matter", "a", "--matter", "b"], ["--json", "--json"], ["--unknown"]]) {
    assert.equal(cli(["read", f.root, ...args]).code, 2, args.join(" "));
    assert.equal(cli(["workspace-read", f.root, ...args]).code, 2);
  }
  assert.equal(cli(["workspace-save", f.root, "--file"]).code, 2);
  const file = join(f.root, "bad.json"); writeFileSync(file, "{");
  assert.equal(cli(["workspace-save", f.root, "--file", file]).code, 2);
});

test("profile absence and malformed present profile are explicit; typed commands cannot create projections", () => {
  const f = fixture();
  for (const malformed of [false, true]) {
    if (malformed) writeFileSync(join(f.root, ".lawoss/memory-profile.json"), "{");
    for (const command of ["write", "init", "sync", "retrofit", "validate", "preamble", "aml"]) assert.equal(cli([command, f.root, "--apply", "--cz"]).code, 1, command);
    assert.equal(existsSync(join(f.root, "memory")), false); assert.equal(existsSync(join(f.root, "_STATUS.md")), false);
  }
  const invalid = cli(["read", f.root, "--json"]); assert.equal(invalid.code, 1); assert.equal(JSON.parse(invalid.out).present, true);
  rmSync(join(f.root, ".lawoss/memory-profile.json"));
  const absent = cli(["workspace-read", f.root, "--json"]); assert.equal(absent.code, 1); assert.equal(JSON.parse(absent.out).present, false);
  assert.equal(cli(["read", f.root]).code, 0);
});

test("CLI preview/apply/idempotency/CAS preserve all four files and complete history", () => {
  const f = fixture(); const before = snapshot(f.root, f.grants);
  const request = { version: 1, matterId: before.matterId, operationId: "op-cli", reason: "Synthetic coordinated update", expectedBindingHash: before.bindingHash, expectedContextHash: before.contextHash,
    updates: before.sources.map(s => ({ sourceId: s.id, expectedSha256: s.sha256, content: s.content + "new persisted work\n" })) };
  const file = join(f.root, "request.json"); writeFileSync(file, JSON.stringify(request));
  const args = ["workspace-save", f.root, ...f.grants, "--file", file, "--json"];
  const preview = cli(args); assert.equal(preview.code, 0, preview.out); assert.equal(JSON.parse(preview.out).status, "preview");
  assert.equal(existsSync(join(f.root, ".lawoss/memory-history")), false);
  for (const s of before.sources) assert.equal(readFileSync(s.path, "utf8"), s.content);
  const applied = cli([...args, "--apply"]); assert.equal(applied.code, 0, applied.out); assert.equal(JSON.parse(applied.out).status, "committed");
  const duplicate = cli([...args, "--apply"]); assert.equal(duplicate.code, 0); assert.equal(JSON.parse(duplicate.out).status, "already-applied");
  for (const s of before.sources) { assert.equal(readFileSync(s.path, "utf8"), s.content + "new persisted work\n"); assert.equal(readFileSync(join(f.root, ".lawoss/memory-history/op-cli", `${s.id}.before`), "utf8"), s.content); }
  writeFileSync(file, JSON.stringify({ ...request, operationId: "stale-operation" }));
  assert.equal(cli([...args, "--apply"]).code, 1);
  const current = snapshot(f.root, f.grants); assert.notEqual(current.contextHash, before.contextHash);
});

test("distributed Node bundle supports the same strict read flags and save preview", () => {
  const f = fixture();
  const result = cli(["read", f.root, ...f.grants, "--json"], true); assert.equal(result.code, 0, result.out);
  const report = JSON.parse(result.out) as WorkspaceMemoryReport;
  assert.equal(report.complete, true); assert.equal(report.sources.length, 4);
  assert.equal(cli(["workspace-read", f.root, "--allow-root", "relative"], true).code, 2);
  const file = join(f.root, "request.json"); writeFileSync(file, JSON.stringify({ version: 1, matterId: report.matterId, operationId: "bundle-preview", reason: "test", expectedBindingHash: report.bindingHash, expectedContextHash: report.contextHash, updates: report.sources.map(s => ({ sourceId: s.id, expectedSha256: s.sha256, content: s.content + "update\n" })) }));
  const preview = cli(["workspace-save", f.root, ...f.grants, "--file", file, "--json"], true);
  assert.equal(preview.code, 0, preview.out); assert.equal(JSON.parse(preview.out).status, "preview");
});


for (const bundle of [false, true]) {
  for (const json of [false, true]) {
    for (const incomplete of [false, true]) {
      test(`pipe drains full large ${json ? "JSON" : "render"} from ${bundle ? "bundle" : "source"} with exit ${incomplete ? 1 : 0}`, () => {
        const f = fixture();
        const body = "SYNTHETIC-01\n" + "Příliš žluťoučký kůň — úplný zdroj.\n".repeat(12_000) + "SYNTHETIC-END-OF-LARGE-SOURCE\n";
        assert.ok(Buffer.byteLength(body, "utf8") >= 300 * 1024);
        writeFileSync(join(f.root, "_memory.md"), body);
        if (incomplete) rmSync(join(f.notes, "note.md"));
        const expected = readWorkspaceMemory(f.root, { allowedRoots: [f.vault, f.notes] });
        const result = cli([json ? "workspace-read" : "read", f.root, ...f.grants, ...(json ? ["--json"] : [])], bundle);
        assert.equal(result.code, incomplete ? 1 : 0);
        // Fixed-length ISO timestamps permit a byte check before parsing. Keep
        // failure diagnostics bounded instead of printing the entire source payload.
        const expectedText = json ? JSON.stringify(expected, null, 2) + "\n" : renderWorkspaceMemory(expected) + "\n";
        assert.equal(Buffer.byteLength(result.out, "utf8"), Buffer.byteLength(expectedText, "utf8"), "The process must drain every output byte into the pipe");
        if (json) {
          const actual = JSON.parse(result.out) as WorkspaceMemoryReport;
          assert.equal(actual.complete, !incomplete);
          assert.equal(actual.sources.length, expected.sources.length);
          assert.equal(actual.sources.find(source => source.id === "memory")?.content, body);
          assert.deepEqual({ ...actual, loadedAt: expected.loadedAt }, expected);
        } else {
          const normalizeLoadTime = (text: string) => text.replace(/^Loaded at: .*$/m, "Loaded at: <timestamp>");
          assert.ok(normalizeLoadTime(result.out) === normalizeLoadTime(expectedText), "The complete rendered context must match the reader");
          assert.ok(result.out.includes(body));
          assert.ok(result.out.endsWith("--- END SOURCE DATA ---\n\n"));
        }
      });
    }
  }
}
