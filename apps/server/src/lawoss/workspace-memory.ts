import { ApiError } from "../errors.js";
import { realpathSync } from "node:fs";
import { dirname } from "node:path";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { readRuntimeOpencodeConfig, runtimeExternalDirectory } from "../runtime-opencode-config-store.js";
import { runtimeMemoryGrants, workspaceMemoryStatus, workspaceMemoryStatusWithProfile } from "./workspace-memory-runtime.js";
import { externalAppFilesRoot, externalMemoryProfilePath, usesExternalWorkspaceAppFiles } from "./workspace-app-files.js";

function hostProfileOptions(config: ServerConfig, workspace: WorkspaceInfo) {
  const profilePath = externalMemoryProfilePath(config, workspace);
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
