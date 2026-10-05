import { currentLocale, t, type Language } from "@/i18n";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { workspaceRelativePath } from "../../okf/plan-groups";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { NOVY_SPIS_SKILL_NAME, OKF_CLI_RESOURCE_NAME, OKF_MEMORY_CLI_RESOURCE_NAME, OKF_PAMAT_SKILL_NAME, novySpisSkillBody, okfCliSource, okfMemoryCliSource, pamatSkillBody } from "../../okf/skill-bundle";
import { refreshOkfSkills, type OkfSkillClient } from "../../okf/skill-refresh";
import { notifyModifiedOkfSkills } from "../../okf/skill-refresh-notice";
import { reloadAfterSkillWrites } from "../../okf/skill-availability";

/**
 * Install or refresh the local OKF skills before opening an unsent draft; never create/register the
 * target folder. A customized SKILL.md is kept and reported, the CLI resources always match the bundle.
 */
export async function prepareOkfDraft(
  client: Pick<LegalworkServerClient, "capabilities"> & OkfSkillClient & Partial<Pick<LegalworkServerClient, "reloadEngine">>,
  workspace: RouteWorkspace,
  openDraft: () => Promise<string>,
  locale?: Language,
): Promise<string> {
  if (workspace.workspaceType === "remote" || !workspace.path) throw new Error(t("lawoss.setup.error.localWorkspace"));
  const capabilities = await client.capabilities();
  if (!capabilities.skills.write || !capabilities.skillResources?.write) throw new Error(t("lawoss.setup.error.skillWrite"));
  const { modified, written } = await refreshOkfSkills(client, workspace.id, [
    { name: NOVY_SPIS_SKILL_NAME, body: novySpisSkillBody(locale), resource: OKF_CLI_RESOURCE_NAME, source: okfCliSource() },
    { name: OKF_PAMAT_SKILL_NAME, body: pamatSkillBody(), resource: OKF_MEMORY_CLI_RESOURCE_NAME, source: okfMemoryCliSource() },
  ]);
  notifyModifiedOkfSkills(modified, locale ?? currentLocale());
  await reloadAfterSkillWrites(client, workspace.id, written);
  return openDraft();
}

/** Keep the preview and its later prompt inside the selected native workspace. */
export function okfTargetWithinWorkspace(dir: string, workspace: Pick<RouteWorkspace, "path">): boolean {
  const relative = workspaceRelativePath(dir.replaceAll("\\", "/"), workspace.path.replaceAll("\\", "/"));
  return relative !== null && !relative.split("/").includes("..");
}
