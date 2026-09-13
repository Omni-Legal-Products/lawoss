/**
 * Čo sa inštaluje do workspace: SKILL.md (text pre agenta) + okf.js (CLI ako
 * jeden súbor, priložený ako resource). Obidve žijú v repe forku; sem sa
 * dostávajú cez Vite `?raw`, takže inštalácia nepotrebuje sieť.
 */
import skillMarkdown from "../../../../../lawoss/skills/novy-spis/SKILL.md?raw";
import okfCli from "../../../../../lawoss/okf/bundle/okf.js?raw";
import pamatSkillMarkdown from "../../../../../lawoss/okf-pamat/SKILL.md?raw";
import okfMemoryCli from "../../../../../lawoss/okf-pamat/bundle/okf-memory.js?raw";

export const NOVY_SPIS_SKILL_NAME = "novy-spis";
export const OKF_CLI_RESOURCE_NAME = "okf.js";
/** Pamäť spisu — druhý skill, ktorý sa inštaluje spolu s novým spisom. */
export const OKF_PAMAT_SKILL_NAME = "okf-pamat";
export const OKF_MEMORY_CLI_RESOURCE_NAME = "okf-memory.js";

/** SKILL.md bez frontmatteru — server si frontmatter skladá sám z name/description. */
export function skillBody(markdown: string = skillMarkdown): { description: string; content: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(markdown);
  const front = match?.[1] ?? "";
  const description = /^description:\s*(.*)$/m.exec(front)?.[1]?.trim() ?? "";
  return { description, content: (match?.[2] ?? markdown).trim() + "\n" };
}

export function okfCliSource(): string {
  return okfCli;
}

export function pamatSkillBody(): { description: string; content: string } {
  return skillBody(pamatSkillMarkdown);
}

export function okfMemoryCliSource(): string {
  return okfMemoryCli;
}
