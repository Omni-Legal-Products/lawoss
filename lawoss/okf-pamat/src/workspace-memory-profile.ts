/** Browser-safe structural profile contract. Paths and grants still require filesystem verification. */
import { WORKSPACE_MEMORY_LIMITS } from "./workspace-memory-types.ts";
import type { WorkspaceMemoryRole } from "./workspace-memory-types.ts";

export interface WorkspaceMemoryProfile {
  version: 1;
  matterId: string;
  roots: { id: string; path: string }[];
  sources: { id: string; root: string; path: string; role: WorkspaceMemoryRole; required: boolean; writable: boolean; anchors?: string[] }[];
}
const roles: WorkspaceMemoryRole[] = ["case_memory", "case_card", "work_note", "task_log", "rules", "lessons", "source_index", "evidence"];
export const writableRoles = new Set<WorkspaceMemoryRole>(["case_memory", "case_card", "work_note", "task_log"]);
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function id(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(value); }
function role(value: unknown): value is WorkspaceMemoryRole { return typeof value === "string" && roles.some(r => r === value); }
function file(value: unknown): value is string { return typeof value === "string" && value.length > 0 && !value.includes("\\") && !value.includes("\0") && !/^[A-Za-z]:/.test(value) && value.split("/").every(part => part !== "" && part !== "." && part !== ".."); }

/** Throws on invalid v1 profiles. Unknown properties never become authority. */
export function parseWorkspaceMemoryProfile(value: unknown): WorkspaceMemoryProfile {
  if (!object(value) || value.version !== 1 || !id(value.matterId) || !Array.isArray(value.roots) || !Array.isArray(value.sources)) throw new Error("Invalid version 1 memory profile.");
  if (value.sources.length === 0 || value.sources.length > WORKSPACE_MEMORY_LIMITS.sources || value.roots.length === 0 || value.roots.length > WORKSPACE_MEMORY_LIMITS.sources) throw new Error("Invalid profile source/root count.");
  const rootIds = new Set<string>(), sourceIds = new Set<string>();
  const roots = value.roots.map(root => {
    if (!object(root) || !id(root.id) || rootIds.has(root.id) || typeof root.path !== "string" || root.path.length === 0 || root.path.includes("\0") || root.path.includes("\\") || root.path.split("/").includes("..")) throw new Error("Invalid or duplicate root.");
    rootIds.add(root.id); return { id: root.id, path: root.path };
  });
  const sources = value.sources.map(source => {
    if (!object(source) || !id(source.id) || sourceIds.has(source.id.toLowerCase()) || typeof source.root !== "string" || !rootIds.has(source.root) || !file(source.path) || !role(source.role) || typeof source.required !== "boolean" || typeof source.writable !== "boolean") throw new Error("Invalid or duplicate source.");
    if (source.writable && !writableRoles.has(source.role)) throw new Error(`Role ${source.role} cannot be writable.`);
    const anchors: string[] = [];
    if (source.anchors !== undefined) {
      if (!Array.isArray(source.anchors) || source.anchors.some(a => typeof a !== "string" || a.trim().length === 0)) throw new Error(`Invalid identity anchors: ${source.id}`);
      for (const anchor of source.anchors) if (typeof anchor === "string") anchors.push(anchor);
    }
    sourceIds.add(source.id.toLowerCase());
    return { id: source.id, root: source.root, path: source.path, role: source.role, required: source.required, writable: source.writable, ...(source.anchors !== undefined ? { anchors } : {}) };
  });
  if (!sources.some(s => s.role === "case_memory" && s.required)) throw new Error("At least one case_memory source must be required.");
  if (!sources.some(s => s.required && (s.anchors?.length ?? 0) > 0)) throw new Error("At least one required source must have identity anchors.");
  return { version: 1, matterId: value.matterId, roots, sources };
}

/** Text entry point enforces the same UTF-8 byte limit as the filesystem reader. */
export function parseWorkspaceMemoryProfileText(text: string): WorkspaceMemoryProfile {
  if (new TextEncoder().encode(text).byteLength > WORKSPACE_MEMORY_LIMITS.profileBytes) throw new Error("Memory profile byte limit exceeded.");
  return parseWorkspaceMemoryProfile(JSON.parse(text));
}
