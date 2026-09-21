import { afterEach, expect, test, spyOn } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandoff } from "./checkpoint.mjs";
import { createWorkspaceHandoff } from "./workspace-checkpoint.mjs";
import { LawossOkfHandoff } from "./plugin.mjs";
import { readWorkspaceMemory, saveWorkspaceMemory } from "../okf-pamat/src/workspace-memory.ts";

const roots: string[] = [];
const originalEnv = process.env.LAWOSS_MEMORY_ALLOWED_ROOTS;
function fixture(external = false) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "file-handoff-"))); roots.push(base);
  const root = join(base, "matter"), vault = join(base, "vault");
  for (const path of [root, vault, join(root, ".lawoss")]) mkdirSync(path);
  const profile = { version: 1, matterId: "synthetic-01", roots: [{ id: "matter", path: "." }, { id: "vault", path: external ? vault : "." }], sources: [
    { id: "memory", root: "matter", path: "_memory.md", role: "case_memory", required: true, writable: true, anchors: ["SYNTHETIC-01"] },
    { id: "card", root: "vault", path: "card.md", role: "case_card", required: true, writable: true },
    { id: "note", root: "vault", path: "note.md", role: "work_note", required: true, writable: true },
    { id: "log", root: "vault", path: "log.md", role: "task_log", required: true, writable: true },
  ] };
  const profilePath = join(root, ".lawoss/memory-profile.json");
  writeFileSync(profilePath, JSON.stringify(profile));
  for (const s of profile.sources) writeFileSync(join(s.root === "matter" || !external ? root : vault, s.path), `---\noriginal_date: 2020-01-02\n---\nSYNTHETIC-01 ${s.id}\n[[source-link]]\nPending work\n`);
  return { root, vault, profile, profilePath };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); if (originalEnv === undefined) delete process.env.LAWOSS_MEMORY_ALLOWED_ROOTS; else process.env.LAWOSS_MEMORY_ALLOWED_ROOTS = originalEnv; });

test("full SAVE → fresh native factory/session preserves new content, dates, links and no typed projections", async () => {
  const f = fixture(true); process.env.LAWOSS_MEMORY_ALLOWED_ROOTS = JSON.stringify([f.vault]);
  const report = readWorkspaceMemory(f.root, { allowedRoots: [f.vault] }); expect(report.complete).toBe(true);
  const handoff = createHandoff(f.root, { cli: () => { throw new Error("typed CLI must never run"); } })!;
  const first = await handoff.checkpoint("ses_loop", "idle"); expect(first.ok).toBe(true);
  const saved = saveWorkspaceMemory(f.root, { version: 1, matterId: report.matterId!, operationId: "native-loop", reason: "Synthetic work", expectedBindingHash: report.bindingHash!, expectedContextHash: report.contextHash!, updates: report.sources.map(s => ({ sourceId: s.id, expectedSha256: s.sha256!, content: s.content + "Saved current work\n" })) }, { allowedRoots: [f.vault], apply: true });
  expect(saved.status).toBe("committed");
  for (const session of ["ses_loop", "ses_fresh"]) {
    const result = await createHandoff(f.root)!.checkpoint(session, "before-turn"); expect(result.ok).toBe(true);
    const text = readFileSync(result.path!, "utf8");
    for (const s of readWorkspaceMemory(f.root, { allowedRoots: [f.vault] }).sources) expect(text).toContain(s.content!);
    expect(text).toContain("original_date: 2020-01-02"); expect(text).toContain("[[source-link]]");
    expect(lstatSync(result.path!).mode & 0o777).toBe(0o600);
  }
  expect(existsSync(join(f.root, "memory"))).toBe(false); expect(existsSync(join(f.root, "_STATUS.md"))).toBe(false);
});

test("unchanged stable hashes deduplicate despite loadedAt; content updates accepted, source race rejected", async () => {
  const f = fixture(); let sequence = 0;
  const handoff = createWorkspaceHandoff(f.root, { read: (root: string, options: { allowedRoots: string[] }) => ({ ...readWorkspaceMemory(root, options), loadedAt: `load-${++sequence}` }) });
  const first = await handoff.checkpoint("ses_hash", "idle"); const original = readFileSync(first.path!, "utf8");
  expect((await handoff.checkpoint("ses_hash", "idle")).changed).toBe(false); expect(readFileSync(first.path!, "utf8")).toBe(original);
  writeFileSync(join(f.root, "_memory.md"), "SYNTHETIC-01 updated\n");
  expect((await handoff.checkpoint("ses_hash", "before-turn")).changed).toBe(true);
  let reads = 0;
  const racing = createWorkspaceHandoff(f.root, { read: (root: string, options: { allowedRoots: string[] }) => { const report = readWorkspaceMemory(root, options); if (++reads === 1) writeFileSync(join(root, "note.md"), "racing revision"); return report; } });
  const good = readFileSync(first.path!, "utf8"); expect((await racing.checkpoint("ses_hash", "idle")).ok).toBe(false); expect(readFileSync(first.path!, "utf8")).toBe(good);
});

