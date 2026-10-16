import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BUNDLED_WORKFLOW_FILES } from "./core-skills.js";
import { exists } from "./utils.js";
import { globalSkillsDir } from "./workspace-files.js";

export const BUNDLED_WORKFLOW_NAMES = [...new Set(BUNDLED_WORKFLOW_FILES.map(file => file.path.split("/")[0]!))];

/** Retire the old global content procedure without replacing customized workflows. */
async function upgradeWikiLauncher(destination: string) {
  const path = join(destination, "SKILL.md");
  const content = await readFile(path).catch(() => null);
  if (!content || createHash("sha256").update(content).digest("hex") !== "3fbae9c3646e40877aa2aa3a33d21e51480617571d1e56d30623227bb92dcdaa") return;
  const launcher = BUNDLED_WORKFLOW_FILES.find(file => file.path === "workflow-firm-knowledge/SKILL.md");
  if (launcher) await writeFile(path, Buffer.from(launcher.content, launcher.encoding));
}

/** Install complete defaults once; migrate only known unmodified defaults. */
export async function ensureBundledWorkflows(root = globalSkillsDir()): Promise<void> {
  await mkdir(root, { recursive: true });
  for (const name of BUNDLED_WORKFLOW_NAMES) {
    const destination = join(root, name);
    if (await exists(destination)) {
      if (name === "workflow-firm-knowledge") await upgradeWikiLauncher(destination);
      continue;
    }
    // No SKILL.md is visible to discovery until its attachments are in place.
    const staging = await mkdtemp(join(dirname(root), ".bundled-workflow-"));
    try {
      const folder = join(staging, name);
      for (const file of BUNDLED_WORKFLOW_FILES.filter(file => file.path.startsWith(name + "/"))) {
        const path = join(staging, file.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, Buffer.from(file.content, file.encoding));
      }
      try {
        await rename(folder, destination);
      } catch (error) {
        // A concurrent startup may have installed it first.
        if (!(error instanceof Error) || !("code" in error)
          || !["ENOTEMPTY", "EEXIST"].includes(String(error.code)) || !(await exists(destination))) throw error;
      }
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}
