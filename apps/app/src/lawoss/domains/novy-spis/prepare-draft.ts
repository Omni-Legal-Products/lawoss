import { t, type Language } from "@/i18n";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { workspaceRelativePath } from "../../okf/plan-groups";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { NOVY_SPIS_SKILL_NAME, OKF_CLI_RESOURCE_NAME, OKF_MEMORY_CLI_RESOURCE_NAME, OKF_PAMAT_SKILL_NAME, novySpisSkillBody, okfCliSource, okfMemoryCliSource, pamatSkillBody } from "../../okf/skill-bundle";

/** Install the local skills before opening an unsent draft; never create/register the target folder. */
export async function prepareOkfDraft(
  client: Pick<LegalworkServerClient, "capabilities" | "upsertSkill" | "upsertSkillResource">,
  workspace: RouteWorkspace,
  openDraft: () => Promise<string>,
  locale?: Language,
): Promise<string> {
  if (workspace.workspaceType === "remote" || !workspace.path) throw new Error(t("lawoss.setup.error.localWorkspace"));
  const capabilities = await client.capabilities();
  if (!capabilities.skills.write || !capabilities.skillResources?.write) throw new Error(t("lawoss.setup.error.skillWrite"));
  const body = novySpisSkillBody(locale);
  await client.upsertSkill(workspace.id, { name: NOVY_SPIS_SKILL_NAME, content: body.content, description: body.description });
  await client.upsertSkillResource(workspace.id, NOVY_SPIS_SKILL_NAME, { name: OKF_CLI_RESOURCE_NAME, content: okfCliSource() });
  const pamat = pamatSkillBody();
  await client.upsertSkill(workspace.id, { name: OKF_PAMAT_SKILL_NAME, content: pamat.content, description: pamat.description });
  await client.upsertSkillResource(workspace.id, OKF_PAMAT_SKILL_NAME, { name: OKF_MEMORY_CLI_RESOURCE_NAME, content: okfMemoryCliSource() });
  return openDraft();
}

/** Keep the preview and its later prompt inside the selected native workspace. */
export function okfTargetWithinWorkspace(dir: string, workspace: Pick<RouteWorkspace, "path">): boolean {
  const relative = workspaceRelativePath(dir.replaceAll("\\", "/"), workspace.path.replaceAll("\\", "/"));
  return relative !== null && !relative.split("/").includes("..");
}
