import { realpath } from "node:fs/promises";
import { relative, sep } from "node:path";
import { isPathWithin } from "./path-within.js";
import type { WorkspaceInfo } from "../types.js";
import { workspaceListsSession } from "./session-list-scope.js";
import { workspaceOwnsSession } from "./workspace-history.js";

/**
 * LAWOSS: engine 1.18.29 serves `/session/:id/...` (and `/api/session/:id/...`) for any session
 * ID, whatever folder the request names, and then runs it in the session's own folder. Folders
 * without git share one engine project, so every local folder checks ownership before a session
 * is read or driven. Remote workers keep the check only with folder history: their directories
 * cannot be canonicalized on this machine.
 */
export function sessionOwnershipChecked(workspace: WorkspaceInfo): boolean {
  return workspace.workspaceType === "local" || !!workspace.previousPaths?.length || !!workspace.appFilesStorageKey;
}

/**
 * A local folder owns sessions whose directory lies inside it, as configured or as its realpath
 * (the proxy sends the engine realpath'd directories), compared in NFC; captured historical
 * sessions follow workspace-history.ts.
 */
export async function workspaceReadsSession(workspace: WorkspaceInfo, session: { id: string; directory?: string | null }): Promise<boolean> {
  if (workspace.workspaceType !== "local") return workspaceOwnsSession(workspace, session);
  const root = withoutExtendedPrefix(workspace.directory?.trim() || workspace.path);
  return workspaceListsSession(workspace, [root, await realpath(root).catch(() => root)], session);
}

/**
 * LAWOSS: the folder of a chat below its workspace root as path segments (`[]` for the root, for
 * a remote worker or for a historical chat outside the current root). A case chat lives in a
 * case subfolder; its managed shell defaults there, as the engine's own tools do.
 */
export async function sessionFolder(workspace: WorkspaceInfo, session: { directory?: string | null }): Promise<string[]> {
  const directory = session.directory?.normalize("NFC");
  if (workspace.workspaceType !== "local" || !directory) return [];
  const root = withoutExtendedPrefix(workspace.directory?.trim() || workspace.path);
  for (const candidate of [root, await realpath(root).catch(() => root)].map((path) => path.normalize("NFC"))) {
    if (isPathWithin(candidate, directory)) return relative(candidate, directory).split(sep).filter(Boolean);
  }
  return [];
}

/** Electron can persist Windows folders as `\\?\C:\...`; the engine stores `C:\...`. */
function withoutExtendedPrefix(directory: string): string {
  return process.platform === "win32" ? directory.replace(/^\\\\\?\\/, "").replace(/^\/\/\?\//, "") : directory;
}
