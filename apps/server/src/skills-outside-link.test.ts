import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import * as os from "node:os";
import { join } from "node:path";
import { resolveSkillDir } from "./skill-resources.js";
import { listSkills, type SkippedSkill } from "./skills.js";

let root: string;
let home: string;
let workspace: string;
let originalXdg: string | undefined;
let restoreHomedir = () => {};

async function writeSkill(folder: string, name: string) {
  await mkdir(join(folder, name), { recursive: true });
  await writeFile(join(folder, name, "SKILL.md"), `---\nname: ${name}\ndescription: Test skill ${name}.\n---\n\n# ${name}\n`);
}

beforeEach(async () => {
  root = await mkdtemp(join(os.tmpdir(), "legalwork-skills-outside-"));
  home = join(root, "user");
  workspace = join(root, "matter");
  await mkdir(join(workspace, ".git"), { recursive: true });
  await mkdir(join(workspace, ".claude"), { recursive: true });
  const homeMock = spyOn(os, "homedir").mockReturnValue(home);
  restoreHomedir = () => homeMock.mockRestore();
  originalXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(home, ".config");
  // A common setup: the project's .claude/skills points at the user's global library.
  await writeSkill(join(home, ".claude", "skills"), "global-review");
  await symlink(join(home, ".claude", "skills"), join(workspace, ".claude", "skills"), "dir");
  await writeSkill(join(workspace, ".opencode", "skills"), "project-draft");
});

afterEach(async () => {
  restoreHomedir();
  if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdg;
  await rm(root, { recursive: true, force: true });
});

test("a project skills folder linked outside the workspace is skipped instead of failing the listing", async () => {
  const skipped: SkippedSkill[] = [];
  const items = await listSkills(workspace, true, skipped);
  expect(items.map(item => `${item.scope}:${item.name}`).sort()).toEqual(["global:global-review", "project:project-draft"]);
  expect(skipped.map(entry => entry.path)).toContain(join(workspace, ".claude", "skills"));
});

test("skill lookup continues to the global library when the project link leaves the workspace", async () => {
  expect(await resolveSkillDir(workspace, "global-review")).toBe(join(home, ".claude", "skills", "global-review"));
  expect(await resolveSkillDir(workspace, "project-draft")).toBe(join(workspace, ".opencode", "skills", "project-draft"));
});
