/**
 * LAWOSS (#438): agent občas uvedie nainštalovaný skill cestou (`.opencode/skills/novy-spis`,
 * `.opencode/skills/novy-spis/SKILL.md`) namiesto názvu. Server ho potom odmietol ako nenájdený a agent
 * ten istý príkaz opakoval. Cesta do priečinka skillov sa preto číta ako názov skillu; iné hodnoty ostávajú.
 */
export function installedSkillName(reference: string): string {
  const normalized = reference.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const match = /(?:^|\/)\.opencode\/skills\/([^/]+)(?:\/SKILL\.md)?$/i.exec(normalized);
  return match ? match[1]! : reference;
}
