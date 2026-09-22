import { t } from "@/i18n";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { parseOfficeWorkingProfile, parseWorkingProfile, PROFILE_FILE, type WorkingProfile } from "../../../../../lawoss/okf/src/profile";

export type ProfilePreview = { profile?: WorkingProfile; source: string; sourceKey?: string; sourceParams?: Record<string, string>; warning?: string; warningKey?: string };
/** Same precedence as CLI, bounded by the native workspace's authorized file surface. */
export async function loadProfilePreview(
  client: Pick<LegalworkServerClient, "statWorkspaceFile" | "readWorkspaceFile">,
  workspaceId: string, target: string, matter: boolean,
): Promise<ProfilePreview> {
  if (target.startsWith("/") || target.includes("\\") || target.split("/").includes("..")) throw new Error(t("lawoss.integrations.error.profile_workspace"));
  const path = (base: string, name: string) => base ? `${base}/${name}` : name;
  const snapshot = path(target, PROFILE_FILE);
  if ((await client.statWorkspaceFile(workspaceId, snapshot)).exists) {
    return { profile: parseWorkingProfile((await client.readWorkspaceFile(workspaceId, snapshot)).content), source: snapshot };
  }
  if (!matter) return { source: "Predvolený profil", sourceKey: "lawoss.integrations.profile.default" };
  let dir = target;
  for (let i = 0; i < 8; i++) {
    for (const name of ["Office", "_kancelaria"]) {
      const office = path(dir, name);
      if (!(await client.statWorkspaceFile(workspaceId, office)).exists) continue;
      const config = path(office, "okf.config");
      if (!(await client.statWorkspaceFile(workspaceId, config)).exists) return { source: `Predvolený profil (${office} bez konfigurácie)`, sourceKey: "lawoss.integrations.profile.unconfigured", sourceParams: { office } };
      return { profile: parseOfficeWorkingProfile((await client.readWorkspaceFile(workspaceId, config)).content), source: config };
    }
    if (!dir) return { source: "Predvolený profil", sourceKey: "lawoss.integrations.profile.default", warning: "Kancelársky profil sa vo workspace nenašiel. Agent ešte preverí nadradený Office pri finálnom CLI pláne.", warningKey: "lawoss.integrations.profile.office_missing" };
    dir = dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "";
  }
  return { source: "Predvolený profil", sourceKey: "lawoss.integrations.profile.default" };
}
