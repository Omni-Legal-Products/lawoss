/**
 * LAWOSS: globálne skilly Claude (`~/.claude/skills`) desktop nečíta (nález N-1, #255).
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

/** Korene skillov bez `~/.claude/skills`; poradie ostatných sa zachová. */
export function withoutClaudeGlobalSkills(roots, homes = defaultHomes()) {
  if (LAWOSS_READ_CLAUDE_GLOBAL_SKILLS) return roots;
  const claude = new Set(homes.map((home) => comparable(path.join(home, ".claude", "skills"))));
  return roots.filter((root) => !claude.has(comparable(root)));
}
