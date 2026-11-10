/**
 * LAWOSS: anglické pribalené workflowy upstreamu sa neinštalujú (rozhodnutie MČ 10. 11. 2026, #255 A2).
 *
 * `workflow-assistant-due-diligence` (anglická správa z due diligence) a `workflow-firm-knowledge` (spúšťač
 * wiki, ktorú LAWOSS skrýva) nemajú v LAWOSS slovenskú ani českú obdobu. Server ich do globálnej knižnice
 * skillov nezapíše, takže ich nevidí advokát (Nastavenia, workflowy, composer) ani engine. Kópiu, ktorú
 * nainštalovala staršia verzia a advokát ju nezmenil (všetky súbory bajt po bajte ako pribalené), server
 * odstráni; upravenú alebo doplnenú kópiu ponechá. Ostatné pribalené workflowy inštaluje upstream kód.
 * Návrat: prázdna množina `LAWOSS_HIDDEN_BUNDLED_WORKFLOWS`.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { BUNDLED_WORKFLOW_NAMES, ensureBundledWorkflows } from "../bundled-workflows.js";
import { BUNDLED_WORKFLOW_FILES } from "../core-skills.js";
import { exists } from "../utils.js";
import { globalSkillsDir } from "../workspace-files.js";

export const LAWOSS_HIDDEN_BUNDLED_WORKFLOWS: ReadonlySet<string> = new Set(["workflow-assistant-due-diligence", "workflow-firm-knowledge"]);

/** Starší pribalený spúšťač wiki (upstream ho pri štarte nahrádza, `upgradeWikiLauncher`); tiež nezmenená kópia. */
const RETIRED_SKILL_HASHES: Readonly<Record<string, readonly string[]>> = {
  "workflow-firm-knowledge": ["3fbae9c3646e40877aa2aa3a33d21e51480617571d1e56d30623227bb92dcdaa"],
};

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter(entry => !entry.isDirectory()).map(entry => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/")).sort();
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Je nainštalovaný workflow presne pribalená kópia (rovnaké súbory, rovnaké bajty, nič navyše)? */
async function isUnmodifiedBundledCopy(dir: string, name: string): Promise<boolean> {
  const shipped = BUNDLED_WORKFLOW_FILES.filter(file => file.path.startsWith(`${name}/`));
  const present = await filesUnder(dir);
  const expected = shipped.map(file => file.path.slice(name.length + 1)).sort();
  if (present.length !== expected.length || present.some((path, index) => path !== expected[index])) return false;
  for (const file of shipped) {
    const bytes = await readFile(join(dir, file.path.slice(name.length + 1)));
    if (bytes.equals(Buffer.from(file.content, file.encoding))) continue;
    if (file.path === `${name}/SKILL.md` && RETIRED_SKILL_HASHES[name]?.includes(sha256(bytes))) continue;
    return false;
  }
  return true;
}

/** Odstráni nezmenenú pribalenú kópiu skrytého workflowu; inú ponechá. Vráti, či ju odstránil. */
export async function retireHiddenBundledWorkflow(root: string, name: string): Promise<boolean> {
  const dir = join(root, name);
  if (!(await exists(dir)) || !(await isUnmodifiedBundledCopy(dir, name))) return false;
  await rm(dir, { recursive: true, force: true });
  return true;
}

/** Nainštaluje pribalené workflowy okrem skrytých a odstráni nezmenené kópie skrytých. */
export async function ensureLawossBundledWorkflows(root = globalSkillsDir()): Promise<void> {
  await ensureBundledWorkflows(root, BUNDLED_WORKFLOW_NAMES.filter(name => !LAWOSS_HIDDEN_BUNDLED_WORKFLOWS.has(name)));
  for (const name of LAWOSS_HIDDEN_BUNDLED_WORKFLOWS) await retireHiddenBundledWorkflow(root, name);
}
