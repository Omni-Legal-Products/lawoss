import { symlinkSkipReason } from "../../tests/symlink-capability.mts";
// POSIX mode assertions below do not model Windows ACLs; content/CAS checks run on every OS.
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, realpathSync, symlinkSync, linkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkspaceMemory, renderWorkspaceMemory, saveWorkspaceMemory, WORKSPACE_MEMORY_LIMITS, type WorkspaceMemorySaveRequest } from "../src/workspace-memory.ts";
import { readScope } from "../src/store.ts";
const fileSymlinkSkip = symlinkSkipReason("file");
const dirSymlinkSkip = symlinkSkipReason("dir");

function fixture(t: { after(fn: () => void): void }) {
  const base = mkdtempSync(join(realpathSync(tmpdir()), "workspace-memory-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const workspace = join(base, "case"), vault = join(base, "vault");
  mkdirSync(join(workspace, ".lawoss"), { recursive: true }); mkdirSync(vault);
  const profile = { version: 1, matterId: "matter-test-01", roots: [{ id: "case", path: "." }, { id: "vault", path: vault }], sources: [
    { id: "memory", root: "case", path: "_memory.md", role: "case_memory", required: true, writable: true, anchors: ["matter-test-01"] },
    { id: "card", root: "vault", path: "card.md", role: "case_card", required: true, writable: true },
    { id: "note", root: "vault", path: "note.md", role: "work_note", required: true, writable: true },
    { id: "log", root: "vault", path: "log.md", role: "task_log", required: true, writable: true },
  ] };
  const profilePath = join(workspace, ".lawoss", "memory-profile.json");
  const putProfile = () => writeFileSync(profilePath, JSON.stringify(profile));
  putProfile();
  writeFileSync(join(workspace, "_memory.md"), "---\r\ncase: matter-test-01\r\n---\r\nOld narrative [[evidence]]\n2020-01-02 unresolved.\n");
  for (const name of ["card", "note", "log"]) writeFileSync(join(vault, `${name}.md`), `${name} old text\n`);
  const options = { allowedRoots: [vault] };
  const load = () => readWorkspaceMemory(workspace, options);
  const request = (): WorkspaceMemorySaveRequest => {
    const report = load(); assert.equal(report.complete, true, JSON.stringify(report.problems));
    return { version: 1, matterId: "matter-test-01", operationId: "op-test-01", reason: "Synthetic coordinated update", expectedBindingHash: report.bindingHash!, expectedContextHash: report.contextHash!, updates: report.sources.filter(s => s.writable).map(s => ({ sourceId: s.id, expectedSha256: s.sha256!, content: s.content! + "New event\n" })) };
  };
  return { workspace, vault, profile, profilePath, putProfile, options, load, request };
}

test("absent profile has no effects; full legacy two-root load requires a caller grant", t => {
  const f = fixture(t);
  assert.equal(readWorkspaceMemory(f.workspace).complete, false);
  const r = f.load(); assert.equal(r.present, true); assert.equal(r.complete, true); assert.equal(r.sources.length, 4);
  assert.match(renderWorkspaceMemory(r), /2020-01-02 unresolved/); assert.match(renderWorkspaceMemory(r), /\[\[evidence\]\]/);
  assert.equal(existsSync(join(f.workspace, "memory")), false);
  assert.equal(r.contextHash, f.load().contextHash);
  rmSync(f.profilePath); const absent = f.load(); assert.equal(absent.present, false); assert.equal(absent.complete, false);
  assert.deepEqual(readdirSync(join(f.workspace, ".lawoss")), []);
});

test("host-owned external profile needs canonical identity and grants and maps sources read-only", t => {
  const f = fixture(t); const externalProfile = join(f.vault, "external-profile.json"); const original = readFileSync(f.profilePath);
  writeFileSync(externalProfile, original); rmSync(f.profilePath);
  const options = { allowedRoots: [f.vault], profilePath: externalProfile, profileIdentity: realpathSync(externalProfile), profileGrants: [f.vault] };
  const report = readWorkspaceMemory(f.workspace, options);
  assert.equal(report.complete, true, JSON.stringify(report.problems));
  assert.ok(report.sources.every(source => !source.writable));
  assert.equal(saveWorkspaceMemory(f.workspace, { version: 1, matterId: report.matterId!, operationId: "external-map", reason: "must not write", expectedBindingHash: report.bindingHash!, expectedContextHash: report.contextHash!, updates: [] }, { ...options, apply: true }).status, "conflict");
  assert.deepEqual(readFileSync(externalProfile), original);
  assert.equal(readWorkspaceMemory(f.workspace, { ...options, profileIdentity: "wrong" }).complete, false);
  assert.equal(readWorkspaceMemory(f.workspace, { ...options, profileGrants: [] }).complete, false);
});

test("subject scope stays inside its client for contentious and non-contentious matters", t => {
  const base = mkdtempSync(join(realpathSync(tmpdir()), "matter-scope-")); t.after(() => rmSync(base, { recursive: true, force: true }));
  const office = join(base, "Office"), client = join(base, "Client"), subject = join(client, "Personal"), other = join(base, "Other");
  for (const dir of [office, client, subject, other]) mkdirSync(join(dir, "memory"), { recursive: true });
  writeFileSync(join(client, "client.md"), "---\ntype: client\n---\n"); writeFileSync(join(subject, "subject.md"), "---\ntype: subject\n---\n"); writeFileSync(join(other, "client.md"), "---\ntype: client\n---\n");
  for (const kind of ["contentious", "non_contentious"]) {
    const matter = join(subject, kind); mkdirSync(join(matter, "memory"), { recursive: true }); writeFileSync(join(matter, "matter.md"), `---\ntype: matter\nkind: ${kind}\n---\n`);
    const scope = readScope(matter); assert.equal(scope.subjectDir, subject); assert.equal(scope.clientDir, client); assert.equal(scope.records.length, 0);
  }
});

test("wrong caller matter and wrong literal anchor fail", t => {
  const f = fixture(t);
  assert.equal(readWorkspaceMemory(f.workspace, { ...f.options, matterId: "different" }).complete, false);
  f.profile.sources[0]!.anchors = ["different-case-identity"]; f.putProfile();
  assert.equal(f.load().complete, false);
});

test("malformed JSON, invalid UTF8, missing required and optional sources stay explicit", t => {
  const f = fixture(t); writeFileSync(f.profilePath, "{"); assert.equal(f.load().present, true); assert.equal(f.load().complete, false);
  f.putProfile(); writeFileSync(join(f.vault, "note.md"), Buffer.from([0xc3, 0x28])); assert.equal(f.load().complete, false);
  rmSync(join(f.vault, "note.md")); f.profile.sources[2]!.required = false; f.putProfile();
  const r = f.load(); assert.equal(r.sources.length, 4); assert.equal(r.sources.find(s => s.id === "note")!.content, null);
  assert.ok(r.problems.length > 0);
  rmSync(join(f.vault, "card.md")); assert.equal(f.load().complete, false);
});

test("source limit is an explicit failure, never truncated success", t => {
  const f = fixture(t); writeFileSync(join(f.vault, "note.md"), "x".repeat(WORKSPACE_MEMORY_LIMITS.sourceBytes + 1));
  const r = f.load(); assert.equal(r.complete, false); assert.equal(r.sources.find(s => s.id === "note")!.content, null);
});

test("internal profile alias is readable but duplicate physical sources remain rejected", { skip: fileSymlinkSkip }, t => {
  const f = fixture(t); const original = readFileSync(f.profilePath);
  rmSync(f.profilePath); writeFileSync(join(f.workspace, "profile.json"), original); symlinkSync(join(f.workspace, "profile.json"), f.profilePath);
  assert.equal(f.load().complete, true); rmSync(f.profilePath); f.putProfile();
  rmSync(join(f.vault, "note.md")); symlinkSync(join(f.vault, "card.md"), join(f.vault, "note.md")); assert.equal(f.load().complete, false);
});

test("hardlink source aliases are rejected (including NTFS)", t => {
  const f = fixture(t);
  rmSync(join(f.vault, "note.md")); linkSync(join(f.vault, "card.md"), join(f.vault, "note.md")); assert.equal(f.load().complete, false);
});

test("a local root alias cannot acquire authority from a separate external grant", { skip: dirSymlinkSkip }, t => {
  const f = fixture(t);
  symlinkSync(f.vault, join(f.workspace, "linked-vault"), "dir"); f.profile.roots[1]!.path = "linked-vault"; f.putProfile(); assert.equal(f.load().complete, false);
});

test("profile schema rejects traversal, unknown roles, duplicate IDs and absent required anchors", t => {
  const f = fixture(t);
  f.profile.sources[1]!.path = "../escape.md"; f.putProfile(); assert.equal(f.load().complete, false);
  f.profile.sources[1]!.path = "card.md"; f.profile.sources[1]!.role = "unexpected"; f.putProfile(); assert.equal(f.load().complete, false);
  f.profile.sources[1]!.role = "case_card"; f.profile.sources[1]!.id = "memory"; f.putProfile(); assert.equal(f.load().complete, false);
  f.profile.sources[1]!.id = "card"; f.profile.sources[0]!.anchors = []; f.putProfile(); assert.equal(f.load().complete, false);
});

test("preview is nonmutating and requires the complete writable set", t => {
  const f = fixture(t), req = f.request(), before = f.load();
  assert.equal(saveWorkspaceMemory(f.workspace, req, f.options).status, "preview");
  assert.equal(f.load().contextHash, before.contextHash); assert.deepEqual(readdirSync(join(f.workspace, ".lawoss")), ["memory-profile.json"]);
  req.updates.pop(); assert.equal(saveWorkspaceMemory(f.workspace, req, { ...f.options, apply: true }).status, "conflict");
});

test("CAS covers readonly sources and profile changes", t => {
  const f = fixture(t); f.profile.sources[2]!.writable = false; f.putProfile(); let req = f.request();
  writeFileSync(join(f.vault, "note.md"), "newer external edit");
  assert.equal(saveWorkspaceMemory(f.workspace, req, { ...f.options, apply: true }).status, "conflict");
  req = f.request(); f.profile.sources[2]!.path = "card.md"; f.putProfile();
  assert.equal(saveWorkspaceMemory(f.workspace, req, { ...f.options, apply: true }).status, "conflict");
});

test("save protects YAML and append-only task log", t => {
  const f = fixture(t); let req = f.request(); req.updates[0]!.content = req.updates[0]!.content.replace("case:", "other:");
  assert.equal(saveWorkspaceMemory(f.workspace, req, { ...f.options, apply: true }).status, "conflict");
  req = f.request(); req.updates[3]!.content = "rewritten log\n";
  assert.equal(saveWorkspaceMemory(f.workspace, req, { ...f.options, apply: true }).status, "conflict");
});

test("coordinated save keeps private old versions and replays idempotently", t => {
  const f = fixture(t), before = f.load(), req = f.request();
  const applied = saveWorkspaceMemory(f.workspace, req, { ...f.options, apply: true }); assert.equal(applied.status, "committed", JSON.stringify(applied));
  const after = f.load(); assert.equal(after.complete, true, JSON.stringify(after.problems)); assert.notEqual(after.contextHash, before.contextHash);
  for (const source of after.sources) assert.equal(source.content, req.updates.find(u => u.sourceId === source.id)!.content);
  const history = join(f.workspace, ".lawoss", "memory-history", req.operationId);
  if (process.platform !== "win32") assert.equal(statSync(history).mode & 0o077, 0);
  for (const source of before.sources) { const p = join(history, `${source.id}.before`); assert.equal(readFileSync(p, "utf8"), source.content); if (process.platform !== "win32") assert.equal(statSync(p).mode & 0o077, 0); }
  assert.equal(saveWorkspaceMemory(f.workspace, req, { ...f.options, apply: true }).status, "already-applied");
  assert.equal(f.load().contextHash, after.contextHash);
  req.reason = "different request"; assert.equal(saveWorkspaceMemory(f.workspace, req, { ...f.options, apply: true }).status, "conflict");
});

test("exclusive lock blocks saves; unfinished journal blocks reads and saves", t => {
  const f = fixture(t), req = f.request(); const history = join(f.workspace, ".lawoss", "memory-history"); mkdirSync(history);
  writeFileSync(join(history, "save.lock"), "another process");
  assert.equal(saveWorkspaceMemory(f.workspace, req, { ...f.options, apply: true }).status, "conflict"); rmSync(join(history, "save.lock"));
  const operation = join(history, "interrupted-op"); mkdirSync(operation); writeFileSync(join(operation, "journal.json"), JSON.stringify({ version: 1, status: "prepared" }));
  assert.equal(f.load().complete, false);
  assert.equal(saveWorkspaceMemory(f.workspace, req, { ...f.options, apply: true }).status, "conflict");
});

test("operation IDs cannot escape history and invalid request text cannot change files", t => {
  const f = fixture(t), req = f.request(); req.operationId = "../escape";
  assert.equal(saveWorkspaceMemory(f.workspace, req, { ...f.options, apply: true }).status, "error");
  assert.equal(existsSync(join(f.workspace, ".lawoss", "memory-history")), false);
  req.operationId = "valid-op"; req.updates[0]!.content += "\ud800";
  assert.equal(saveWorkspaceMemory(f.workspace, req, { ...f.options, apply: true }).status, "error");
});

test("a missing optional read-only source is explicit and does not block required context", t => {
  const f = fixture(t); f.profile.sources[2]!.required = false; f.profile.sources[2]!.writable = false; f.putProfile(); rmSync(join(f.vault, "note.md"));
  const report = f.load(); assert.equal(report.complete, true); assert.equal(report.sources[2]!.status, "missing");
  assert.equal(report.sources[2]!.sha256, null); assert.match(renderWorkspaceMemory(report), /Source content unavailable/);
});

test("directory source and blank anchors fail closed", t => {
  const f = fixture(t); rmSync(join(f.vault, "note.md")); mkdirSync(join(f.vault, "note.md")); assert.equal(f.load().complete, false);
  rmSync(join(f.vault, "note.md"), { recursive: true }); writeFileSync(join(f.vault, "note.md"), "note");
  f.profile.sources[0]!.anchors = ["  "]; f.putProfile(); assert.equal(f.load().complete, false);
});

test("symlink metadata directory fails closed", { skip: dirSymlinkSkip }, t => {
  const f = fixture(t);
  symlinkSync(f.vault, join(f.workspace, ".lawoss", "memory-history"), "dir"); assert.equal(f.load().complete, false);
});

test("role authority and control-file aliases cannot be made writable by a profile", t => {
  const f = fixture(t); f.profile.sources[1]!.role = "evidence"; f.putProfile(); assert.equal(f.load().complete, false);
  f.profile.sources[1]!.role = "case_card"; f.profile.sources[0]!.path = ".lawoss/memory-profile.json"; f.putProfile(); assert.equal(f.load().complete, false);
});


test("actual mid-write rename failure safely restores all installed sources", t => {
  const f = fixture(t), before = f.load(), request = f.request();
  const rename = fs.renameSync; let writes = 0;
  const mock = t.mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
    if (String(from).includes(".lawoss-memory-op-") && ++writes === 2) throw new Error("Injected second replacement failure");
    return rename(from, to);
  });
  syncBuiltinESMExports();
  let saved;
  try { saved = saveWorkspaceMemory(f.workspace, request, { ...f.options, apply: true }); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(writes, 2); assert.equal(saved.status, "error"); assert.equal(saved.rollback, "completed");
  assert.equal(f.load().complete, true); assert.equal(f.load().contextHash, before.contextHash);
  const journal = JSON.parse(readFileSync(join(saved.historyPath!, "journal.json"), "utf8")); assert.equal(journal.status, "rolled-back");
  assert.equal(existsSync(join(f.workspace, ".lawoss", "memory-history", "save.lock")), false);
});

test("mid-write failure never rolls back over a newer external edit", t => {
  const f = fixture(t), request = f.request();
  const rename = fs.renameSync; let writes = 0;
  const mock = t.mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
    if (String(from).includes(".lawoss-memory-op-") && ++writes === 2) {
      writeFileSync(join(f.workspace, "_memory.md"), "matter-test-01 external newer edit\n");
      throw new Error("Injected failure after external edit");
    }
    return rename(from, to);
  });
  syncBuiltinESMExports();
  let saved;
  try { saved = saveWorkspaceMemory(f.workspace, request, { ...f.options, apply: true }); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(saved.status, "error"); assert.equal(saved.rollback, "incomplete");
  assert.match(readFileSync(join(f.workspace, "_memory.md"), "utf8"), /external newer edit/);
  assert.equal(f.load().complete, false); assert.ok(f.load().problems.some(p => p.code === "unfinished-journal"));
});

