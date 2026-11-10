/**
 * LAWOSS: globálne skilly Claude (`~/.claude/skills`) ani iných agentov (`~/.agents/skills`, `~/.agent/skills`)
 * appka nečíta (nález N-1, #255; `~/.agents` rozhodnutie MČ 10. 11. 2026).
 *
 * Skilly, ktoré má advokát v Claude Code alebo inom nástroji, sa nemajú miešať do LAWOSS: nezobrazia
 * sa v Nastaveniach a nedostane ich ani engine (`legalwork-runtime-config.ts` berie cesty z `listSkills`).
 * Platí aj vtedy, keď na `~/.claude/skills` narazí prechod nadradených priečinkov klienta bez gitu.
 * Skilly LAWOSS a z LAWOSS Marketplace sú v globálnom priečinku OpenCode (`globalSkillsDir()`) alebo
 * v `.opencode/skills` klienta; `.claude/skills` vnútri priečinka klienta sa číta ďalej. Výslovný import
 * z Claude (`plugin-imports.ts`) ostáva. Upstream kód sa nemení, len sa tento priečinok preskočí.
 * Návrat: `true`.
 */
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";

export const LAWOSS_READ_CLAUDE_GLOBAL_SKILLS = false;

const comparable = (path: string) => (process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path));

/**
 * Domovy, v ktorých sa `.claude/skills` preskočí: `HOME` procesu a skutočný domov používateľa.
 * Pri izolovanom `HOME` (testovacia zostava, `start.sh`) by inak prechod nadradených priečinkov
 * klienta našiel skutočné `~/.claude/skills` (nález N-1: „Skipped invalid skill: /Users/…/.claude/skills“).
 */
function homes(): string[] {
  const found = [homedir()];
  try {
    found.push(userInfo().homedir);
  } catch {
    // Bez záznamu používateľa v systéme ostáva len HOME.
  }
  return found.filter(Boolean);
}

/** Globálne priečinky skillov iných nástrojov v domovskom priečinku (Claude Code, agenti `.agents`/`.agent`). */
export const IGNORED_GLOBAL_SKILL_DIRS: readonly (readonly [string, string])[] = [[".claude", "skills"], [".agents", "skills"], [".agent", "skills"]];

/** Priečinok skillov, ktorý LAWOSS preskočí: globálne skilly Claude a iných agentov v domovskom priečinku. */
export function isIgnoredSkillRoot(dir: string): boolean {
  if (LAWOSS_READ_CLAUDE_GLOBAL_SKILLS) return false;
  const target = comparable(dir);
  return homes().some((home) => IGNORED_GLOBAL_SKILL_DIRS.some((parts) => comparable(join(home, ...parts)) === target));
}
