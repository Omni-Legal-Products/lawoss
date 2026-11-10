/**
 * LAWOSS: globálne skilly Claude (`~/.claude/skills`) ani iných agentov (`~/.agents/skills`, `~/.agent/skills`)
 * desktop nečíta (nález N-1, #255; `~/.agents` rozhodnutie MČ 10. 11. 2026).
 *
 * Skilly advokáta z Claude Code alebo iného nástroja sa nemajú miešať do LAWOSS. Platí pre globálne
 * korene aj pre prechod nadradených priečinkov klienta bez gitu, ktorý by na `~/.claude/skills` narazil.
 * `.claude/skills` vnútri priečinka klienta sa číta ďalej. Server má rovnaké pravidlo
 * v `apps/server/src/lawoss/claude-global-skills.ts`. Návrat: `true`.
 */
import os from "node:os";
import path from "node:path";

export const LAWOSS_READ_CLAUDE_GLOBAL_SKILLS = false;

const comparable = (value) => (process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value));

/** `HOME` procesu a skutočný domov používateľa (pri izolovanom `HOME` testovacej zostavy sa líšia). */
function defaultHomes() {
  const homes = [os.homedir()];
  try {
    homes.push(os.userInfo().homedir);
  } catch {
    // Bez záznamu používateľa v systéme ostáva len HOME.
  }
  return homes.filter(Boolean);
}

const IGNORED_GLOBAL_SKILL_DIRS = [[".claude", "skills"], [".agents", "skills"], [".agent", "skills"]];

/** Korene skillov bez `~/.claude/skills`, `~/.agents/skills` a `~/.agent/skills`; poradie ostatných sa zachová. */
export function withoutClaudeGlobalSkills(roots, homes = defaultHomes()) {
  if (LAWOSS_READ_CLAUDE_GLOBAL_SKILLS) return roots;
  const ignored = new Set(homes.flatMap((home) => IGNORED_GLOBAL_SKILL_DIRS.map((parts) => comparable(path.join(home, ...parts)))));
  return roots.filter((root) => !ignored.has(comparable(root)));
}