test("profile UTF8 and total context byte limits are enforced", t => {
  const f = fixture(t); writeFileSync(f.profilePath, Buffer.from([0xff])); assert.equal(f.load().complete, false); f.putProfile();
  for (let i = 0; i < 9; i++) {
    const name = `large-${i}.md`; writeFileSync(join(f.vault, name), "x".repeat(WORKSPACE_MEMORY_LIMITS.sourceBytes));
    f.profile.sources.push({ id: `large-${i}`, root: "vault", path: name, role: "evidence", required: true, writable: false });
  }
  f.putProfile(); const report = f.load(); assert.equal(report.complete, false); assert.equal(report.sources.length, 13);
  assert.ok(report.problems.some(p => /Byte limit/.test(p.message)));
});

test("source permissions and UTF8 BOM survive coordinated replacement", t => {
  const f = fixture(t); writeFileSync(join(f.vault, "card.md"), "\uFEFF---\nkind: synthetic\n---\ncard\n");
  const beforeMode = statSync(join(f.vault, "card.md")).mode & 0o777;
  const request = f.request(); assert.equal(saveWorkspaceMemory(f.workspace, request, { ...f.options, apply: true }).status, "committed");
  if (process.platform !== "win32") assert.equal(statSync(join(f.vault, "card.md")).mode & 0o777, beforeMode);
  assert.equal(readFileSync(join(f.vault, "card.md"), "utf8"), request.updates[1]!.content);
});

