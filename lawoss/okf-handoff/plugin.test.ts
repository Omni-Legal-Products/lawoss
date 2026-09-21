import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LawossOkfHandoff } from "./plugin.mjs";
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "okf-hook-")); roots.push(root);
  writeFileSync(join(root, "spis.md"), "---\ntype: spis\njurisdiction: sk\n---\n# Synthetic\n");
  mkdirSync(join(root, "memory"));
  writeFileSync(join(root, "VSTUPY.md"), "| ID | Stav |\n|---|---|\n| INPUT-1 | pending |\n");
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("native engine handoff hooks", () => {
  test("precompaction persists context and appends it without replacing upstream prompt", async () => {
    const root = fixture(); const hooks = await LawossOkfHandoff({ directory: root });
    const output = { context: ["upstream context"], prompt: "upstream compaction prompt" };
    await hooks["experimental.session.compacting"]!({ sessionID: "ses_compact" }, output);
    expect(output.prompt).toBe("upstream compaction prompt"); expect(output.context[0]).toBe("upstream context");
    expect(output.context[1]).toContain("INPUT-1");
    expect(readFileSync(join(root, ".lawoss/handoff/ses_compact.md"), "utf8")).toContain("INPUT-1");
  });
  test("idle writes deterministic checkpoint, unrelated events do nothing, next turn uses durable path", async () => {
    const root = fixture(); const hooks = await LawossOkfHandoff({ directory: root });
    await hooks.event!({ event: { type: "message.updated", properties: { sessionID: "ses_work" } } });
    expect(existsSync(join(root, ".lawoss"))).toBe(false);
    await hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses_work" } } });
    const path = join(root, ".lawoss/handoff/ses_work.md"); const before = readFileSync(path, "utf8");
    await hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses_work" } } });
    expect(readFileSync(path, "utf8")).toBe(before);
    const output = { system: ["upstream"] };
    await hooks["experimental.chat.system.transform"]!({ sessionID: "ses_work" }, output);
    expect(output.system[0]).toBe("upstream"); expect(output.system[1]).toContain(path);
  });
  test("corrupt memory injects visible failure and does not replace good checkpoint", async () => {
    const root = fixture(); const hooks = await LawossOkfHandoff({ directory: root });
    await hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses_error" } } });
    const path = join(root, ".lawoss/handoff/ses_error.md"); const good = readFileSync(path, "utf8");
    writeFileSync(join(root, "memory/broken.md"), "not an OKF record");
    const output = { context: [] as string[] };
    await hooks["experimental.session.compacting"]!({ sessionID: "ses_error" }, output);
    expect(output.context[0]).toContain("FAILED"); expect(readFileSync(path, "utf8")).toBe(good);
  });
  test("symlink handoff directory cannot send data outside the matter", async () => {
    const root = fixture(); const external = fixture(); symlinkSync(external, join(root, ".lawoss"));
    const hooks = await LawossOkfHandoff({ directory: root }); const output = { context: [] as string[] };
    await hooks["experimental.session.compacting"]!({ sessionID: "ses_link" }, output);
    expect(output.context[0]).toContain("FAILED"); expect(existsSync(join(external, "handoff"))).toBe(false);
  });
});

test("large context stays complete on disk but compaction receives explicit bounded handoff", async () => {
  const root = fixture(); const source = "SOURCE-END-OF-LARGE-INPUT";
  writeFileSync(join(root, "VSTUPY.md"), `# Inputs\n${"x".repeat(70 * 1024)}\n${source}\n`);
  const hooks = await LawossOkfHandoff({ directory: root }); const output = { context: [] as string[], prompt: "upstream" };
  await hooks["experimental.session.compacting"]!({ sessionID: "ses_large" }, output);
  expect(readFileSync(join(root, ".lawoss/handoff/ses_large.md"), "utf8")).toContain(source);
  expect(output.context[0]).toContain("Full context was NOT injected");
  expect(output.context[0]).toContain("read persisted sources in batches");
  expect(Buffer.byteLength(output.context[0])).toBeLessThan(1024);
  expect(output.context[0]).not.toContain(source); expect(output.prompt).toBe("upstream");
});

test("native checkpoint keeps manual phase, notes and stale date across first sync", async () => {
  const root = fixture();
  writeFileSync(join(root, "_STATUS.md"), "---\ntype: status\nmanual_updated: 2026-08-01\n---\n\n# Status\n\n> **Fáza:** Čakáme na podklad.\n\n## Poznámka\nDôležitý ručný fakt.\n");
  const hooks = await LawossOkfHandoff({ directory: root });
  const output = { context: [] as string[] };
  await hooks["experimental.session.compacting"]!({ sessionID: "ses_manual" }, output);
  const checkpoint = readFileSync(join(root, ".lawoss/handoff/ses_manual.md"), "utf8");
  expect(checkpoint).toContain("Čakáme na podklad.");
  expect(checkpoint).toContain("Dôležitý ručný fakt.");
  expect(checkpoint).toContain("manual_updated: 2026-08-01");
  await hooks.event!({ event: { type: "session.idle", properties: { sessionID: "ses_manual" } } });
  expect(readFileSync(join(root, ".lawoss/handoff/ses_manual.md"), "utf8")).toBe(checkpoint);
});
