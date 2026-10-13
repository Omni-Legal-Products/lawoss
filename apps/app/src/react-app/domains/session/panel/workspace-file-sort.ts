import type { LegalworkWorkspaceDirectoryEntry } from "@/app/lib/legalwork-server";
import { projectFileDisplayName } from "../../workspace/project-note-title";

export type WorkspaceFileSort = {
  key: "name" | "date" | "size" | "type";
  direction: "asc" | "desc";
};

export const DEFAULT_WORKSPACE_FILE_SORT: Readonly<WorkspaceFileSort> = Object.freeze({ key: "name", direction: "asc" });

export function isSortKey(value: unknown): value is WorkspaceFileSort["key"] {
  return value === "name" || value === "date" || value === "size" || value === "type";
}

export function isSortDirection(value: unknown): value is WorkspaceFileSort["direction"] {
  return value === "asc" || value === "desc";
}

function displayName(entry: LegalworkWorkspaceDirectoryEntry): string {
  return entry.kind === "file" ? projectFileDisplayName(entry.path, entry.name) : entry.name;
}

function extension(entry: LegalworkWorkspaceDirectoryEntry): string {
  if (entry.kind === "dir") return "";
  const dot = entry.name.lastIndexOf(".");
  return dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : "";
}

function compareNumbers(a: number | undefined, b: number | undefined, direction: number): number {
  const knownA = typeof a === "number" && Number.isFinite(a);
  const knownB = typeof b === "number" && Number.isFinite(b);
  if (!knownA || !knownB) return knownA ? -1 : knownB ? 1 : 0;
  return (a === b ? 0 : a < b ? -1 : 1) * direction;
}

/** Keep directories first and never reorder the caller's React Query cache. */
export function sortWorkspaceEntries<T extends LegalworkWorkspaceDirectoryEntry>(
  entries: readonly T[], preferences: WorkspaceFileSort, locale: string,
): T[] {
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const direction = preferences.direction === "desc" ? -1 : 1;
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    const nameOrder = collator.compare(displayName(a), displayName(b));
    let primary: number;
    switch (preferences.key) {
      case "date": primary = compareNumbers(a.updatedAt, b.updatedAt, direction); break;
      case "size": primary = compareNumbers(a.size, b.size, direction); break;
      case "type": primary = collator.compare(extension(a), extension(b)) * direction; break;
      case "name": primary = nameOrder * direction; break;
    }
    // Secondary names and paths remain ascending, including numeric metadata ties.
    return primary || nameOrder || (a.path === b.path ? 0 : a.path < b.path ? -1 : 1);
  });
}

type SortStorage = Pick<Storage, "getItem" | "setItem">;
const STORAGE_PREFIX = "lawoss.workspace-file-sort.v1:";

function browserStorage(): SortStorage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

export function readWorkspaceFileSort(workspaceId: string | null, storage?: SortStorage | null): WorkspaceFileSort {
  if (workspaceId) {
    try {
      const raw = (storage === undefined ? browserStorage() : storage)?.getItem(STORAGE_PREFIX + encodeURIComponent(workspaceId));
      const value: unknown = raw ? JSON.parse(raw) : null;
      if (value !== null && typeof value === "object" && "key" in value && "direction" in value
        && isSortKey(value.key) && isSortDirection(value.direction)) {
        return { key: value.key, direction: value.direction };
      }
    } catch { /* A corrupt preference or blocked storage must not hide files. */ }
  }
  return { ...DEFAULT_WORKSPACE_FILE_SORT };
}

export function writeWorkspaceFileSort(workspaceId: string | null, preferences: WorkspaceFileSort, storage?: SortStorage | null): void {
  if (!workspaceId) return;
  try {
    (storage === undefined ? browserStorage() : storage)?.setItem(STORAGE_PREFIX + encodeURIComponent(workspaceId), JSON.stringify(preferences));
  } catch { /* Sorting remains usable when preferences cannot be persisted. */ }
}