test("live lock acquisition excludes a second cooperating writer", t => {
  const f = fixture(t), request = f.request(); const rename = fs.renameSync; let concurrent: string | undefined;
  const mock = t.mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
    if (String(from).includes(".lawoss-memory-op-") && concurrent === undefined) concurrent = saveWorkspaceMemory(f.workspace, { ...request, operationId: "concurrent-save" }, { ...f.options, apply: true }).status;
    return rename(from, to);
  });
  syncBuiltinESMExports(); let result;
  try { result = saveWorkspaceMemory(f.workspace, request, { ...f.options, apply: true }); }
  finally { mock.mock.restore(); syncBuiltinESMExports(); }
  assert.equal(result.status, "committed"); assert.equal(concurrent, "conflict");
});

test("control directories stay reserved through case aliases and external root mappings", t => {
  const f = fixture(t);
  const history = join(f.workspace, ".lawoss", "memory-history", "previous"); mkdirSync(history, { recursive: true });
  writeFileSync(join(history, "journal.json"), JSON.stringify({ version: 1, status: "committed" }));
  const snapshot = join(history, "memory.before"); writeFileSync(snapshot, "Original historical narrative\n");
  const alias = join(f.workspace, ".LAWOSS", "memory-history", "previous", "memory.before");
  const actualAlias = existsSync(alias) && statSync(alias).ino === statSync(snapshot).ino;
  t.diagnostic(`Case-insensitive control alias available: ${actualAlias}`);
  f.profile.sources[1]!.root = "case"; f.profile.sources[1]!.path = ".LAWOSS/memory-history/previous/memory.before"; f.putProfile();
  assert.equal(f.load().complete, false);
  f.profile.sources[1]!.required = false; f.profile.sources[1]!.writable = false;
  f.profile.sources[1]!.path = ".LAWOSS/memory-history/previous/missing.before"; f.putProfile();
  assert.equal(f.load().complete, false, "Optional missing control paths must still be reserved");
  const externalControl = join(f.vault, "other-workspace", ".lawoss"); mkdirSync(externalControl, { recursive: true });
  writeFileSync(join(externalControl, "snapshot.before"), "External historical narrative\n");
  f.profile.sources[1]!.root = "vault"; f.profile.sources[1]!.path = "other-workspace/.lawoss/snapshot.before"; f.putProfile();
  assert.equal(f.load().complete, false, "A vault grant does not authorize control metadata as memory sources");
  f.profile.roots[1]!.path = externalControl; f.profile.sources[1]!.path = "snapshot.before"; f.putProfile();
  assert.equal(f.load().complete, false, "A root must not hide the reserved component");
  assert.equal(readFileSync(snapshot, "utf8"), "Original historical narrative\n");
  assert.equal(readFileSync(join(externalControl, "snapshot.before"), "utf8"), "External historical narrative\n");
});

