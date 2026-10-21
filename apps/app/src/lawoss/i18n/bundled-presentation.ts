import { currentLocale, t, type Language } from "@/i18n";
import type { SkillCard } from "@/app/types";

/** Host-verifiable original identity; custom or unknown source metadata stays literal. */
export function bundledPresentation(skill: Pick<SkillCard, "name" | "description" | "bundledDisplayId" | "firm">, locale: Language = currentLocale()): { name: string; description: string } | null {
  if (skill.firm || skill.bundledDisplayId !== skill.name) return null;
  const prefix = skill.bundledDisplayId === "workflow-assistant-due-diligence" ? "workflow_due"
    : skill.bundledDisplayId === "workflow-firm-knowledge" ? "workflow_knowledge" : null;
  return prefix ? { name: t(`lawoss.diagnostics.${prefix}_name`, locale), description: t(`lawoss.diagnostics.${prefix}_description`, locale) } : null;
}
