/**
 * LAWOSS: ponuka „/“ v composeri. Test pred spustením alfy 12. 11. 2026: ponuka ukazovala príkazy enginu pre vývojárov
 * (`/init` „guided AGENTS.md setup“) a skilly klienta (`/novy-spis`, `/okf-pamat`) v nej chýbali, lebo engine v
 * `command.list` skilly nevracia. Composer skill vloží ako `[skill meno]` (upstream `applySkillSelection`).
 */
import type { SkillCard, SlashCommandOption } from "@/app/types";
import { isSkillHiddenByDefault } from "@/lawoss/feature-flags";

/** Vstavané príkazy enginu pre vývojárov: `/init` zakladá AGENTS.md, `/review` hodnotí zmeny v gite. */
const DEVELOPER_COMMANDS: ReadonlySet<string> = new Set(["init", "review"]);

const settled = async <T>(load: () => Promise<T[]>): Promise<T[]> => load().catch(() => []);

/** Skilly klienta a doplnkov najprv, potom príkazy; meno príkazu má prednosť pred rovnomenným skillom. */
export async function lawossSlashCommands(
  listCommands: () => Promise<SlashCommandOption[]>,
  listSkills: () => Promise<SkillCard[]>,
): Promise<SlashCommandOption[]> {
  const [commands, skills] = await Promise.all([settled(listCommands), settled(listSkills)]);
  const visible = commands.filter((command) => !DEVELOPER_COMMANDS.has(command.name));
  const taken = new Set(visible.map((command) => command.name));
  const skillOptions = skills
    .filter((skill) => !taken.has(skill.name) && !isSkillHiddenByDefault(skill.name))
    .map((skill): SlashCommandOption => ({ id: `skill:${skill.name}`, name: skill.name, description: skill.description, source: "skill" }));
  return [...skillOptions, ...visible];
}
