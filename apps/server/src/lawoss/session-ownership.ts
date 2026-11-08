import { realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { foldedPath, isPathWithin } from "./path-within.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { foreignNestedClientRoots } from "./linked-folders.js";
import { canonicalPath } from "./linked-folders-rules.js";
import { workspaceListsSession } from "./session-list-scope.js";
import { workspaceOwnsSession, workspaceOwnsSessionDirectory } from "./workspace-history.js";

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
  if (workspace.workspaceType !== "local" || !session.directory) return [];
  const directory = session.directory.normalize("NFC");
  const root = sessionFolderRoot(workspace);
  for (const candidate of [root, await realpath(root).catch(() => root)].map((path) => path.normalize("NFC"))) {
    if (!isPathWithin(candidate, directory)) continue;
    // Matched in NFC; the segments keep the engine's own spelling (byte-exact file systems).
    const depth = relative(candidate, directory).split(sep).filter(Boolean).length;
    return depth ? resolve(session.directory).split(sep).filter(Boolean).slice(-depth) : [];
  }
  return [];
}

/** LAWOSS: the one base a chat folder is computed against and joined to (front grant, sandbox). */
export function sessionFolderRoot(workspace: WorkspaceInfo): string {
  return withoutExtendedPrefix(workspace.directory?.trim() || workspace.path);
}

/** The absolute folder of a chat: `folder` joined to `sessionFolderRoot`; a root chat keeps `rootSpelling` as before. */
export function joinSessionFolder(workspace: WorkspaceInfo, folder: readonly string[], rootSpelling: string): string {
  return folder.length ? join(sessionFolderRoot(workspace), ...folder) : rootSpelling;
}

export type ChatOwnership = (session: { id: string; directory?: string | null }) => Promise<boolean>;

/**
 * LAWOSS (engine v2): which chats a client workspace owns. Engine 2.1.4 reads, drives and lists
 * any session ID for any caller; the server decides ownership from the session's own location.
 *
 * - The chat folder lies in the client root (or is the root), compared after `realpath` in NFC,
 *   path segment by segment (`Klient_A` never owns `Klient-A`, a symlink out of the root is not inside).
 *   A case chat in a case subfolder therefore belongs to its client.
 * - A chat inside another client registered within this root (a nested client, #264) belongs to that
 *   client alone: the nested client stays visible as a folder, but its chats are not the parent's. A separately
 *   registered case of this same client (its nearest client card is this client's, review #295) stays this client's.
 * - A chat captured before a reconnect keeps its old folder (`workspace-history.ts`).
 *
 * The nested roots are read once per call of this factory; reuse the returned check for a list.
 */
export async function workspaceChatOwnership(config: ServerConfig, workspace: WorkspaceInfo): Promise<ChatOwnership> {
  const root = sessionFolderRoot(workspace);
  const [canonicalRoot, nested] = await Promise.all([canonicalPath(root), foreignNestedClientRoots(config, workspace)]);
  const foldedNested = nested.map((other) => foldedPath(other));
  // Chats of a list share few folders: one canonical lookup per folder.
  const canonical = new Map<string, Promise<string>>();
  return async (session) => {
    if (!session.directory) return false;
    let pending = canonical.get(session.directory);
    if (!pending) { pending = canonicalPath(withoutExtendedPrefix(session.directory)); canonical.set(session.directory, pending); }
    const directory = await pending;
    // Folding (case, NFC) only widens what counts as the nested client, so it only refuses more.
    if (foldedNested.some((other) => isPathWithin(other, foldedPath(directory)))) return false;
    if (isPathWithin(canonicalRoot, directory)) return true;
    return !!workspace.previousSessionIds?.includes(session.id) && workspaceOwnsSessionDirectory({ ...workspace, path: root }, session.directory);
  };
}

/** One chat; for a list use `workspaceChatOwnership` once. */
export async function workspaceOwnsChat(config: ServerConfig, workspace: WorkspaceInfo, session: { id: string; directory?: string | null }): Promise<boolean> {
  return (await workspaceChatOwnership(config, workspace))(session);
}

/** Electron can persist Windows folders as `\\?\C:\...`; the engine stores `C:\...`. */
function withoutExtendedPrefix(directory: string): string {
  return process.platform === "win32" ? directory.replace(/^\\\\\?\\/, "").replace(/^\/\/\?\//, "") : directory;
}
