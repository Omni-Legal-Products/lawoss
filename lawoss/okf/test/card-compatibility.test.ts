import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apply, detect, plan, render, validate } from "../src/fs.ts";
import type { EntityType } from "../src/core.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "okf-cards-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });
const cases: { type: EntityType; canonical: string; legacy: string }[] = [
  { type: "klient", canonical: "client.md", legacy: "klient.md" },
  { type: "spis", canonical: "matter.md", legacy: "spis.md" },
  { type: "projekt", canonical: "project.md", legacy: "projekt.md" },
];
for (const { type, canonical, legacy } of cases) {
  test(`${type}: new card is detected, validated and indexed by canonical path`, () => {
    const dir = join(root, "entity");
    writeFileSync(join(root, "index.md"), "# Index\n");
    const result = apply(plan({ type, dir, title: "Synthetic", jurisdiction: "sk" }));
    expect(result.created).toContain(canonical);
    expect(existsSync(join(dir, legacy))).toBe(false);
    expect(detect(dir).type).toBe(type);
    expect(validate(root)).toEqual([]);
    render(root);
    expect(readFileSync(join(root, "index.md"), "utf8")).toContain(`(./entity/${canonical})`);
  });
  for (const name of [canonical, legacy]) {
    test(`${type}: retrofit preserves ${name} and never adds its alias`, () => {
      const original = `---\ntype: ${type}\njurisdiction: sk\n---\nOriginal private note\n`;
      writeFileSync(join(root, name), original);
      expect(detect(root).type).toBe(type);
      const result = apply(plan({ type, dir: root, title: "Ignored", jurisdiction: "sk" }));
      expect(result.created).not.toContain(canonical);
      expect(result.created).not.toContain(legacy);
      expect(readFileSync(join(root, name), "utf8")).toBe(original);
      expect(existsSync(join(root, name === canonical ? legacy : canonical))).toBe(false);
      expect(detect(root).missing).toEqual([]);
    });
  }
  test(`${type}: alias arriving after preview is rejected before any scaffold write`, () => {
    const preview = plan({ type, dir: root, title: "Synthetic", jurisdiction: "sk" });
    writeFileSync(join(root, legacy), "Existing card\n");
    expect(() => apply(preview)).toThrow();
    expect(existsSync(join(root, canonical))).toBe(false);
    expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
  });
  test(`${type}: two cards require resolution instead of silently choosing one`, () => {
    writeFileSync(join(root, legacy), "Old card\n");
    writeFileSync(join(root, canonical), "Different card\n");
    expect(() => plan({ type, dir: root, title: "Synthetic" })).toThrow();
  });
}
for (const clientCard of ["client.md", "klient.md"]) {
  test(`new matter links to actual ${clientCard} across extra nesting`, () => {
    writeFileSync(join(root, clientCard), "---\ntype: client\n---\n");
    const dir = join(root, "advisory", "company", "matter");
    apply(plan({ type: "spis", dir, title: "Synthetic", jurisdiction: "sk" }));
    expect(readFileSync(join(dir, "matter.md"), "utf8")).toContain(`(<../../../${clientCard}>)`);
  });
}
test("index preserves mixed legacy and canonical card links", () => {
  writeFileSync(join(root, "index.md"), "# Index\n");
  for (const [dir, card] of [["old", "spis.md"], ["new", "matter.md"]]) {
    mkdirSync(join(root, dir));
    writeFileSync(join(root, dir, card), "---\ntype: matter\n---\n");
  }
  render(root);
  const index = readFileSync(join(root, "index.md"), "utf8");
  expect(index).toContain("(./old/spis.md)");
  expect(index).toContain("(./new/matter.md)");
});

for (const { type, canonical, legacy } of cases) {
  for (const action of ["rename", "remove"]) {
    test(`${type}: ${action} of legacy card after retrofit plan blocks all writes`, () => {
      writeFileSync(join(root, legacy), "---\ntype: legacy\n---\n");
      const preview = plan({ type, dir: root, title: "Synthetic" });
      if (action === "rename") renameSync(join(root, legacy), join(root, canonical));
      else rmSync(join(root, legacy));
      expect(() => apply(preview)).toThrow();
      expect(existsSync(join(root, "AGENTS.md"))).toBe(false);
    });
  }
}
