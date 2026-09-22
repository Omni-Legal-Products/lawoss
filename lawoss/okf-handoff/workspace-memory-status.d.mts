export interface MemoryGrants { workspaceRoot: string; folders: string[]; hiddenCount: number }
export interface WorkspaceMemoryStatus {
  present: boolean; complete: boolean; directory: string; loadedAt: string;
  matterId: string | null; bindingHash: string | null; profileHash: string | null; contextHash: string | null;
  grants: { authority: "runtime"; folders: string[]; hiddenCount: number };
  sources: { id: string; root: string; role: "case_memory" | "case_card" | "work_note" | "task_log" | "rules" | "lessons" | "source_index" | "evidence"; required: boolean; writable: boolean; status: "loaded" | "missing" | "error"; sha256: string | null; bytes: number }[];
  problems: { code: string; message: string; sourceId?: string }[];
}
export function runtimeMemoryGrants(directory: string, externalDirectory: unknown): MemoryGrants;
export function workspaceMemoryStatus(directory: string, grants: MemoryGrants): WorkspaceMemoryStatus;
