import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, posix, resolve, win32 } from "node:path";

/** Resolve the actual filesystem target under a separately trusted workspace root. */
export function resolveWorkspacePath(workspaceRoot: string, candidate: string, allowMissing = false): string {
  const root = realpathSync(workspaceRoot);
  let current = resolve(candidate);
  const missing: string[] = [];
  while (true) {
    try {
      lstatSync(current);
      break;
    } catch (error) {
      if (!allowMissing || !(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      missing.unshift(basename(current));
      current = parent;
    }
  }
  // A dangling symlink deliberately fails realpath rather than becoming a new path.
  const target = resolve(realpathSync(current), ...missing);
  if (!isWithinWorkspaceRootPath({ workspaceRoot: root, candidate: target })) {
    throw Object.assign(new Error("Path must stay within workspace root"), { status: 403 });
  }
  return target;
}

export function normalizeScopedDirectoryPath(input: string, platform = process.platform) {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const withoutVerbatim = /^\\\\\?\\UNC[\\/]/i.test(trimmed)
    ? `\\\\${trimmed.slice(8)}`
    : /^\\\\\?\\[a-zA-Z]:[\\/]/.test(trimmed)
      ? trimmed.slice(4)
      : trimmed;
  const unified = withoutVerbatim.replace(/\\/g, "/");
  const withoutTrailing = unified.replace(/\/+$/, "");
  const normalized = withoutTrailing || "/";
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function isWithinWorkspaceRootPath(input: {
  workspaceRoot: string;
  candidate: string;
  platform?: NodeJS.Platform;
}) {
  const platform = input.platform ?? process.platform;
  const paths = platform === "win32" ? win32 : posix;
  const normalize = (value: string) => platform === "win32" ? normalizeScopedDirectoryPath(value, platform) : value;
  const root = paths.resolve(normalize(input.workspaceRoot));
  const target = paths.resolve(normalize(input.candidate || input.workspaceRoot));
  const relativePath = paths.relative(root, target);
  return relativePath !== ".." && !relativePath.startsWith(`..${paths.sep}`) && !paths.isAbsolute(relativePath);
}