test("profile formatting and object order preserve semantic binding and pending SAVE", t => {
  const f = fixture(t), before = f.load(), request = f.request();
  const formatted = { sources: f.profile.sources.map(s => ({ writable: s.writable, role: s.role, path: s.path, required: s.required, root: s.root, id: s.id, ...(s.anchors ? { anchors: s.anchors } : {}) })), roots: f.profile.roots.map(r => ({ path: r.path, id: r.id })), matterId: f.profile.matterId, version: 1 };
  writeFileSync(f.profilePath, JSON.stringify(formatted, null, 2) + "\n");
  const after = f.load(); assert.equal(after.complete, true);
  assert.notEqual(after.profileHash, before.profileHash); assert.equal(after.bindingHash, before.bindingHash); assert.equal(after.contextHash, before.contextHash);
  assert.equal(saveWorkspaceMemory(f.workspace, request, { ...f.options, apply: true }).status, "committed");
});

test("identity, source mapping, roles, flags, anchors and grants remain bound", t => {
  const f = fixture(t), before = f.load(); const original = JSON.stringify(f.profile);
  const variants = [
    () => { f.profile.matterId = "matter-test-02"; },
    () => { writeFileSync(join(f.vault, "other-card.md"), "Other card\n"); f.profile.sources[1]!.path = "other-card.md"; },
    () => { f.profile.sources[1]!.role = "work_note"; },
    () => { f.profile.sources[1]!.required = false; },
    () => { f.profile.sources[1]!.writable = false; },
    () => { f.profile.sources[0]!.anchors = ["Old narrative"]; },
  ];
  for (const change of variants) {
    Object.assign(f.profile, JSON.parse(original)); change(); f.putProfile();
    const after = f.load(); assert.equal(after.complete, true); assert.notEqual(after.bindingHash, before.bindingHash);
  }
  Object.assign(f.profile, JSON.parse(original)); f.putProfile();
  assert.notEqual(readWorkspaceMemory(f.workspace, { allowedRoots: [f.vault, f.workspace] }).bindingHash, before.bindingHash);
});

