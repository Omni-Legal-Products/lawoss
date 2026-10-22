import { normalizeDirectoryPath } from "@/app/utils";

/**
 * LAWOSS: a chat of a client runs in its own folder - the client root, or a case subfolder for a
 * case chat. The engine keeps one instance per folder, so the chat's events, status and
 * permission requests exist only in that folder's instance. The app follows the chat's recorded
 * folder only while it lies inside the client root; the server checks ownership again.
 */
type ClientFolder = { path?: string | null; workspaceType?: string | null } | null | undefined;

/** Comparable spelling: NFC, `/` separators, no trailing slash, platform case rules. */
function comparable(path: string): string {
  return normalizeDirectoryPath(path.normalize("NFC"));
}

/** Is `directory` the client root or a folder below it? `..` segments never count as inside. */
export function isWithinClientFolder(root: string, directory: string): boolean {
  const base = comparable(root), target = comparable(directory);
  if (!base || !target || target.split("/").includes("..")) return false;
  return target === base || target.startsWith(base.endsWith("/") ? base : `${base}/`);
}

/** The folder a chat runs in: its recorded folder inside the client root, otherwise the root (and always the root for a remote worker). */
export function effectiveSessionDirectory(workspace: ClientFolder, session?: { directory?: string | null } | null): string {
  const root = workspace?.path?.trim() ?? "";
  const directory = session?.directory?.trim() ?? "";
  if (!root || !directory || workspace?.workspaceType === "remote") return root;
  return isWithinClientFolder(root, directory) ? directory : root;
}

/** The folder of one open chat, from its loaded snapshot (another chat's snapshot never counts); the client root until it loads. */
export function chatDirectory(clientRoot: string, remote: boolean, sessionId: string, loaded?: { session: { id: string; directory?: string | null } } | null): string {
  return effectiveSessionDirectory({ path: clientRoot, workspaceType: remote ? "remote" : "local" }, loaded?.session.id === sessionId ? loaded.session : null);
}
