/**
 * Čo sa inštaluje do workspace: SKILL.md (text pre agenta) + okf.js (CLI ako
 * jeden súbor, priložený ako resource). Obidve žijú v repe forku; sem sa
 * dostávajú cez Vite `?raw`, takže inštalácia nepotrebuje sieť.
 */
import skillMarkdown from "../../../../../lawoss/skills/novy-spis/SKILL.md?raw";
import okfCli from "../../../../../lawoss/okf/bundle/okf.js?raw";

export const NOVY_SPIS_SKILL_NAME = "novy-spis";
export const OKF_CLI_RESOURCE_NAME = "okf.js";

/** SKILL.md bez frontmatteru — server si frontmatter skladá sám z name/description. */
export function skillBody(): { description: string; content: string } {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(skillMarkdown);
  const front = match?.[1] ?? "";
  const description = /^description:\s*(.*)$/m.exec(front)?.[1]?.trim() ?? "";
  return { description, content: (match?.[2] ?? skillMarkdown).trim() + "\n" };
}

export function okfCliSource(): string {
  return okfCli;
}