test("case-equivalent source IDs are rejected before preview or history creation", t => {
  const f = fixture(t); f.profile.sources[1]!.id = "Memory"; f.putProfile();
  const report = f.load(); assert.equal(report.complete, false);
  assert.ok(report.problems.some(p => /duplicate source/i.test(p.message)));
  assert.equal(existsSync(join(f.workspace, ".lawoss", "memory-history")), false);
  f.profile.sources[1]!.id = "Card"; f.putProfile();
  const accepted = f.load(); assert.equal(accepted.complete, true); assert.ok(accepted.sources.some(s => s.id === "Card"));
  const request = f.request(); assert.equal(saveWorkspaceMemory(f.workspace, request, { ...f.options, apply: true }).status, "committed");
  assert.equal(readFileSync(join(f.workspace, ".lawoss", "memory-history", request.operationId, "Card.before"), "utf8"), "card old text\n");
});


test("root and ancestor aliases share physical bindings and coordinated writes", { skip: dirSymlinkSkip }, t => {
  for (const ancestor of [false, true]) {
    const f = fixture(t), alias = join(f.vault, "workspace-alias");
    symlinkSync(ancestor ? join(f.workspace, "..") : f.workspace, alias, "dir");
    const selected = ancestor ? join(alias, "case") : alias;
    const before = f.load(), request = f.request();
    const loaded = readWorkspaceMemory(selected, f.options);
    assert.equal(loaded.complete, true, JSON.stringify(loaded.problems));
    assert.equal(loaded.directory, f.workspace); assert.equal(loaded.bindingHash, before.bindingHash);
    const result = saveWorkspaceMemory(selected, request, { ...f.options, apply: true });
    assert.equal(result.status, "committed", JSON.stringify(result));
    assert.ok(result.changes.every(change => !change.path.includes("workspace-alias")));
    assert.equal(saveWorkspaceMemory(selected, request, { ...f.options, apply: true }).status, "already-applied");
  }
});

