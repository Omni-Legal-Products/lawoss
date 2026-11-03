/**
 * LAWOSS: globálne skilly Claude (`~/.claude/skills`) appka nečíta (nález N-1, #255).
 *
 * Skilly, ktoré má advokát v Claude Code alebo inom nástroji, sa nemajú miešať do LAWOSS: nezobrazia
 * sa v Nastaveniach a nedostane ich ani engine (`legalwork-runtime-config.ts` berie cesty z `listSkills`).
 * Platí aj vtedy, keď na `~/.claude/skills` narazí prechod nadradených priečinkov klienta bez gitu.
 * Skilly LAWOSS a z LAWOSS Marketplace sú v globálnom priečinku OpenCode (`globalSkillsDir()`) alebo
 * v `.opencode/skills` klienta; `.claude/skills` vnútri priečinka klienta sa číta ďalej. Výslovný import
 * z Claude (`plugin-imports.ts`) ostáva. Upstream kód sa nemení, len sa tento priečinok preskočí.
 * Návrat: `true`.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const LAWOSS_READ_CLAUDE_GLOBAL_SKILLS = false;

const comparable = (path: string) => (process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path));

/** Priečinok skillov, ktorý LAWOSS preskočí: globálne skilly Claude v domovskom priečinku. */
export function isIgnoredSkillRoot(dir: string): boolean {
  return !LAWOSS_READ_CLAUDE_GLOBAL_SKILLS && comparable(dir) === comparable(join(homedir(), ".claude", "skills"));
}
