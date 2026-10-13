import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import type { LegalworkSessionSnapshot, LawossDocumentSummary } from "@/app/lib/legalwork-server";
import { useSessionActivityStore } from "../status/session-activity-store";
import { t } from "@/i18n";

export type DocumentGenerationMetadata = {
  projectId: string;
  baseUrl: string;
  workspaceId: string;
  root: string;
  directory: string;
};
export type DocumentGenerationBinding = DocumentGenerationMetadata & {
  sessionId: string;
  startedAt: number;
  phase: "accepted" | "running" | "completed" | "error";
  error: string | null;
  nativeRunObserved?: boolean;
};
const storageKey = "lawoss.document-generations.v1";
const bindings = new Map<string, DocumentGenerationBinding>();
const listeners = new Set<() => void>();
const inFlight = new Set<string>();
let loaded = false;
let revision = 0;

function loadBindings() {
  if (loaded) return;
  loaded = true;
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    if (!Array.isArray(saved)) return;
    for (const item of saved.slice(-100)) {
      if (!Array.isArray(item) || typeof item[0] !== "string") continue;
      const value = item[1];
      if (!value || typeof value !== "object") continue;
      if (!["projectId", "baseUrl", "workspaceId", "root", "directory", "sessionId"].every(key => typeof value[key] === "string")) continue;
      if (!Number.isFinite(value.startedAt) || !["accepted", "running", "completed", "error"].includes(value.phase)) continue;
      bindings.set(item[0], { ...value, error: typeof value.error === "string" ? value.error : null });
    }
  } catch { /* Storage is optional; current native session remains retained in memory. */ }
}
function saveBinding(key: string, binding: DocumentGenerationBinding) {
  bindings.set(key, binding);
  try { localStorage.setItem(storageKey, JSON.stringify([...bindings].slice(-100))); } catch { /* Optional persistence. */ }
  revision += 1;
  for (const notify of listeners) notify();
}
export function getDocumentGeneration(key: string): DocumentGenerationBinding | null {
  loadBindings();
  return bindings.get(key) ?? null;
}
export function allDocumentGenerations() {
  loadBindings();
  return [...bindings];
}
export const documentGenerationsRevision = () => revision;
export function subscribeDocumentGenerations(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function documentGenerationKey(metadata: DocumentGenerationMetadata, language: string, sources: LawossDocumentSummary[]) {
  return JSON.stringify([metadata.projectId, metadata.baseUrl, metadata.workspaceId, metadata.root, metadata.directory, language, sources.filter(source => !source.provenance.parentId).map(source => [source.id, source.hash]).sort((a, b) => a[0].localeCompare(b[0]))]);
}
export function isDocumentGenerationActive(binding: DocumentGenerationBinding | null) {
  return binding?.phase === "accepted" || binding?.phase === "running";
}

/** Observe existing native activity; an idle-only snapshot/event is not proof of a finished accepted turn. */
export function observeDocumentGeneration(key: string, projectId: string) {
  const reconcile = () => {
    const binding = getDocumentGeneration(key);
    if (!binding || binding.phase === "completed" || binding.phase === "error") return;
    const record = useSessionActivityStore.getState().recordsByWorkspaceId[projectId]?.[binding.sessionId];
    if (!record || record.updatedAt < binding.startedAt) return;
    if (record.errorActive) {
      saveBinding(key, { ...binding, phase: "error", error: record.errorMessage });
    } else if (record.runActive && binding.phase === "accepted") {
      saveBinding(key, { ...binding, phase: "running" });
    }
  };
  const release = useSessionActivityStore.subscribe(reconcile);
  reconcile();
  return release;
}

/** Only live native run-status events, not model messages or idle-only cached reads, can finish an observed run. */
export function applyDocumentGenerationRunStatus(key: string, status: SessionStatus) {
  const binding = getDocumentGeneration(key);
  if (!binding || binding.phase === "completed" || binding.phase === "error") return;
  if (status.type === "busy" || status.type === "retry") {
    if (!binding.nativeRunObserved) {
      saveBinding(key, { ...binding, phase: "running", nativeRunObserved: true });
    }
  } else if (status.type === "idle" && binding.nativeRunObserved) {
    saveBinding(key, { ...binding, phase: "completed", error: null });
  }
}

export function reconcileDocumentGeneration(key: string, snapshot: Pick<LegalworkSessionSnapshot, "messages" | "status">) {
  const binding = getDocumentGeneration(key);
  if (!binding || binding.phase === "completed") return;
  const currentTurn = snapshot.messages.filter(message => message.info.role === "assistant" && message.info.time.created >= binding.startedAt);
  const failed = currentTurn.find(message => message.info.role === "assistant" && message.info.error);
  if (failed?.info.role === "assistant") {
    const error = JSON.stringify(failed.info.error);
    if (binding.phase !== "error" || binding.error !== error) {
      saveBinding(key, { ...binding, phase: "error", error });
    }
    return;
  }
  if (snapshot.status.type === "busy" || snapshot.status.type === "retry") {
    if (binding.phase === "error") return;
    if (binding.phase !== "running" || !binding.nativeRunObserved) {
      saveBinding(key, { ...binding, phase: "running", error: null, nativeRunObserved: true });
    }
    return;
  }
  const completed = currentTurn.some(message => message.info.role === "assistant" && typeof message.info.time.completed === "number" && message.info.time.completed >= binding.startedAt);
  if (completed && binding.phase !== "error") {
    saveBinding(key, { ...binding, phase: "completed", error: null });
  }
}

/** Native handoff is retained until a terminal run; only explicit newGeneration can replace a completed binding. */
export async function submitBoundDocumentGeneration(input: {
  key: string;
  metadata: DocumentGenerationMetadata;
  newGeneration?: boolean;
  preflight: () => Promise<void>;
  create: () => Promise<string>;
  send: (sessionId: string) => Promise<void>;
}) {
  if (inFlight.has(input.key)) throw new Error(t("documents.busy"));
  const existing = getDocumentGeneration(input.key);
  if (isDocumentGenerationActive(existing) || (existing?.phase === "completed" && !input.newGeneration)) return existing!.sessionId;
  if (input.newGeneration && existing?.phase !== "completed") throw new Error(t("documents.busy"));
  inFlight.add(input.key);
  let binding = existing;
  let submitted = false;
  try {
    await input.preflight();
    const sessionId = !binding || input.newGeneration ? await input.create() : binding.sessionId;
    binding = { ...input.metadata, sessionId, startedAt: Date.now(), phase: "accepted", error: null, nativeRunObserved: false };
    saveBinding(input.key, binding);
    submitted = true;
    useSessionActivityStore.getState().setRunStatus(input.metadata.projectId, sessionId, { type: "busy" });
    await input.send(sessionId);
    return sessionId;
  } catch (cause) {
    if (binding && submitted) {
      saveBinding(input.key, { ...binding, phase: "error", error: cause instanceof Error ? cause.message : String(cause) });
      if (cause instanceof Error) Object.assign(cause, { sessionId: binding.sessionId });
    }
    throw cause;
  } finally {
    inFlight.delete(input.key);
  }
}
export function clearDocumentGenerationsForTest(keepStorage = false) {
  bindings.clear();
  inFlight.clear();
  loaded = false;
  if (!keepStorage) try { localStorage.removeItem(storageKey); } catch { /* No test storage configured. */ }
}
