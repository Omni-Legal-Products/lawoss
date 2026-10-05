import type { Language } from "@/i18n";
import { refreshOkfSkills, type BundledOkfSkill, type OkfSkillClient, type OkfSkillRefresh } from "../../okf/skill-refresh";
import { notifyModifiedOkfSkills } from "../../okf/skill-refresh-notice";

/** OKF skills every OKF client gets: /novy-spis, /okf-pamat, /usporiadaj-spis and /roztried-spis with their CLI resources. */
export async function okfSkillPack(locale: Language): Promise<BundledOkfSkill[]> {
  const bundle = await import("../../okf/skill-bundle");
  return [
    { name: bundle.NOVY_SPIS_SKILL_NAME, body: bundle.novySpisSkillBody(locale), resource: bundle.OKF_CLI_RESOURCE_NAME, source: bundle.okfCliSource() },
    { name: bundle.OKF_PAMAT_SKILL_NAME, body: bundle.pamatSkillBody(), resource: bundle.OKF_MEMORY_CLI_RESOURCE_NAME, source: bundle.okfMemoryCliSource() },
    { name: bundle.USPORIADAJ_SPIS_SKILL_NAME, body: bundle.usporiadajSpisSkillBody(), resource: bundle.OKF_CLI_RESOURCE_NAME, source: bundle.okfCliSource() },
    { name: bundle.ROZTRIED_SPIS_SKILL_NAME, body: bundle.roztriedSpisSkillBody(locale), resource: bundle.OKF_CLI_RESOURCE_NAME, source: bundle.okfCliSource() },
  ];
}

/** Complete missing bundled OKF skills and refresh unmodified ones; customizations are kept and reported. */
export async function installMissingOnboardingSkills(client: OkfSkillClient, workspaceId: string, locale: Language): Promise<OkfSkillRefresh> {
  const result = await refreshOkfSkills(client, workspaceId, await okfSkillPack(locale));
  notifyModifiedOkfSkills(result.modified, locale);
  return result;
}
