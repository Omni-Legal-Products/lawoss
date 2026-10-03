import { ApiError } from "../errors.js";
import type { WorkspaceInfo } from "../types.js";

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
 * The external app-files backend has no project-config, skill, or command
 * storage yet. Refuse these mutations before their normal approval/write
 * paths, rather than recreating `.opencode` in an opted-out client folder.
 */
export function requireProjectAppFilesInside(workspace: WorkspaceInfo): void {
  if (!usesExternalWorkspaceAppFiles(workspace)) return;
  throw new ApiError(
    409,
    "workspace_app_files_outside",
    "Project config, skills, and commands are not supported in outside app-files mode yet.",
  );
}