test("explicit grant aliases remain separate authority roots and permit physical writes", { skip: dirSymlinkSkip }, t => {
  const f = fixture(t), originalRequest = f.request(), alias = join(f.workspace, "..", "vault-alias");
  symlinkSync(f.vault, alias, "dir"); f.profile.roots[1]!.path = alias; f.putProfile();
  const options = { allowedRoots: [alias] };
  const report = readWorkspaceMemory(f.workspace, options);
  assert.equal(report.complete, true, JSON.stringify(report.problems));
  assert.equal(readWorkspaceMemory(f.workspace).complete, false);
  const request = { ...originalRequest, expectedBindingHash: report.bindingHash!, expectedContextHash: report.contextHash! };
  assert.equal(saveWorkspaceMemory(f.workspace, request, { ...options, apply: true }).status, "committed");
  assert.equal(readFileSync(join(f.vault, "card.md"), "utf8"), request.updates.find(u => u.sourceId === "card")!.content);
});

test("internal source and parent symlinks read and replace physical files without replacing links", { skip: fileSymlinkSkip || dirSymlinkSkip }, t => {
  const f = fixture(t), target = join(f.workspace, "physical"), alias = join(f.workspace, "linked");
  mkdirSync(target); fs.renameSync(join(f.workspace, "_memory.md"), join(target, "memory.md"));
  symlinkSync(target, alias, "dir"); symlinkSync(join(target, "memory.md"), join(alias, "source.md"));
  f.profile.sources[0]!.path = "linked/source.md"; f.putProfile();
  const before = f.load(); assert.equal(before.complete, true, JSON.stringify(before.problems));
  assert.equal(before.sources[0]!.path, join(target, "memory.md"));
  const request = f.request(), result = saveWorkspaceMemory(f.workspace, request, { ...f.options, apply: true });
  assert.equal(result.status, "committed", JSON.stringify(result));
  assert.equal(fs.lstatSync(join(alias, "source.md")).isSymbolicLink(), true);
  assert.equal(readFileSync(join(target, "memory.md"), "utf8"), request.updates[0]!.content);
  assert.equal(saveWorkspaceMemory(f.workspace, request, { ...f.options, apply: true }).status, "already-applied");
});

