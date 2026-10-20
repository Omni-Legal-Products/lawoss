import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUNDLED_WORKFLOW_FILES } from "./core-skills";
import { projectFieldsFromTemplate } from "./project-templates";
import { listSkillsInDir } from "./skills";

test("only the exact bundled workflow bytes receive a presentation identity; customized copies remain literal", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-display-"));
  try {
    const source = BUNDLED_WORKFLOW_FILES.find(file => file.path === "workflow-assistant-due-diligence/SKILL.md");
    if (!source) throw new Error("Bundled workflow missing");
    const directory = join(root, "workflow-assistant-due-diligence");
    const path = join(directory, "SKILL.md");
    await mkdir(directory);
    const content = Buffer.from(source.content, source.encoding);
    await writeFile(path, content);
    expect((await listSkillsInDir(root, "global"))[0]).toMatchObject({ bundledDisplayId: "workflow-assistant-due-diligence" });
    await writeFile(path, Buffer.concat([content, Buffer.from("\nMy own instructions.\n")]));
    expect((await listSkillsInDir(root, "global"))[0]?.bundledDisplayId).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("server template creation admits Czech and Slovak while refusing unknown language values", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-template-language-"));
  const config = { configPath: join(root, "server.json") };
  try {
    for (const language of ["cs", "sk"] as const) {
      const fields = await projectFieldsFromTemplate(config, { templateLanguage: language });
      expect(fields.find(field => field.id === "client")?.label).toBe("Klient");
      expect(fields.every(field => field.value === null)).toBe(true);
    }
    await expect(projectFieldsFromTemplate(config, { templateLanguage: "xx" })).rejects.toThrow("Template language must be");
  } finally { await rm(root, { recursive: true, force: true }); }
});
