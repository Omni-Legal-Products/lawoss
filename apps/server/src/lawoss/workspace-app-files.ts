import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { ApiError } from "../errors.js";
import type { WorkspaceInfo } from "../types.js";
import type { ServerConfig } from "../types.js";
import { runtimeStorageDir } from "../runtime-opencode-config-store.js";

/** Existing client folders can opt out of project-local app-file initialization. */
export type WorkspaceAppFiles = "inside" | "outside";

export type WorkspaceAppFilesTarget = {
  appFiles?: WorkspaceAppFiles;
};

export function usesExternalWorkspaceAppFiles(
  workspace: WorkspaceAppFilesTarget | null | undefined,
): boolean {
  return workspace?.appFiles === "outside";
}

/**
 * Stable host-owned storage for files that would otherwise be written to a
 * client's project directory. The hash keeps client path segments out of the
 * host storage layout and makes the mapping independent of display-name edits.
 */
export function externalAppFilesRoot(
  config: Pick<ServerConfig, "configPath">,
  workspace: Pick<WorkspaceInfo, "path">,
): string {
  const key = resolve(workspace.path);
  const hash = createHash("sha256").update(key).digest("hex");
  return join(runtimeStorageDir(config as ServerConfig), "workspace-app-files", hash);
}

/** The root passed to project-file resolvers for this workspace. */
export function workspaceAppFilesRoot(config: Pick<ServerConfig, "configPath">, workspace: WorkspaceInfo): string {
  return usesExternalWorkspaceAppFiles(workspace) ? externalAppFilesRoot(config, workspace) : workspace.path;
}

/** OpenCode's external config directory for an outside-mode workspace. */
export function externalOpencodeConfigDir(
  config: Pick<ServerConfig, "configPath">,
  workspace: WorkspaceInfo,
): string | null {
  return usesExternalWorkspaceAppFiles(workspace)
    ? join(externalAppFilesRoot(config, workspace), ".opencode")
    : null;
}

/** Host-owned profile reference used by onboarding and memory integrations. */
export function externalMemoryProfilePath(
  config: Pick<ServerConfig, "configPath">,
  workspace: WorkspaceInfo,
): string | null {
  return usesExternalWorkspaceAppFiles(workspace)
    ? join(externalAppFilesRoot(config, workspace), ".opencode", "memory-profile.json")
    : null;
}

/** Routes not yet converted to workspaceAppFilesRoot must fail closed. */
export function requireProjectAppFilesInside(workspace: WorkspaceInfo): void {
  if (!usesExternalWorkspaceAppFiles(workspace)) return;
  throw new ApiError(
    409,
    "workspace_app_files_outside",
    "This project operation is not available until its external app-files storage route is configured.",
  );
}
