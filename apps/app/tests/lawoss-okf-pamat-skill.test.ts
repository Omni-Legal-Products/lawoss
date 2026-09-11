import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Vite `?raw` importy bun test nepozná — kontrolujú sa priamo súbory, ktoré skill-bundle.ts balí.
const root = join(import.meta.dir, "../../..");
const skill = readFileSync(join(root, "lawoss/okf-pamat/SKILL.md"), "utf8");
const cli = readFileSync(join(root, "lawoss/okf-pamat/bundle/okf-memory.js"), "utf8");

describe("skill okf-pamat pre workspace LAWOSS", () => {
  test("frontmatter nesie meno a popis, ktoré instalátor posiela na server", () => {
    const front = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? "";
    expect(/^name:\s*okf-pamat$/m.test(front)).toBe(true);
    expect(/^description:\s*\S/m.test(front)).toBe(true);
  });
  test("skill hovorí agentovi, kde je CLI a kam písať návrh", () => {
    expect(skill).toContain("resources/okf-memory.js");
    expect(skill).toContain("Office/");
    expect(skill).toContain("mimo spis");
  });
  test("bundle CLI je jeden spustiteľný súbor bez závislostí", () => {
    expect(cli.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(cli).toContain("okf-memory");
    expect(cli).toContain("okf:render:");
    expect(cli).toContain("parties");
    expect(/^\s*import\s+.*from\s+["'][^./]/m.test(cli.replace(/from\s+["']node:/g, ""))).toBe(false);
  });
});
