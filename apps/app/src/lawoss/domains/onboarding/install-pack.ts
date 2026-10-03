import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import type { Language } from "@/i18n";

/** Complete missing bundled resources while preserving installed skill customizations. */
export async function installMissingOnboardingSkills(client: LegalworkServerClient, workspaceId: string, locale: Language) {
  const bundle = await import("../../okf/skill-bundle");
  const existing = await client.listSkills(workspaceId, { includeGlobal: true });
  for (const skill of [
    { name: bundle.NOVY_SPIS_SKILL_NAME, body: bundle.novySpisSkillBody(locale), resource: bundle.OKF_CLI_RESOURCE_NAME, content: bundle.okfCliSource() },
    { name: bundle.OKF_PAMAT_SKILL_NAME, body: bundle.pamatSkillBody(), resource: bundle.OKF_MEMORY_CLI_RESOURCE_NAME, content: bundle.okfMemoryCliSource() },
    { name: bundle.USPORIADAJ_SPIS_SKILL_NAME, body: bundle.usporiadajSpisSkillBody(), resource: bundle.OKF_CLI_RESOURCE_NAME, content: bundle.okfCliSource() },
  ]) {
    const installed = existing.items.find(item => item.name === skill.name);
    if (installed?.scope === "global") continue;
    if (!installed) await client.upsertSkill(workspaceId, { name: skill.name, ...skill.body });
    const resources = await client.listSkillResources(workspaceId, skill.name);
    if (resources.items.some(item => item.name === skill.resource)) continue;
    await client.upsertSkillResource(workspaceId, skill.name, { name: skill.resource, content: skill.content });
  }
}
