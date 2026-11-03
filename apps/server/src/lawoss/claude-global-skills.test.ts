import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
import { resolveSkillDir } from "../skill-resources.js";
import { listSkills } from "../skills.js";
import { globalSkillsDir } from "../workspace-files.js";

// N-1 (#255): LAWOSS čítal globálne skilly Claude z `~/.claude/skills`, aj s izolovaným HOME. Skilly advokáta
// z iných nástrojov sa nemajú miešať do appky ani do enginu (`legalwork-runtime-config.ts` berie `listSkills`).

let root: string;
let home: string;
let originalXdg: string | undefined;
let restoreHomedir = () => {};

async function writeSkill(folder: string, name: string) {
  await mkdir(join(folder, name), { recursive: true });
  await writeFile(join(folder, name, "SKILL.md"), `---\nname: ${name}\ndescription: Test skill ${name}.\n---\n\n# ${name}\n`);
}

const names = async (workspace: string) => (await listSkills(workspace, true)).map((item) => `${item.scope}:${item.name}`).sort();

beforeEach(async () => {
  root = await mkdtemp(join(os.tmpdir(), "lawoss-claude-skills-"));
  home = join(root, "user");
  const homeMock = spyOn(os, "homedir").mockReturnValue(home);
  restoreHomedir = () => homeMock.mockRestore();
  originalXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  // Skill z Claude Code advokáta a skill z LAWOSS Marketplace v globálnej knižnici LAWOSS (OpenCode).
  await writeSkill(join(home, ".claude", "skills"), "claude-code-only");
  await writeSkill(globalSkillsDir(), "slovlex-marketplace");
});

afterEach(async () => {
  restoreHomedir();
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdg;
  await rm(root, { recursive: true, force: true });
});

describe("globálne skilly Claude (~/.claude/skills) LAWOSS nečíta", () => {
  test("priečinok klienta s gitom: globálny skill LAWOSS áno, Claude nie; vlastné skilly priečinka ostávajú", async () => {
    const workspace = join(root, "klient");
    await mkdir(join(workspace, ".git"), { recursive: true });
    await writeSkill(join(workspace, ".opencode", "skills"), "novy-spis");
    await writeSkill(join(workspace, ".claude", "skills"), "skill-v-priecinku");
    expect(await names(workspace)).toEqual(["global:slovlex-marketplace", "project:novy-spis", "project:skill-v-priecinku"]);
    expect(await resolveSkillDir(workspace, "slovlex-marketplace")).toBe(join(globalSkillsDir(), "slovlex-marketplace"));
    await expect(resolveSkillDir(workspace, "claude-code-only")).rejects.toMatchObject({ status: 404 });
  });

  test("priečinok klienta v domove bez gitu: prechod nadradených priečinkov nenačíta ~/.claude/skills", async () => {
    const workspace = join(home, "Klienti", "Horak");
    await mkdir(workspace, { recursive: true });
    await writeSkill(join(workspace, ".opencode", "skills"), "novy-spis");
    expect(await names(workspace)).toEqual(["global:slovlex-marketplace", "project:novy-spis"]);
    await expect(resolveSkillDir(workspace, "claude-code-only")).rejects.toMatchObject({ status: 404 });
  });
});
