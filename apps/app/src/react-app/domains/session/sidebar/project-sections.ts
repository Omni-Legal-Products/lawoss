import type { WorkspaceSessionGroup } from "@/app/types";

export function projectSectionGroups(groups: WorkspaceSessionGroup[], roles: Record<string, "owner" | "member">, shared: boolean): WorkspaceSessionGroup[] {
  return groups.filter((group) => (roles[group.workspace.id] === "member") === shared);
}

/** Reordering one section must preserve the positions of all other projects. */
export function reorderProjectSection(allIds: string[], sectionIds: string[]): string[] {
  const included = new Set(sectionIds);
  let index = 0;
  return allIds.map((id) => included.has(id) ? sectionIds[index++] : id);
}
