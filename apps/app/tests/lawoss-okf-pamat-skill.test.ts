import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  NOVY_SPIS_SKILL_NAME,
  OKF_MEMORY_CLI_RESOURCE_NAME,
  OKF_PAMAT_SKILL_NAME,
  okfMemoryCliSource,
  pamatSkillBody,
  skillBody,
} from "../src/lawoss/okf/skill-bundle";

// Ide sa cez skill-bundle.ts (bun `?raw` importy pozná), aby test padol aj pri
// zmene balenia, nie iba pri zmene súborov, ktoré balí.
const root = join(import.meta.dir, "../../..");
const skill = readFileSync(join(root, "lawoss/okf-pamat/SKILL.md"), "utf8");

describe("skill okf-pamat pre workspace LAWOSS", () => {
  test("instalátor posiela meno, popis z frontmatteru a telo bez frontmatteru", () => {
    const body = pamatSkillBody();
    expect(OKF_PAMAT_SKILL_NAME).toBe("okf-pamat");
    expect(/^name:\s*okf-pamat$/m.test(skill)).toBe(true);
    expect(body.description).toMatch(/^Use when reading or writing case memory/);
    expect(body.description.length).toBeLessThanOrEqual(1024); // limit servera (validateDescription)
    expect(body.content.startsWith("# okf-pamat")).toBe(true);
    expect(body.content).not.toContain("\n---\n");
    // druhý skill nesmie prepísať prvý
    expect(skillBody().description).not.toBe(body.description);
    expect(NOVY_SPIS_SKILL_NAME).not.toBe(OKF_PAMAT_SKILL_NAME);
  });
  test("skill hovorí agentovi, kde je CLI a kam písať návrh", () => {
    const { content } = pamatSkillBody();
    expect(content).toContain(`resources/${OKF_MEMORY_CLI_RESOURCE_NAME}`);
    expect(content).toContain("Office/");
    expect(content).toContain("mimo spis");
  });
  test("bundle CLI je jeden spustiteľný súbor bez závislostí", () => {
    const cli = okfMemoryCliSource();
    expect(cli).toBe(readFileSync(join(root, "lawoss/okf-pamat/bundle", OKF_MEMORY_CLI_RESOURCE_NAME), "utf8"));
    expect(cli.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(cli).toContain("okf-memory");
    expect(cli).toContain("okf:render:");
    expect(cli).toContain("parties");
    expect(/^\s*import\s+.*from\s+["'][^./]/m.test(cli.replace(/from\s+["']node:/g, ""))).toBe(false);
  });
});
