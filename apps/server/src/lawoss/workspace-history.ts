import { isAbsolute, relative, resolve, sep } from "node:path";
import type { WorkspaceInfo } from "../types.js";

/** Historical roots are lookup metadata; they never authorize filesystem access. */
export function workspaceSessionDirectories(workspace: WorkspaceInfo): string[] {
  return Array.from(new Set([workspace.path, ...(workspace.previousPaths ?? [])]));
}
export function workspaceOwnsSessionDirectory(workspace: WorkspaceInfo, directory: string): boolean {
  return workspaceSessionDirectories(workspace).some(root => {
    const child = relative(resolve(root), resolve(directory));
    return !isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`);
  });
}
export function remapHistoricalFilePath(workspace: WorkspaceInfo, filePath: string): string {
  if (!isAbsolute(filePath)) return filePath;
  for (const oldRoot of workspace.previousPaths ?? []) {
    const child = relative(resolve(oldRoot), resolve(filePath));
    if (child && !isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`)) return resolve(workspace.path, child);
  }
  return filePath;
}

export function workspaceOwnsSession(workspace: WorkspaceInfo, session: { id: string; directory?: string | null }): boolean {
  if (!session.directory) return false;
  const current = { ...workspace, previousPaths: [] };
  if (workspaceOwnsSessionDirectory(current, session.directory)) return true;
  return !!workspace.previousSessionIds?.includes(session.id) && workspaceOwnsSessionDirectory(workspace, session.directory);
}