test("missing optional source resolves a safe existing ancestor, outside and dangling ancestors fail closed", { skip: dirSymlinkSkip }, t => {
  const f = fixture(t), inside = join(f.vault, "inside"), linked = join(f.vault, "linked");
  mkdirSync(inside); symlinkSync(inside, linked, "dir");
  f.profile.sources[2]!.path = "linked/not-created/note.md";
  f.profile.sources[2]!.required = false; f.profile.sources[2]!.writable = false; f.putProfile();
  const report = f.load(); assert.equal(report.complete, true, JSON.stringify(report.problems));
  assert.equal(report.sources[2]!.status, "missing"); assert.equal(report.sources[2]!.path, join(inside, "not-created/note.md"));
  assert.equal(existsSync(join(inside, "not-created")), false);
  const request = f.request();
  rmSync(linked); symlinkSync(f.workspace, linked, "dir");
  assert.equal(f.load().complete, false); // another allowed root is not this source's authority
  assert.equal(saveWorkspaceMemory(f.workspace, request, { ...f.options, apply: true }).status, "conflict");
  assert.equal(existsSync(join(f.workspace, "not-created")), false);
  assert.deepEqual(readdirSync(join(f.workspace, ".lawoss")), ["memory-profile.json"]);
  rmSync(linked); symlinkSync(join(f.vault, "absent"), linked, "dir");
  assert.equal(f.load().complete, false);
  assert.equal(existsSync(join(f.vault, "absent")), false);
});

test("outside source or profile links reject saves before any history or outside writes", { skip: fileSymlinkSkip }, t => {
  for (const profile of [false, true]) {
    const f = fixture(t), request = f.request(), outside = join(f.workspace, "..", "outside");
    mkdirSync(outside);
    const path = profile ? f.profilePath : join(f.workspace, "_memory.md"), target = join(outside, "file");
    const original = readFileSync(path); writeFileSync(target, original); rmSync(path); symlinkSync(target, path);
    const before = readdirSync(outside);
    assert.equal(f.load().complete, false);
    assert.equal(saveWorkspaceMemory(f.workspace, request, { ...f.options, apply: true }).status, "conflict");
    assert.deepEqual(readFileSync(target), original); assert.deepEqual(readdirSync(outside), before);
    assert.equal(existsSync(join(f.workspace, ".lawoss", "memory-history")), false);
  }
});

test("retargeting an internal alias after preview changes the binding and makes zero save writes", { skip: fileSymlinkSkip }, t => {
  const f = fixture(t), path = join(f.workspace, "_memory.md"), first = join(f.workspace, "first.md"), second = join(f.workspace, "second.md");
  const content = readFileSync(path); fs.renameSync(path, first); writeFileSync(second, content); symlinkSync(first, path);
  const request = f.request(); rmSync(path); symlinkSync(second, path);
  const result = saveWorkspaceMemory(f.workspace, request, { ...f.options, apply: true });
  assert.equal(result.status, "conflict");
  assert.deepEqual(readFileSync(first), content); assert.deepEqual(readFileSync(second), content);
  assert.equal(existsSync(join(f.workspace, ".lawoss", "memory-history")), false);
});

test("safe profile alias permits save while physical control files remain reserved", { skip: fileSymlinkSkip }, t => {
  const f = fixture(t), physicalProfile = join(f.workspace, "profile.json");
  fs.renameSync(f.profilePath, physicalProfile); symlinkSync(physicalProfile, f.profilePath);
  const profileBefore = readFileSync(physicalProfile), request = f.request();
  assert.equal(saveWorkspaceMemory(f.workspace, request, { ...f.options, apply: true }).status, "committed");
  assert.deepEqual(readFileSync(physicalProfile), profileBefore); assert.equal(fs.lstatSync(f.profilePath).isSymbolicLink(), true);
  symlinkSync(join(f.workspace, ".lawoss", "memory-history", request.operationId, "memory.before"), join(f.vault, "control-alias.md"));
  f.profile.sources[2]!.path = "control-alias.md"; writeFileSync(physicalProfile, JSON.stringify(f.profile));
  assert.equal(f.load().complete, false);
});


