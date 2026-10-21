import { nativeBundledDisplayId } from "../../desktop/electron/bundled-workflow-presentation.mjs";
import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { runInNewContext } from "node:vm";
import { BUNDLED_WORKFLOW_FILES } from "./core-skills.js";
import { projectFieldsFromTemplate } from "./project-templates.js";
import { listSkillsInDir } from "./skills.js";

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


test("desktop identity matches every shipped full workflow and rejects customized or workspace copies", () => {
  for (const source of BUNDLED_WORKFLOW_FILES.filter(file => file.path.endsWith("/SKILL.md"))) {
    const name = source.path.split("/")[0]!;
    const raw = Buffer.from(source.content, source.encoding).toString("utf8");
    expect(nativeBundledDisplayId(name, raw, true)).toBe(name);
    expect(nativeBundledDisplayId(name, raw + "\nCustom content", true)).toBeUndefined();
    expect(nativeBundledDisplayId(name, raw, false)).toBeUndefined();
    expect(nativeBundledDisplayId("unknown", raw, true)).toBeUndefined();
  }
});


test("the desktop local-library path carries verified identity and keeps edited content literal", async () => {
  const source = BUNDLED_WORKFLOW_FILES.find(file => file.path === "workflow-assistant-due-diligence/SKILL.md")!;
  const name = source.path.split("/")[0]!;
  const root = await mkdtemp(join(tmpdir(), "lawoss-native-library-"));
  const directory = join(root, name);
  await mkdir(directory);
  const main = await readFile(new URL("../../desktop/electron/main.mjs", import.meta.url), "utf8");
  const start = main.indexOf("async function listLocalSkills(projectDir) {");
  const end = main.indexOf("async function findSkillFile(", start);
  if (start < 0 || end < 0) throw new Error("Native list function missing");
  const list = runInNewContext(main.slice(start, end) + "; listLocalSkills", {
    Set, path, readFile, nativeBundledDisplayId, console,
    collectGlobalSkillRoots: async () => [root], collectSkillRoots: async () => [root],
    findSkillDirsInRoot: async () => [directory], pathExists: async () => false,
    parseSkillFrontmatter: () => ({ data: { name, description: "Original description" } }),
    extractTrigger: () => undefined, extractFrontmatterValue: () => undefined,
  });
  try {
    const original = Buffer.from(source.content, source.encoding);
    await writeFile(join(directory, "SKILL.md"), original);
    expect((await list("")).items[0].bundledDisplayId).toBe(name);
    await writeFile(join(directory, "SKILL.md"), Buffer.concat([original, Buffer.from("\nMy own instructions")]));
    expect((await list("")).items[0].bundledDisplayId).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});
