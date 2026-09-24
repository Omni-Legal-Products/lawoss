/** Opt-in legacy Markdown workspace memory. No source text is interpreted as authority. */
export type WorkspaceMemoryRole = "case_memory" | "case_card" | "work_note" | "task_log" | "rules" | "lessons" | "source_index" | "evidence";
export interface WorkspaceMemoryOptions { matterId?: string; allowedRoots?: string[] }
interface WorkspaceMemoryProblem { code: string; message: string; sourceId?: string }
export interface WorkspaceMemorySource {
  id: string; role: WorkspaceMemoryRole; path: string; root: string;
  required: boolean; writable: boolean; anchors: string[];
  status: "loaded" | "missing" | "error";
  sha256: string | null; bytes: number; content: string | null;
}
export interface WorkspaceMemoryReport {
  present: boolean; complete: boolean; directory: string; loadedAt: string;
  matterId: string | null; bindingHash: string | null; profileHash: string | null; contextHash: string | null;
  sources: WorkspaceMemorySource[]; problems: WorkspaceMemoryProblem[];
}
export interface WorkspaceMemoryUpdate { sourceId: string; expectedSha256: string; content: string }
export interface WorkspaceMemorySaveRequest {
  version: 1; matterId: string; operationId: string; reason: string;
  expectedBindingHash: string; expectedContextHash: string; updates: WorkspaceMemoryUpdate[];
}
export interface WorkspaceMemorySaveOptions extends WorkspaceMemoryOptions { apply?: boolean }
export interface WorkspaceMemorySaveReport {
  status: "preview" | "committed" | "already-applied" | "conflict" | "error";
  operationId: string | null; fingerprint: string | null;
  problems: WorkspaceMemoryProblem[]; changes: { sourceId: string; path: string; beforeSha256: string; afterSha256: string; bytes: number }[];
  historyPath: string | null; rollback: "not-needed" | "completed" | "incomplete";
}
export const WORKSPACE_MEMORY_LIMITS = Object.freeze({ profileBytes: 256 * 1024, journalBytes: 4 * 1024 * 1024, sourceBytes: 2 * 1024 * 1024, totalBytes: 16 * 1024 * 1024, sources: 256 });
