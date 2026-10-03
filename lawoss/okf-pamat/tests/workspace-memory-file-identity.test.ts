import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("large file identities preserve distinct memory sources and checkpoint grants while rejecting hardlinks", t => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "memory-file-identity-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, "matter"), vault = join(base, "vault");
  mkdirSync(join(root, ".lawoss"), { recursive: true });
  mkdirSync(vault);
  const sources = [
    { id: "memory", root: "matter", path: "memory.md", role: "case_memory", required: true, writable: true, anchors: ["identity-test"] },
    { id: "card", root: "vault", path: "card.md", role: "case_card", required: true, writable: true },
    { id: "note", root: "vault", path: "note.md", role: "work_note", required: true, writable: true },
    { id: "log", root: "vault", path: "log.md", role: "task_log", required: true, writable: true },
  ];
  writeFileSync(join(root, ".lawoss/memory-profile.json"), JSON.stringify({
    version: 1, matterId: "identity-test", roots: [{ id: "matter", path: "." }, { id: "vault", path: vault }], sources,
  }));
  for (const source of sources) writeFileSync(join(source.root === "matter" ? root : vault, source.path), `identity-test ${source.id}`);

  // Model NTFS IDs beyond Number.MAX_SAFE_INTEGER in an isolated Node process.
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    import fs from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    import { join } from "node:path";
    const [root, vault, readerUrl, handoffUrl] = process.argv.slice(1);
    const ids = new Map();
    let next = 9007199254740992n;
    for (const path of [join(root, "memory.md"), ...["card", "note", "log"].map(name => join(vault, name + ".md"))]) {
      const stat = fs.lstatSync(path, { bigint: true });
      ids.set(String(stat.dev) + ":" + String(stat.ino), next++);
    }
    for (const name of ["fstatSync", "lstatSync"]) {
      const original = fs[name];
      fs[name] = (target, options) => {
        const exact = original(target, { ...options, bigint: true });
        if (!exact) return exact;
        const id = ids.get(String(exact.dev) + ":" + String(exact.ino));
        const stat = original(target, options);
        if (id !== undefined) stat.ino = options?.bigint ? id : Number(id);
        return stat;
      };
    }
    syncBuiltinESMExports();
    const { readWorkspaceMemory } = await import(readerUrl);
    const { createWorkspaceHandoff } = await import(handoffUrl);
    const report = readWorkspaceMemory(root, { allowedRoots: [vault] });
    assert.equal(report.complete, true, JSON.stringify(report.problems));
    let grants = [vault];
    const handoff = createWorkspaceHandoff(root, { resolveAllowedRoots: async () => grants });
    const good = await handoff.checkpoint("ses_identity", "idle");
    assert.equal(good.ok, true, good.error);
    const before = fs.readFileSync(good.path, "utf8");
    grants = [];
    assert.equal((await handoff.checkpoint("ses_identity", "before-turn")).ok, false);
    assert.equal(fs.readFileSync(good.path, "utf8"), before);
    fs.rmSync(join(vault, "note.md"));
    fs.linkSync(join(vault, "card.md"), join(vault, "note.md"));
    const alias = readWorkspaceMemory(root, { allowedRoots: [vault] });
    assert.equal(alias.complete, false);
    assert.ok(alias.problems.some(problem => /Duplicate physical source/.test(problem.message)));
  `, root, vault, new URL("../src/workspace-memory.ts", import.meta.url).href,
    new URL("../../okf-handoff/workspace-checkpoint.mjs", import.meta.url).href], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
