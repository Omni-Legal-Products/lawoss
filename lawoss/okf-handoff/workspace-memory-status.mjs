import { isAbsolute } from "node:path";
import { checkedDirectory, isObject } from "../okf-pamat/src/workspace-memory-fs.ts";
import { readWorkspaceMemory } from "../okf-pamat/src/workspace-memory-reader.ts";

/** Consume ONLY the host-owned runtime row. Any custom/deny rule disables external grants. */
export function runtimeMemoryGrants(directory, externalDirectory) {
  const workspaceRoot = checkedDirectory(directory), folders = [];
  let hiddenCount = 0;
  if (!isObject(externalDirectory)) return { workspaceRoot, folders, hiddenCount: 1 };
  for (const [pattern, value] of Object.entries(externalDirectory)) {
    const folder = pattern.endsWith("/*") ? pattern.slice(0, -1) : "";
    if (value !== "allow" || !folder || !isAbsolute(folder) || /[\0*?\[\]{}!]/.test(folder) || folder.split(/[\\/]/).includes("..")) { hiddenCount++; continue; }
    folders.push(folder);
  }
  if (hiddenCount > 0) return { workspaceRoot, folders: [], hiddenCount };
  try { return { workspaceRoot, folders: [...new Set(folders.map(folder => checkedDirectory(folder)))].filter(folder => folder !== workspaceRoot).sort(), hiddenCount }; }
  catch { return { workspaceRoot, folders: [], hiddenCount: 1 }; }
}

/** Whitelist fields; no source bodies, anchors or raw filesystem error strings leave the reader. */
export function workspaceMemoryStatus(directory, grants) {
  const report = readWorkspaceMemory(directory, { allowedRoots: grants.folders });
  const problems = report.problems.map(({ code, sourceId }) => ({ code, ...(sourceId ? { sourceId } : {}), message: code === "invalid-source" ? "Source unavailable, unsafe or not authorized by the host." : code === "missing-source" ? "Source file is missing." : "Memory validation failed; check the profile and source status." }));
  if (grants.hiddenCount > 0) problems.push({ code: "host-grants-restricted", message: "Custom, denied or invalid host folder rules prevent external memory access." });
  return {
    present: report.present, complete: report.complete, directory: report.directory, loadedAt: report.loadedAt,
    matterId: report.matterId, bindingHash: report.bindingHash, profileHash: report.profileHash, contextHash: report.contextHash,
    grants: { authority: "runtime", folders: grants.folders, hiddenCount: grants.hiddenCount },
    sources: report.sources.map(({ id, root, role, required, writable, status, sha256, bytes }) => ({ id, root, role, required, writable, status, sha256, bytes })), problems,
  };
}
