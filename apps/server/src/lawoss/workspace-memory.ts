import { ApiError } from "../errors.js";
import { realpathSync, readFileSync } from "node:fs";
import { dirname, join, isAbsolute, relative, sep } from "node:path";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { readRuntimeOpencodeConfig, runtimeExternalDirectory } from "../runtime-opencode-config-store.js";
import { runtimeMemoryGrants, workspaceMemoryStatus, workspaceMemoryStatusWithProfile } from "./workspace-memory-runtime.js";
import { externalAppFilesRoot, externalMemoryProfilePath, usesExternalWorkspaceAppFiles } from "./workspace-app-files.js";

function hostProfileOptions(config: ServerConfig, workspace: WorkspaceInfo) {
  const profilePath = externalMemoryProfilePath(config, workspace);
  const sourceProfile = profilePath ?? join(workspace.path, ".lawoss", "memory-profile.json");
  if (workspace.previousPaths?.length) {
    try {
      const profile: unknown = JSON.parse(readFileSync(sourceProfile, "utf8").replace(/^\uFEFF/, ""));
      const roots = typeof profile === "object" && profile !== null && "roots" in profile && Array.isArray(profile.roots) ? profile.roots : [];
      const stale = roots.some(root => {
        if (typeof root !== "object" || root === null || !("path" in root) || typeof root.path !== "string" || !isAbsolute(root.path)) return false;
        return workspace.previousPaths?.some(old => { const child = relative(old, root.path); return !isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`); });
      });
      // Original profile bytes remain intact. An old absolute root may now belong
      // to a different matter even when a broader independent grant covers it.
      if (stale) return { profilePath: sourceProfile, profileIdentity: "", profileGrants: [], matterId: "[quarantined-profile]" };
    } catch { /* The existing reader reports missing or malformed profiles. */ }
  }
  if (!profilePath) return null;
  try {
    const canonical = realpathSync(profilePath);
    return { profilePath: canonical, profileIdentity: canonical, profileGrants: [realpathSync(dirname(canonical))] };
  } catch {
    // The reader reports an explicit invalid/missing host-selected profile.
    return { profilePath, profileIdentity: "", profileGrants: [] };
  }
}

// Never merge workspace-authored opencode.json: only the existing host runtime row grants access.
export async function getWorkspaceMemoryGrants(config: ServerConfig, workspace: WorkspaceInfo) {
  if (workspace.workspaceType === "remote") throw new ApiError(400, "memory_local_workspace_required", "File memory requires a local workspace.");
  const runtime = await readRuntimeOpencodeConfig(config, workspace.id);
  return { ...runtimeMemoryGrants(workspace.path, runtimeExternalDirectory(runtime)), authority: "runtime" as const, workspaceId: workspace.id };
}
export async function getWorkspaceMemoryStatus(config: ServerConfig, workspace: WorkspaceInfo) {
  const grants = await getWorkspaceMemoryGrants(config, workspace);
  const profile = hostProfileOptions(config, workspace);
  return profile ? workspaceMemoryStatusWithProfile(workspace.path, grants, profile) : workspaceMemoryStatus(workspace.path, grants);
}
export async function getWorkspaceMemoryContext(config: ServerConfig, workspace: WorkspaceInfo) {
  const grants = await getWorkspaceMemoryGrants(config, workspace);
  const profile = hostProfileOptions(config, workspace);
  return {
    authority: "runtime" as const,
    workspaceId: workspace.id,
    workspaceRoot: grants.workspaceRoot,
    folders: grants.folders,
    hiddenCount: grants.hiddenCount,
    ...(profile ? { profile } : {}),
    ...(usesExternalWorkspaceAppFiles(workspace) ? { handoffRoot: externalAppFilesRoot(config, workspace) } : {}),
  };
}
