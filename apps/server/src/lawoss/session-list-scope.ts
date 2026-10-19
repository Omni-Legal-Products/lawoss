import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import { ApiError } from "../errors.js";
import type { WorkspaceInfo } from "../types.js";
import { isPathWithin } from "./path-within.js";
import { workspaceOwnsSession } from "./workspace-history.js";

/**
 * LAWOSS: engine 1.18.29 lists sessions per engine project, and every folder without git shares
 * one global project rooted at `/`. Without `directory` in the query, with `scope=project` or
 * with a `path` outside the folder it lists every client's chats. A workspace proxy therefore
 * pins the query to its own folder (`directory` is already resolved inside the workspace root)
 * and accepts `path` only when it names the root or a folder below it.
 */
export async function scopeSessionListQuery(input: {
  query: URLSearchParams;
  directory: string;
  roots: readonly string[];
  worktree: () => Promise<string>;
}): Promise<void> {
  if (input.query.has("scope")) throw new ApiError(400, "invalid_scope", "Session lists are limited to this folder");
  input.query.set("directory", input.directory);
  const path = input.query.get("path");
  if (path !== null && !pathWithinRoots(path, await input.worktree(), input.roots)) {
    throw new ApiError(400, "path_escape", "Session path escapes workspace root");
  }
}

/**
 * The engine matches `path` literally (and with SQL LIKE below it), relative to the project
 * worktree with `/` separators. Accept only that canonical form: no empty, `.` or `..` segments.
 * Unicode normalization does not change the folder on macOS, so containment compares NFC forms.
 */
function pathWithinRoots(path: string, worktree: string, roots: readonly string[]): boolean {
  const segments = path === "" ? [] : path.split("/");
  if (isAbsolute(path) || path.includes("\\") || segments.some((segment) => segment === "" || segment === "." || segment === "..")) return false;
  const target = resolve(worktree, ...segments).normalize("NFC");
  return roots.some((root) => isPathWithin(root.normalize("NFC"), target));
}

export async function engineProjectWorktree(url: string, headers: Headers, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { headers, signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
  if (!response.ok) throw new ApiError(502, "opencode_request_failed", "OpenCode project lookup failed");
  const project = z.object({ worktree: z.string().min(1) }).safeParse(await response.json());
  if (!project.success) throw new ApiError(502, "opencode_invalid_response", "Invalid OpenCode project");
  return project.data.worktree;
}

/**
 * `path` is matched with SQL LIKE, so `_`/`%` in a folder name and ASCII case also match a
 * sibling (`Klient_A/%` matches `Klient-A/Spis`). The listed sessions are filtered again here.
 */
export function workspaceListsSession(workspace: WorkspaceInfo, roots: readonly string[], session: { id: string; directory?: string | null }): boolean {
  const directory = session.directory;
  if (!directory) return false;
  return workspaceOwnsSession(workspace, session) || roots.some((root) => isPathWithin(root.normalize("NFC"), directory.normalize("NFC")));
}