test("persisted SAME-session binding survives factory rebuild while new session can bind changed mapping", async () => {
  const f = fixture(); const handoff = createHandoff(f.root)!;
  const first = await handoff.checkpoint("ses_pin", "idle"); const before = readFileSync(first.path!, "utf8");
  writeFileSync(f.profilePath, JSON.stringify(f.profile, null, 4));
  expect((await createHandoff(f.root)!.checkpoint("ses_pin", "idle")).ok).toBe(true);
  const formatted = readFileSync(first.path!, "utf8");
  f.profile.sources[1]!.path = "card-v2.md"; writeFileSync(join(f.root, "card-v2.md"), "New mapping"); writeFileSync(f.profilePath, JSON.stringify(f.profile));
  for (const candidate of [handoff, createHandoff(f.root)!]) expect((await candidate.checkpoint("ses_pin", "before-compaction")).ok).toBe(false);
  expect(readFileSync(first.path!, "utf8")).toBe(formatted); expect(before).toContain("SYNTHETIC-01");
  expect((await handoff.checkpoint("ses_new", "idle")).ok).toBe(true);
  expect((await createHandoff(f.root)!.checkpoint("ses_fresh", "idle")).ok).toBe(true);
  rmSync(f.profilePath);
  expect((await handoff.checkpoint("ses_pin", "before-turn")).ok).toBe(false);
  expect((await createHandoff(f.root)!.checkpoint("ses_pin", "before-turn")).ok).toBe(false);
});

test("missing grants, malformed host JSON and invalid profile create visible failure hooks", async () => {
  const f = fixture(true);
  for (const value of [undefined, "{", '"/absolute"', '["relative"]', '[42]']) {
    if (value === undefined) delete process.env.LAWOSS_MEMORY_ALLOWED_ROOTS; else process.env.LAWOSS_MEMORY_ALLOWED_ROOTS = value;
    const hooks = await LawossOkfHandoff({ directory: f.root }); const output = { context: ["upstream"], prompt: "preserved" };
    await hooks["experimental.session.compacting"]!({ sessionID: "ses_grants" }, output);
    expect(output.context[1]).toContain("FAILED"); expect(output.context[0]).toBe("upstream"); expect(output.prompt).toBe("preserved");
  }
  process.env.LAWOSS_MEMORY_ALLOWED_ROOTS = JSON.stringify([f.vault]); writeFileSync(f.profilePath, "{");
  const output = { system: ["upstream"] }; await (await LawossOkfHandoff({ directory: f.root }))["experimental.chat.system.transform"]!({ sessionID: "ses_invalid" }, output);
  expect(output.system[1]).toContain("FAILED");
});

test("missing/invalid UTF-8/symlink/oversized sources retain last good checkpoint and error status", async () => {
  const f = fixture(); const handoff = createHandoff(f.root)!;
  const first = await handoff.checkpoint("ses_error", "idle"); const good = readFileSync(first.path!, "utf8"); const path = join(f.root, "note.md");
  for (const fail of [() => rmSync(path), () => writeFileSync(path, Buffer.from([0xff])), () => { rmSync(path); symlinkSync(join(f.root, "card.md"), path); }, () => { rmSync(path); writeFileSync(path, "x".repeat(2 * 1024 * 1024)); }]) {
    fail(); expect((await handoff.checkpoint("ses_error", "before-compaction")).ok).toBe(false);
    expect(readFileSync(first.path!, "utf8")).toBe(good); expect(readFileSync(join(f.root, ".lawoss/handoff/ses_error.status.md"), "utf8")).toContain("not current");
  }
});

