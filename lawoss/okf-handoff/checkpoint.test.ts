import { symlinkSkipReason } from "../tests/symlink-capability.mts";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHandoff } from "./checkpoint.mjs";
import { newRecord, serializeRecord } from "../okf-pamat/src/index.ts";
const fileSymlinkSkip = symlinkSkipReason("file");
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
  test("canonical and legacy project cards bind only when they are the single consistent project card", () => {
    for (const [name, type] of [["project.md", "projekt"], ["projekt.md", "project"]]) {
      const root = fixture();
      rmSync(join(root, "matter.md"));
      writeFileSync(join(root, name), `---\ntype: ${type}\n---\n# Synthetic project\n`);
      expect(createHandoff(root)).not.toBeNull();
    }

    const root = fixture();
    rmSync(join(root, "matter.md"));
    writeFileSync(join(root, "project.md"), "---\ntype: projekt\n---\n# Canonical project\n");
    writeFileSync(join(root, "projekt.md"), "---\ntype: projekt\n---\n# Different legacy project\n");
    expect(createHandoff(root)).toBeNull();

    const wrongType = fixture();
    rmSync(join(wrongType, "matter.md"));
    writeFileSync(join(wrongType, "project.md"), "---\ntype: spis\n---\n# Wrong card type\n");
    expect(createHandoff(wrongType)).toBeNull();
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


test.skipIf(Boolean(fileSymlinkSkip))(`automatic handoff refuses a projection symlink without touching its external referent${fileSymlinkSkip ? ` (${fileSymlinkSkip})` : ""}`, async () => {
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


test("native checkpoint carries the ban-list followed by the complete source record", async () => {
  const root = fixture();
  const source = newRecord({
    id: "A-901", type: "authority", jurisdiction: "sk", status: "banned",
    title: "Syntetický neplatný výklad", description: "Nepoužiť ako oporu",
    created: "2026-09-20", updated: "2026-09-20",
    truth: "Úplný dôvod zákazu je zachovaný aj keď ho opis neobsahuje.",
    timeline: [{ date: "2026-09-20", text: "Výklad označený za nepoužiteľný." }],
  });
  writeFileSync(join(root, "memory", "authority.md"), serializeRecord(source));
  const result = await createHandoff(root)!.checkpoint("ses_banlist", "before-compaction");
  expect(result.ok).toBe(true);
  const checkpoint = readFileSync(result.path!, "utf8");
  expect(checkpoint).toContain("## Necitovať (ban-list)");
  expect(checkpoint).toContain(source.truth);
  expect(checkpoint).toContain("status: banned");
  expect(checkpoint.indexOf("## Necitovať (ban-list)")).toBeLessThan(checkpoint.indexOf(source.truth));
});

function scopedMatterFixture() {
  const base = mkdtempSync(join(tmpdir(), "okf-handoff-scope-")); roots.push(base);
  const office = join(base, "Office");
  const client = join(office, "Klienti", "Client");
  const subject = join(client, "Subject");
  const matter = join(subject, "Matter");
  const sibling = join(office, "Klienti", "Sibling");
  for (const directory of [office, client, subject, matter, sibling]) mkdirSync(join(directory, "memory"), { recursive: true });
  writeFileSync(join(office, "okf.config"), "version: 1\n");
  writeFileSync(join(client, "client.md"), "---\ntype: client\n---\n");
  writeFileSync(join(subject, "subject.md"), "---\ntype: subject\n---\n");
  writeFileSync(join(matter, "matter.md"), "---\ntype: spis\n---\n");
  writeFileSync(join(sibling, "client.md"), "---\ntype: client\n---\n");
  writeFileSync(join(sibling, "memory", "sibling.md"), "sibling must not become a scope root");
  return { office, client, subject, matter, sibling };
}

test("native typed-matter handoff gates every read scope root before invoking the CLI", async () => {
  const f = scopedMatterFixture();
  let calls = 0;
  const denied = createHandoff(f.matter, {
    resolveAllowedRoots: async () => [f.matter, f.subject, f.client].map(path => realpathSync(path)),
    cli: () => { calls += 1; return { code: 0, out: "must not read" }; },
  })!;
  const result = await denied.checkpoint("ses_scope_denied", "before-turn");
  expect(result.ok).toBe(false);
  expect(result.error).toContain("do not allow every matter scope root");
  expect(calls).toBe(0);
});

test("native typed-matter handoff accepts the granted office scope without requiring a sibling client", async () => {
  const f = scopedMatterFixture();
  const granted = [f.matter, f.subject, f.client, f.office].map(path => realpathSync(path));
  expect(granted).not.toContain(realpathSync(f.sibling));
  const calls: string[] = [];
  const handoff = createHandoff(f.matter, {
    resolveAllowedRoots: async () => granted,
    cli: (args: string[]) => { calls.push(args[0]!); return { code: 0, out: args[0] === "read" ? "authorized scope" : "synced" }; },
  })!;
  const result = await handoff.checkpoint("ses_scope_granted", "before-turn");
  expect(result.ok).toBe(true);
  expect(calls).toEqual(["read", "sync", "read"]);
});
