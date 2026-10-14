import { isAbsolute, relative, resolve, sep } from "node:path";
import { ApiError } from "../errors.js";
import { readRuntimeOpencodeConfig, runtimeExternalDirectory, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { realpath } from "./canonical-path.js";

/** Retarget host permissions owned by the moved project; independent grants stay untouched. */
export async function rebaseWorkspaceMemoryAuthority(config: ServerConfig, previous: WorkspaceInfo, destination: string): Promise<() => Promise<void>> {
  const before = await readRuntimeOpencodeConfig(config, previous.id);
  const rules = runtimeExternalDirectory(before);
  const next: Record<string, unknown> = {};
  let changed = false;
  for (const [pattern, value] of Object.entries(rules)) {
    const folder = pattern.endsWith("/*") ? pattern.slice(0, -2) : pattern;
    const child = isAbsolute(folder) ? relative(previous.path, folder) : "..";
    if (isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`)) { next[pattern] = value; continue; }
    // Unsupported rules stay restrictive rather than become new grants.
    if (!pattern.endsWith("/*") || /[\0*?\[\]{}!]/.test(folder)) throw new ApiError(422, "workspace_memory_rebind_failed", "A project-owned custom memory rule requires review before reconnecting");
    const target = await realpath(resolve(destination, child));
    const targetChild = relative(destination, target);
    if (isAbsolute(targetChild) || targetChild === ".." || targetChild.startsWith(`..${sep}`)) throw new ApiError(422, "workspace_memory_rebind_failed", "Project memory folder escapes the recovered root");
    next[`${target.replace(/[\\/]+$/, "")}/*`] = value;
    changed = true;
  }
  if (!changed) return async () => {};
  await writeRuntimeOpencodeConfig(config, previous.id, current => ({ ...current, permission: { ...current.permission, external_directory: next } }));
  return async () => { await writeRuntimeOpencodeConfig(config, previous.id, current => ({ ...current, permission: { ...current.permission, external_directory: rules } })); };
}
