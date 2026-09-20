import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandoff } from "./checkpoint.mjs";
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "okf-handoff-")); roots.push(root);
  writeFileSync(join(root, "matter.md"), "---\ntype: spis\njurisdiction: sk\n---\n# Synthetic matter\n");
  mkdirSync(join(root, "memory"));
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("durable local OKF handoff", () => {
  test("normal and office roots are no-op, never selecting a descendant matter", async () => {
    const matter = fixture(); const office = join(matter, "office"); mkdirSync(office);
    let calls = 0;
    expect(createHandoff(office, { cli: () => { calls++; throw new Error("must not read"); } })).toBeNull();
    expect(calls).toBe(0); expect(existsSync(join(office, ".lawoss"))).toBe(false);
  });
  test("card with wrong type and conflicting cards do not bind", () => {
    const root = fixture(); writeFileSync(join(root, "matter.md"), "---\ntype: klient\n---\n");
    expect(createHandoff(root)).toBeNull();
    writeFileSync(join(root, "matter.md"), "---\ntype: spis\n---\n");
    writeFileSync(join(root, "spis.md"), "---\ntype: spis\n---\n# different\n");
    expect(createHandoff(root)).toBeNull();
  });
  test("writes full CLI context and hash atomically, deduplicates unchanged idle", async () => {
    const root = fixture(); const calls: string[][] = [];
    const handoff = createHandoff(root, { cli: (args: string[]) => { calls.push(args); return { code: 0, out: args[0] === "read" ? "Full source context\nRevision U-1: abc\nPending input" : "synced" }; } })!;
    const first = await handoff.checkpoint("ses_test", "idle");
    expect(first.ok).toBe(true); expect(readFileSync(first.path!, "utf8")).toContain("Full source context\nRevision U-1: abc\nPending input");
    expect(readFileSync(first.path!, "utf8")).toMatch(/context_sha256: [a-f0-9]{64}/);
    const previous = readFileSync(first.path!, "utf8");
    const second = await handoff.checkpoint("ses_test", "idle");
    expect(second.changed).toBe(false); expect(readFileSync(first.path!, "utf8")).toBe(previous);
    expect(calls.filter((args) => args[0] === "sync")).toHaveLength(1);
  });
  test("read or sync failure preserves previous good checkpoint and exposes error", async () => {
    const root = fixture(); let fail = "";
    const handoff = createHandoff(root, { cli: (args: string[]) => ({ code: args[0] === fail ? 1 : 0, out: args[0] === fail ? "incomplete memory" : `${fail} full context` }) })!;
    const good = await handoff.checkpoint("ses_test", "idle"); const before = readFileSync(good.path!, "utf8");
    for (const command of ["read", "sync"]) {
      fail = command;
      const result = await handoff.checkpoint("ses_test", "before-compaction");
      expect(result.ok).toBe(false); expect(readFileSync(good.path!, "utf8")).toBe(before);
      expect(readFileSync(join(root, ".lawoss", "handoff", "ses_test.status.md"), "utf8")).toContain("error");
    }
  });
  test("changed sources during sync reject publication", async () => {
    const root = fixture(); let reads = 0;
    const handoff = createHandoff(root, { cli: (args: string[]) => ({ code: 0, out: args[0] === "read" ? `source ${++reads}` : "synced" }) })!;
    const result = await handoff.checkpoint("ses_test", "idle");
    expect(result.ok).toBe(false); expect(existsSync(join(root, ".lawoss", "handoff", "ses_test.md"))).toBe(false);
  });
  test("real memory CLI works without model, shell, Git or network", async () => {
    const root = fixture(); const handoff = createHandoff(root)!;
    const result = await handoff.checkpoint("ses_real", "before-compaction");
    expect(result.ok).toBe(true); expect(result.context).toContain("Spis:");
    expect(existsSync(join(root, ".git"))).toBe(false);
  });
});

test("changed matter binding after good checkpoint reports error without overwriting it", async () => {
  const root = fixture(); const handoff = createHandoff(root)!;
  const good = await handoff.checkpoint("ses_binding", "idle"); const before = readFileSync(good.path!, "utf8");
  writeFileSync(join(root, "matter.md"), "---\ntype: spis\njurisdiction: sk\n---\n# Another matter\n");
  expect((await handoff.checkpoint("ses_binding", "before-compaction")).ok).toBe(false);
  expect(readFileSync(good.path!, "utf8")).toBe(before);
  expect(readFileSync(join(root, ".lawoss/handoff/ses_binding.status.md"), "utf8")).toContain("state: error");
});


test("automatic handoff refuses a projection symlink without touching its external referent", async () => {
  const root = fixture();
  const outside = mkdtempSync(join(tmpdir(), "okf-handoff-external-")); roots.push(outside);
  const original = join(outside, "original.txt"); writeFileSync(original, "external original");
  symlinkSync(original, join(root, "memory", "log.md"));
  const result = await createHandoff(root)!.checkpoint("ses_symlink", "before-turn");
  expect(result.ok).toBe(false);
  expect(readFileSync(original, "utf8")).toBe("external original");
  expect(existsSync(join(root, "_STATUS.md"))).toBe(false);
  expect(readFileSync(join(root, ".lawoss/handoff/ses_symlink.status.md"), "utf8")).toContain("state: error");
});
