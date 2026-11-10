import { isAbsolute, relative, resolve, sep } from "node:path";
import { ApiError } from "../errors.js";
import { readRuntimeOpencodeConfig, runtimeExternalDirectory, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { realpath } from "./canonical-path.js";

/** Retarget host permissions owned by the moved project; independent grants stay untouched. */
export async function rebaseWorkspaceMemoryAuthority(config: ServerConfig, previous: WorkspaceInfo, destination: string): Promise<() => Promise<void>> {
  const before = await readRuntimeOpencodeConfig(config, previous.id);
  // Engine v2: folder grants are ordered `external_directory` rules; their order is kept.
  const rules = runtimeExternalDirectory(before);
  const next: Array<(typeof rules)[number]> = [];
  let changed = false;
  for (const rule of rules) {
    const pattern = rule.resource;
    const folder = pattern.endsWith("/*") ? pattern.slice(0, -2) : pattern;
    const child = isAbsolute(folder) ? relative(previous.path, folder) : "..";
    if (isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`)) { next.push(rule); continue; }
    // Unsupported rules stay restrictive rather than become new grants.
    if (!pattern.endsWith("/*") || /[\0*?\[\]{}!]/.test(folder)) throw new ApiError(422, "workspace_memory_rebind_failed", "A project-owned custom memory rule requires review before reconnecting");
    const target = await realpath(resolve(destination, child));
    const targetChild = relative(destination, target);
    if (isAbsolute(targetChild) || targetChild === ".." || targetChild.startsWith(`..${sep}`)) throw new ApiError(422, "workspace_memory_rebind_failed", "Project memory folder escapes the recovered root");
    next.push({ ...rule, resource: `${target.replace(/[\\/]+$/, "")}/*` });
    changed = true;
  }
  if (!changed) return async () => {};
  const withFolders = (folders: readonly (typeof rules)[number][]) => (current: Awaited<ReturnType<typeof readRuntimeOpencodeConfig>>) => ({ ...current,
    permissions: [...(current.permissions ?? []).filter(rule => rule.action !== "external_directory"), ...folders] });
  await writeRuntimeOpencodeConfig(config, previous.id, withFolders(next));
  return async () => { await writeRuntimeOpencodeConfig(config, previous.id, withFolders(rules)); };
}