test("all native lifecycle hooks read current sources, preserve outputs, report failure and bound inline context", async () => {
  const f = fixture(); const hooks = await LawossOkfHandoff({ directory: f.root });
  await hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses_hooks" } } });
  writeFileSync(join(f.root, "note.md"), "updated before turn"); const system = { system: ["upstream"] };
  await hooks["experimental.chat.system.transform"]!({ sessionID: "ses_hooks" }, system);
  const path = join(f.root, ".lawoss/handoff/ses_hooks.md"); expect(readFileSync(path, "utf8")).toContain("updated before turn"); expect(system.system[0]).toBe("upstream");
  writeFileSync(join(f.root, "note.md"), "x".repeat(70 * 1024) + "COMPLETE-END"); const output = { context: ["upstream"], prompt: "keep" };
  await hooks["experimental.session.compacting"]!({ sessionID: "ses_hooks" }, output);
  expect(output.context[1]).toContain("Full context was NOT injected"); expect(output.context[1]).toContain("read persisted sources in batches"); expect(readFileSync(path, "utf8")).toContain("COMPLETE-END");
  const good = readFileSync(path, "utf8"); rmSync(join(f.root, "note.md"));
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  try { await hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses_hooks" } } }); expect(warning).toHaveBeenCalled(); expect(String(warning.mock.calls[0]![0])).toContain("not current"); }
  finally { warning.mockRestore(); }
  expect(readFileSync(path, "utf8")).toBe(good);
});

test("invalid session IDs, unsafe directories/metadata/targets cannot redirect checkpoint writes", async () => {
  for (const target of ["directory", "metadata", "checkpoint", "status"]) {
    const f = fixture(); const handoff = createHandoff(f.root)!;
    const good = await handoff.checkpoint("ses_safe", "idle"); const before = readFileSync(good.path!, "utf8");
    expect((await handoff.checkpoint("../escape", "idle")).ok).toBe(false);
    const outside = join(f.vault, "outside.txt"); writeFileSync(outside, "untouched");
    const path = target === "directory" ? join(f.root, ".lawoss/handoff") : target === "metadata" ? join(f.root, ".lawoss/handoff/ses_safe.workspace-binding.json") : target === "status" ? join(f.root, ".lawoss/handoff/ses_safe.status.md") : good.path!;
    rmSync(path, { recursive: true }); symlinkSync(target === "directory" ? f.vault : outside, path);
    expect((await handoff.checkpoint("ses_safe", "idle")).ok).toBe(false); expect(readFileSync(outside, "utf8")).toBe("untouched");
    if (target === "metadata" || target === "status") expect(readFileSync(good.path!, "utf8")).toBe(before);
  }
  const f = fixture(); await createHandoff(f.root)!.checkpoint("ses_bad", "idle");
  writeFileSync(join(f.root, ".lawoss/handoff/ses_bad.workspace-binding.json"), JSON.stringify({ version: 1, root: f.root, matterId: "synthetic-01", bindingHash: "invalid", allowedRoots: [f.vault] }));
  expect((await createHandoff(f.root)!.checkpoint("ses_bad", "idle")).ok).toBe(false);
});

test("restart without host grants cannot recover authority from persisted binding metadata", async () => {
  const f = fixture(true); process.env.LAWOSS_MEMORY_ALLOWED_ROOTS = JSON.stringify([f.vault]);
  const good = await createHandoff(f.root)!.checkpoint("ses_authority", "idle"); const before = readFileSync(good.path!, "utf8");
  const marker = join(f.root, ".lawoss/handoff/ses_authority.workspace-binding.json");
  writeFileSync(marker, JSON.stringify({ ...JSON.parse(readFileSync(marker, "utf8")), allowedRoots: [f.vault] }));
  for (const value of [undefined, "{"]) {
    if (value === undefined) delete process.env.LAWOSS_MEMORY_ALLOWED_ROOTS; else process.env.LAWOSS_MEMORY_ALLOWED_ROOTS = value;
    const handoff = createHandoff(f.root)!;
    expect((await handoff.checkpoint("ses_authority", "before-turn")).ok).toBe(false);
    expect(readFileSync(good.path!, "utf8")).toBe(before);
    expect(readFileSync(join(f.root, ".lawoss/handoff/ses_authority.status.md"), "utf8")).toContain("state: error");
  }
});

test("live host grant revocation preserves stale checkpoint and ignores environment", async () => {
  const f = fixture(true); process.env.LAWOSS_MEMORY_ALLOWED_ROOTS = JSON.stringify([f.vault]);
  let grants = [f.vault], calls = 0;
  const handoff = createWorkspaceHandoff(f.root, { resolveAllowedRoots: async () => { calls++; return grants; } });
  const first = await handoff.checkpoint("ses_live", "idle"); expect(first.ok).toBe(true);
  const good = readFileSync(first.path!, "utf8"); grants = [];
  expect((await handoff.checkpoint("ses_live", "before-turn")).ok).toBe(false);
  expect(calls).toBeGreaterThanOrEqual(3);
  expect(readFileSync(first.path!, "utf8")).toBe(good);
  expect(readFileSync(join(f.root, ".lawoss/handoff/ses_live.status.md"), "utf8")).toContain("not current");
});

test("host grant is refreshed for the final checkpoint read too", async () => {
  const f = fixture(true); let calls = 0;
  const handoff = createWorkspaceHandoff(f.root, { resolveAllowedRoots: async () => ++calls === 1 ? [f.vault] : [] });
  expect((await handoff.checkpoint("ses_race", "idle")).ok).toBe(false);
  expect(calls).toBe(2);
  expect(existsSync(join(f.root, ".lawoss/handoff/ses_race.md"))).toBe(false);
});
