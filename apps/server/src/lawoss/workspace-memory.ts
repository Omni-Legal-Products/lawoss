import { ApiError } from "../errors.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { readRuntimeOpencodeConfig, runtimeExternalDirectory } from "../runtime-opencode-config-store.js";
import { runtimeMemoryGrants, workspaceMemoryStatus } from "./workspace-memory-runtime.js";

// Never merge workspace-authored opencode.json: only the existing host runtime row grants access.
export async function getWorkspaceMemoryGrants(config: ServerConfig, workspace: WorkspaceInfo) {
  if (workspace.workspaceType === "remote") throw new ApiError(400, "memory_local_workspace_required", "File memory requires a local workspace.");
  const runtime = await readRuntimeOpencodeConfig(config, workspace.id);
  return { ...runtimeMemoryGrants(workspace.path, runtimeExternalDirectory(runtime)), authority: "runtime" as const, workspaceId: workspace.id };
}
export async function getWorkspaceMemoryStatus(config: ServerConfig, workspace: WorkspaceInfo) {
  return workspaceMemoryStatus(workspace.path, await getWorkspaceMemoryGrants(config, workspace));
}
