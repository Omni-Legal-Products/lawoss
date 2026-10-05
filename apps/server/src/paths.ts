import { realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { ApiError } from "./errors.js";
import { isPathWithin } from "./lawoss/path-within.js";

export function assertAbsolute(path: string): void {
  if (!isAbsolute(path)) {
    throw new ApiError(400, "invalid_path", "Path must be absolute");
  }
}

export async function resolveWithinRoot(root: string, ...segments: string[]): Promise<string> {
  const resolvedRoot = await realpath(root);
  const candidate = resolve(resolvedRoot, ...segments);
  const resolvedCandidate = await realpath(candidate).catch(() => candidate);
  if (resolvedCandidate === resolvedRoot) return candidate;
  // 🟡 LAWOSS: koreň disku (`D:\`) už lomkou končí, prefix `root + sep` by odmietol každý priečinok veci.
  if (!isPathWithin(resolvedRoot, resolvedCandidate)) {
    throw new ApiError(400, "path_escape", "Path escapes workspace root");
  }
  return candidate;
}
