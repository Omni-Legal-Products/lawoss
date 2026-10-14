import { create } from "zustand";
import { ViewRecordSchema, type ViewRecord } from "@legalwork/types/views";
import type { ViewPanelTab } from "./view-reference";

export type ViewDraftTab = { id: string; type: "view-draft"; serverUrl: string; generationId: string; label: string };
export type ViewGeneration = { serverUrl: string; workspaceId: string; sessionId: string; toolCallId: string; title: string; program: string; status: "streaming" | "failed" | "saved"; error?: string; saved?: ViewRecord };
export function viewGenerationId(serverUrl: string, sessionId: string, toolCallId: string) { return `view-generation:${JSON.stringify([serverUrl, sessionId, toolCallId])}`; }
export function viewDraftTab(id: string, generation: ViewGeneration): ViewDraftTab { return { id, type: "view-draft", generationId: id, serverUrl: generation.serverUrl, label: generation.title }; }
export function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function viewProgramInput(value: unknown) {
  const input = record(value) && record(value.input) ? value.input : value;
  return record(input) ? { program: typeof input.program === "string" ? input.program : "", title: typeof input.title === "string" ? input.title : "Creating view…" } : { program: "", title: "Creating view…" };
}
export function viewToolOutcome(output: unknown): { view: ViewRecord } | { error: string } {
  let value = output;
  if (typeof output === "string") {
    // Runtime reminders are appended after tool JSON, including in saved history.
    // Strip only that trailing envelope; malformed or incomplete JSON must still fail.
    const json = output.replace(/(?:\n\n<system-reminder topic="[^"\r\n]+">\n[\s\S]*?\n<\/system-reminder>)+\s*$/u, "");
    try { value = JSON.parse(json); } catch { return { error: "The agent did not return a saved view." }; }
  }
  if (record(value) && value.ok === false) return { error: typeof value.error === "string" ? value.error : record(value.error) && typeof value.error.message === "string" ? value.error.message : "The view could not be saved." };
  const parsed = ViewRecordSchema.strip().safeParse(record(value) && value.view ? value.view : value);
  return parsed.success ? { view: parsed.data } : { error: "The agent did not return a saved view." };
}
export const useViewGenerationStore = create<{ entries: Record<string, ViewGeneration>; update(id: string, next: ViewGeneration): void; fail(id: string, error: string): void }>((set) => ({
  entries: {},
  update: (id, next) => set(state => ({ entries: { ...state.entries, [id]: next } })),
  fail: (id, error) => set(state => { const current = state.entries[id]; return current?.status === "streaming" ? { entries: { ...state.entries, [id]: { ...current, status: "failed", error } } } : state; }),
}));
/** Resolve the generation in place, retaining the pane and tab order. Only saved tabs persist. */
export function replaceGenerationTab<T extends { id: string }>(tabs: T[], draftId: string, saved: ViewPanelTab): (T | ViewPanelTab)[] {
  return tabs.flatMap<T | ViewPanelTab>(tab => tab.id === draftId ? [saved] : tab.id === saved.id ? [] : [tab]);
}
