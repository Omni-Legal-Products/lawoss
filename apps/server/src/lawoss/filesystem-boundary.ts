import { lstat, readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { ApiError } from "../errors.js";
import type { TokenScope } from "../types.js";
import { realpath } from "./canonical-path.js";
import { isPathWithin } from "./path-within.js";

type PathOptions = { allowRoot?: boolean; preserveLeaf?: boolean };
const invalidPath = () => new ApiError(400, "invalid_path", "Path must remain inside the workspace");

/** A configured directory that resolves outside the workspace is skipped, not fatal. */
export const isOutsideWorkspacePath = (error: unknown): error is ApiError => error instanceof ApiError && error.code === "invalid_path";

/** Resolve existing links, including ancestors of a file that does not exist yet.
 * The registered root may itself be a Dropbox/volume alias. Callers use the
 * returned canonical path, then recheck after human approval before writing.
 * This is not an OS sandbox against another process concurrently replacing dirs.
 */
export async function resolveWorkspaceFilePath(root: string, child: string, options: PathOptions = {}): Promise<string> {
  const canonicalRoot = await realpath(root);
  const requested = resolve(root, child);
  if (!isPathWithin(resolve(root), requested) && !isPathWithin(canonicalRoot, requested)) throw invalidPath();
  let cursor = requested;
  const missing: string[] = [];
  for (;;) {
    const info = await lstat(cursor).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      if (error.code === "ENOTDIR") throw invalidPath();
      throw error;
    });
    if (info) break;
    const parent = dirname(cursor);
    if (parent === cursor) throw invalidPath();
    missing.unshift(basename(cursor));
    cursor = parent;
  }
  // lstat found the node, so a failed realpath is a dangling/cyclic link, not
  // a missing ordinary child. Never fall back to its unchecked lexical path.
  const canonicalAncestor = await realpath(cursor).catch(() => { throw invalidPath(); });
  const candidate = resolve(canonicalAncestor, ...missing);
  if (!isPathWithin(canonicalRoot, candidate) || (!options.allowRoot && candidate === canonicalRoot)) throw invalidPath();
  if (options.preserveLeaf && requested !== resolve(root)) {
    // rename/rm act on the link itself, not on the object the link points at.
    const parent = await resolveWorkspaceFilePath(root, dirname(requested), { allowRoot: true });
    return join(parent, basename(requested));
  }
  return candidate;
}

export async function recheckWorkspaceFilePath(root: string, child: string, approved: string): Promise<void> {
  if (await resolveWorkspaceFilePath(root, child) !== approved) {
    throw new ApiError(409, "path_changed", "File path changed while the operation was awaiting approval");
  }
}

/** Files served to a viewer must not restore access to privileged config APIs.
 * Windows opens `opencode.json::$DATA`, `opencode.json.` and `opencode.json ` as the
 * same file, so a segment is compared without its stream suffix and trailing dots/spaces.
 * A colon elsewhere stays legal: macOS stores `/` from Finder names as `:`.
 */
export function isSensitiveWorkspacePath(path: string): boolean {
  const parts = path.replaceAll("\\", "/").toLowerCase().split("/").map(part => part.replace(/:.*$/, "").replace(/[. ]+$/, ""));
  if (parts.some(part => /^\.env(?:\..*)?$/.test(part) || [".npmrc", ".netrc", "auth.json", "credentials.json", "opencode.json", "opencode.jsonc"].includes(part))) return true;
  const metadata = parts.indexOf(".opencode");
  if (metadata >= 0) {
    const tail = parts.slice(metadata + 1);
    return !(tail[0] === "legalwork" && ["inbox", "outbox"].includes(tail[1] ?? ""));
  }
  return false;
}

/** Viewer check for many paths of one workspace: config and alias locations are resolved once.
 * `path` is the canonical location, `child` the requested workspace-relative path.
 */
export async function viewerProtectedPaths(root: string): Promise<(path: string, child?: string) => boolean> {
  const canonicalRoot = await realpath(root);
  // .opencode may itself be an in-workspace alias. Compare actual locations
  // too, so a second innocently named alias cannot expose the same config.
  const metadata = await resolveWorkspaceFilePath(root, ".opencode", { allowRoot: true }).catch(() => null);
  const documents: string[] = [];
  if (metadata) {
    for (const area of ["inbox", "outbox"]) {
      const location = await resolveWorkspaceFilePath(root, `.opencode/legalwork/${area}`).catch(() => null);
      if (location === resolve(metadata, "legalwork", area)) documents.push(location);
    }
  }
  const configured = new Set<string>();
  const protectedNames = (await readdir(canonicalRoot)).filter(name => isSensitiveWorkspacePath(name));
  for (const name of [...protectedNames, ".opencode/opencode.json", ".opencode/opencode.jsonc", ".opencode/legalwork.json"]) {
    const location = await resolveWorkspaceFilePath(root, name).catch(() => null);
    if (location) configured.add(location);
  }
  return (path, child) => {
    const privateMetadata = metadata !== null && isPathWithin(metadata, path) && !documents.some(location => isPathWithin(location, path));
    return privateMetadata || configured.has(path) || isSensitiveWorkspacePath(relative(canonicalRoot, path))
      || (child !== undefined && isSensitiveWorkspacePath(relative(resolve(root), resolve(root, child))));
  };
}

export async function resolveReadableWorkspaceFilePath(root: string, child: string, scope: TokenScope = "viewer", options: PathOptions = {}): Promise<string> {
  const path = await resolveWorkspaceFilePath(root, child, options);
  if (scope === "viewer" && (await viewerProtectedPaths(root))(path, child)) {
    throw new ApiError(403, "forbidden", "Configuration and credential files require collaborator access");
  }
  return path;
}