test("Node memory bundle reads and saves an alias root through the same physical binding", { skip: dirSymlinkSkip }, t => {
  const f = fixture(t), alias = join(f.vault, "case-alias"); symlinkSync(f.workspace, alias, "dir");
  const cli = fileURLToPath(new URL("../bundle/okf-memory.js", import.meta.url));
  const invoke = (command: string, args: string[] = []) => JSON.parse(execFileSync(process.execPath, [cli, command, alias, "--allow-root", f.vault, ...args, "--json"], { encoding: "utf8" }));
  const report = invoke("workspace-read"); assert.equal(report.complete, true); assert.equal(report.bindingHash, f.load().bindingHash);
  const requestFile = join(f.vault, "request.json"), request = f.request(); writeFileSync(requestFile, JSON.stringify(request));
  assert.equal(invoke("workspace-save", ["--file", requestFile, "--apply"]).status, "committed");
  assert.equal(invoke("workspace-save", ["--file", requestFile, "--apply"]).status, "already-applied");
});

test("a specifically granted alias below the workspace overrides the broader workspace authority", { skip: dirSymlinkSkip }, t => {
  for (const reverseGrants of [false, true]) {
    const f = fixture(t), originalRequest = f.request(), alias = join(f.workspace, "explicit-vault-grant");
    symlinkSync(f.vault, alias, "dir"); f.profile.roots[1]!.path = alias; f.putProfile();
    // The physical vault grant alone does not authorize traversal through this local alias.
    assert.equal(f.load().complete, false);
    const options = { allowedRoots: reverseGrants ? [alias, f.workspace] : [f.workspace, alias] };
    const report = readWorkspaceMemory(f.workspace, options);
    assert.equal(report.complete, true, JSON.stringify(report.problems));
    assert.equal(report.sources.find(s => s.id === "card")!.path, join(f.vault, "card.md"));
    const request = { ...originalRequest, expectedBindingHash: report.bindingHash!, expectedContextHash: report.contextHash! };
    const before = readFileSync(join(f.vault, "card.md"));
    assert.equal(saveWorkspaceMemory(f.workspace, request, { ...f.options, apply: true }).status, "conflict");
    assert.deepEqual(readFileSync(join(f.vault, "card.md")), before);
    assert.equal(existsSync(join(f.workspace, ".lawoss", "memory-history")), false);
    const saved = saveWorkspaceMemory(f.workspace, request, { ...options, apply: true });
    assert.equal(saved.status, "committed", JSON.stringify(saved));
    assert.equal(readFileSync(join(f.vault, "card.md"), "utf8"), request.updates.find(u => u.sourceId === "card")!.content);
    assert.equal(saveWorkspaceMemory(f.workspace, request, { ...options, apply: true }).status, "already-applied");
  }
});

test("profile lookup honors a specific alias grant below the workspace and retains external read-only authority", { skip: dirSymlinkSkip }, t => {
  const f = fixture(t), alias = join(f.workspace, "explicit-profile-grant"), physicalProfile = join(f.vault, "host-profile.json");
  symlinkSync(f.vault, alias, "dir"); writeFileSync(physicalProfile, readFileSync(f.profilePath));
  const options = { ...f.options, profilePath: join(alias, "host-profile.json"), profileIdentity: physicalProfile, profileGrants: [f.workspace, alias] };
  const report = readWorkspaceMemory(f.workspace, options);
  assert.equal(report.complete, true, JSON.stringify(report.problems));
  assert.ok(report.sources.every(source => !source.writable));
  assert.equal(readWorkspaceMemory(f.workspace, { ...options, profileGrants: [alias, f.workspace] }).bindingHash, report.bindingHash);
  assert.equal(readWorkspaceMemory(f.workspace, { ...options, profilePath: physicalProfile }).complete, true);
  // Granting the destination only must not silently grant the local alias.
  assert.equal(readWorkspaceMemory(f.workspace, { ...options, profileGrants: [f.vault] }).complete, false);
  const before = readFileSync(physicalProfile), memoryBefore = readFileSync(join(f.workspace, "_memory.md"));
  const request: WorkspaceMemorySaveRequest = { version: 1, matterId: report.matterId!, operationId: "external-profile-alias", reason: "external profiles remain read-only", expectedBindingHash: report.bindingHash!, expectedContextHash: report.contextHash!, updates: [] };
  assert.equal(saveWorkspaceMemory(f.workspace, request, { ...options, apply: true }).status, "conflict");
  assert.deepEqual(readFileSync(physicalProfile), before); assert.deepEqual(readFileSync(join(f.workspace, "_memory.md")), memoryBefore);
  assert.equal(existsSync(join(f.workspace, ".lawoss", "memory-history")), false);
});
