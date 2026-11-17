import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLED_WORKFLOW_FILES } from "../core-skills.js";
import { listSkillsInDir } from "../skills.js";
import { ensureLawossBundledWorkflows } from "./hidden-bundled-workflows.js";

test("OZ 2027 skill is installed globally and a lawyer's edits survive startup", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-oz-2027-skill-"));
  const name = "oz-2027-prechod";
  const bundled = BUNDLED_WORKFLOW_FILES.find(file => file.path === `${name}/SKILL.md`);
  expect(bundled).toBeDefined();
  const file = join(root, name, "SKILL.md");
  try {
    await ensureLawossBundledWorkflows(root);
    expect(await readFile(file, "utf8")).toBe(bundled!.content);
    expect((await listSkillsInDir(root, "global")).find(item => item.name === name)).toMatchObject({
      name, scope: "global", trigger: expect.stringContaining("40/1964"),
    });
    const customized = bundled!.content + "\nOsobitné pravidlo kancelárie.\n";
    await writeFile(file, customized);
    await ensureLawossBundledWorkflows(root);
    expect(await readFile(file, "utf8")).toBe(customized);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
