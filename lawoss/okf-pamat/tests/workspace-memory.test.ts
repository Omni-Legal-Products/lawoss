import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, realpathSync, symlinkSync, linkSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWorkspaceMemory, renderWorkspaceMemory, saveWorkspaceMemory, WORKSPACE_MEMORY_LIMITS, type WorkspaceMemorySaveRequest } from "../src/workspace-memory.ts";

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

test("symlink profile, root, source and hardlink aliases are rejected", t => {
  const f = fixture(t); const original = readFileSync(f.profilePath);
  rmSync(f.profilePath); writeFileSync(join(f.workspace, "profile.json"), original); symlinkSync(join(f.workspace, "profile.json"), f.profilePath);
  assert.equal(f.load().complete, false); rmSync(f.profilePath); f.putProfile();
  rmSync(join(f.vault, "note.md")); symlinkSync(join(f.vault, "card.md"), join(f.vault, "note.md")); assert.equal(f.load().complete, false);
  rmSync(join(f.vault, "note.md")); linkSync(join(f.vault, "card.md"), join(f.vault, "note.md")); assert.equal(f.load().complete, false);
  rmSync(join(f.vault, "note.md")); writeFileSync(join(f.vault, "note.md"), "note");
  symlinkSync(f.vault, join(f.workspace, "linked-vault")); f.profile.roots[1]!.path = "linked-vault"; f.putProfile(); assert.equal(f.load().complete, false);
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
  assert.equal(statSync(history).mode & 0o077, 0);
  for (const source of before.sources) { const p = join(history, `${source.id}.before`); assert.equal(readFileSync(p, "utf8"), source.content); assert.equal(statSync(p).mode & 0o077, 0); }
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

test("directory source, unsafe metadata directory and blank anchors fail closed", t => {
  const f = fixture(t); rmSync(join(f.vault, "note.md")); mkdirSync(join(f.vault, "note.md")); assert.equal(f.load().complete, false);
  rmSync(join(f.vault, "note.md"), { recursive: true }); writeFileSync(join(f.vault, "note.md"), "note");
  f.profile.sources[0]!.anchors = ["  "]; f.putProfile(); assert.equal(f.load().complete, false);
  f.profile.sources[0]!.anchors = ["matter-test-01"]; f.putProfile();
  symlinkSync(f.vault, join(f.workspace, ".lawoss", "memory-history")); assert.equal(f.load().complete, false);
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
  assert.equal(statSync(join(f.vault, "card.md")).mode & 0o777, beforeMode);
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
