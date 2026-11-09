import type { SessionStatus } from "@opencode/client";
import type { LegalworkServerClient, LegalworkSessionSnapshot, LawossDocumentSummary } from "@/app/lib/legalwork-server";
import { useSessionActivityStore } from "../status/session-activity-store";
import { t } from "@/i18n";
import { isFreeModelRequest } from "@/lawoss/shell/free-models";

export const PROTECTED_DOCUMENT_GENERATION_TRANSPORT: "protected-documents-v1" = "protected-documents-v1";
export type DocumentGenerationMetadata = {
  projectId: string;
  baseUrl: string;
  workspaceId: string;
  root: string;
  directory: string;
  /** A distinct native transport must never retry an old general-engine session. */
  transport?: typeof PROTECTED_DOCUMENT_GENERATION_TRANSPORT;
  protectedTarget?: {providerId: string; modelId: string; targetFingerprint: string; profileId?: string; profileRevision?: number};
};
export type DocumentGenerationBinding = DocumentGenerationMetadata & {
  sessionId: string;
  startedAt: number;
  phase: "accepted" | "running" | "completed" | "error";
  error: string | null;
  nativeRunObserved?: boolean;
  messageId?: string;
  nativeRevision?: number;
};
const storageKey = "lawoss.document-generations.v1";
const bindings = new Map<string, DocumentGenerationBinding>();
const listeners = new Set<() => void>();
const inFlight = new Set<string>();
let loaded = false;
let revision = 0;
let lastMessageTime = 0;
let messageCounter = 0;

/** OpenCode Identifier ascending format: six-byte timestamp/counter plus 14 random base62 characters. */
function createMessageId() {
  const time = Math.max(Date.now(), lastMessageTime);
  messageCounter = time === lastMessageTime ? messageCounter + 1 : 1;
  lastMessageTime = time;
  if (messageCounter >= 4096) {
    lastMessageTime += 1;
    messageCounter = 1;
  }
  const timestamp = ((BigInt(lastMessageTime) * 4096n + BigInt(messageCounter)) & 0xffffffffffffn).toString(16).padStart(12, "0");
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const random = crypto.getRandomValues(new Uint8Array(14));
  return `msg_${timestamp}${Array.from(random, value => alphabet[value % 62]).join("")}`;
}

/** LAWOSS: the server delivers a queued protected turn as engine message `msg_<queue UUID hex>`
 * (lawoss/protected-ai/runtime.ts `submitQueued`), so the binding and the queue share one identity. */
export function protectedQueueMessageId(queueId: string) {
  return `msg_${queueId.replaceAll("-", "")}`;
}
function protectedQueueEntryId(messageId: string) {
  const hex = /^msg_([0-9a-f]{32})$/.exec(messageId)?.[1];
  if (!hex) throw new Error("A protected document task needs its queued message identity.");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** LAWOSS: a protected document chat accepts work only through its message queue; its direct
 * dispatch is refused (409 `protected_session_dispatch`). The queued intent is the selected task
 * text and model only: no agents, skills, files, reminders or other ambient context. The confined
 * engine knows only the fixed `high` behaviour, so another selected behaviour uses the model default. */
export async function sendProtectedDocumentTask(input: {
  client: Pick<LegalworkServerClient, "updateSessionMessageQueue">; workspaceId: string; sessionId: string; messageId: string;
  text: string; model: { providerID: string; modelID: string }; variant?: string | null;
}) {
  const text = input.text.trim();
  if (!text) throw new Error("This document session accepts only the selected document task.");
  // 🟡 LAWOSS (#231): an upstream free model never receives client data.
  if (isFreeModelRequest(input.model)) throw new Error(t("session_route.model_unavailable"));
  return input.client.updateSessionMessageQueue(input.workspaceId, input.sessionId, {
    type: "enqueue", id: protectedQueueEntryId(input.messageId),
    draft: { mode: "prompt", text, parts: [{ type: "text", text }], attachments: [], editor: { mentions: {}, pasteParts: [] } },
    execution: { kind: "prompt", text, files: [], agents: [], skills: [], metadata: { legalworkPrompt: { visibleText: text, reminders: [] } },
      model: { providerID: input.model.providerID, id: input.model.modelID, ...(input.variant === "high" ? { variant: "high" } : {}) }, agent: "legalwork" },
  });
}

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
      if (value.transport !== undefined && value.transport !== PROTECTED_DOCUMENT_GENERATION_TRANSPORT) continue;
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
/** UI restriction only; the host's private runtime registry owns actual authority. */
export function hasProtectedDocumentSession(projectId: string, sessionId: string): boolean {
  return allDocumentGenerations().some(([, binding]) => binding.projectId === projectId && binding.sessionId === sessionId && binding.transport === PROTECTED_DOCUMENT_GENERATION_TRANSPORT);
}
export const documentGenerationsRevision = () => revision;
export function subscribeDocumentGenerations(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function documentGenerationKey(metadata: DocumentGenerationMetadata, language: string, sources: LawossDocumentSummary[]) {
  return JSON.stringify([metadata.projectId, metadata.baseUrl, metadata.workspaceId, metadata.root, metadata.directory, language, sources.filter(source => !source.provenance.parentId).map(source => [source.id, source.hash]).sort((a, b) => a[0].localeCompare(b[0])), ...(metadata.transport ? [metadata.transport, ...(metadata.protectedTarget ? [metadata.protectedTarget] : [])] : [])]);
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
      saveBinding(key, { ...binding, phase: "error", error: record.errorMessage, nativeRevision: (binding.nativeRevision ?? 0) + 1 });
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
    saveBinding(key, { ...binding, phase: "running", nativeRunObserved: true, nativeRevision: (binding.nativeRevision ?? 0) + 1 });
  } else if (status.type === "idle") {
    const terminal = binding.nativeRunObserved ? { phase: "completed" as const, error: null } : {};
    saveBinding(key, { ...binding, ...terminal, nativeRevision: (binding.nativeRevision ?? 0) + 1 });
  }
}

export type DocumentGenerationSnapshot = {
  snapshot: Pick<LegalworkSessionSnapshot, "messages" | "status">;
  messageId?: string;
  nativeRevision: number;
};

/** Capture the attempt and native event revision before starting the non-atomic server read. */
export async function readDocumentGenerationSnapshot(key: string, read: () => Promise<Pick<LegalworkSessionSnapshot, "messages" | "status">>): Promise<DocumentGenerationSnapshot> {
  const binding = getDocumentGeneration(key);
  const messageId = binding?.messageId;
  const nativeRevision = binding?.nativeRevision ?? 0;
  return { snapshot: await read(), messageId, nativeRevision };
}

export function isDocumentGenerationSnapshotCurrent(binding: DocumentGenerationBinding | null, result: DocumentGenerationSnapshot) {
  return Boolean(binding && result.messageId === binding.messageId && result.nativeRevision === (binding.nativeRevision ?? 0));
}

export function reconcileDocumentGeneration(key: string, result: DocumentGenerationSnapshot | Pick<LegalworkSessionSnapshot, "messages" | "status">) {
  const binding = getDocumentGeneration(key);
  if (!binding || binding.phase === "completed" || binding.phase === "error") return;
  const envelope = "snapshot" in result ? result : null;
  if (!envelope || !isDocumentGenerationSnapshotCurrent(binding, envelope)) return;
  const snapshot = envelope.snapshot;
  // Historical/legacy bindings without a persisted engine-visible ID remain conservative.
  // Engine v2 has no assistant `parentID`: the turn is every assistant message after the
  // engine-visible user message, up to the next user message.
  const userIndex = binding.messageId ? snapshot.messages.findIndex(({ info }) => info.role === "user" && info.id === binding.messageId) : -1;
  const nextUser = userIndex < 0 ? -1 : snapshot.messages.findIndex(({ info }, index) => index > userIndex && info.role === "user");
  const currentTurn = userIndex < 0 ? []
    : snapshot.messages.slice(userIndex + 1, nextUser < 0 ? undefined : nextUser).filter(({ info }) => info.role === "assistant" && !info.summary);
  const failed = currentTurn.find(message => message.info.role === "assistant" && message.info.error);
  if (failed?.info.role === "assistant") {
    saveBinding(key, { ...binding, phase: "error", error: JSON.stringify(failed.info.error) });
    return;
  }
  if (snapshot.status.type === "busy" || snapshot.status.type === "retry") {
    if (binding.phase !== "running" || !binding.nativeRunObserved) {
      saveBinding(key, { ...binding, phase: "running", nativeRunObserved: true });
    }
    return;
  }
  const completed = currentTurn.some(({ info }) => {
    if (info.role !== "assistant" || typeof info.time.completed !== "number") return false;
    return Boolean(info.finish) && info.finish !== "tool-calls" && info.finish !== "unknown";
  });
  if (completed) {
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
  send: (sessionId: string, messageId: string) => Promise<void>;
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
    const messageId = input.metadata.transport === PROTECTED_DOCUMENT_GENERATION_TRANSPORT ? protectedQueueMessageId(crypto.randomUUID()) : createMessageId();
    binding = { ...input.metadata, sessionId, startedAt: Date.now(), phase: "accepted", error: null, nativeRunObserved: false, messageId, nativeRevision: 0 };
    saveBinding(input.key, binding);
    submitted = true;
    useSessionActivityStore.getState().setRunStatus(input.metadata.projectId, sessionId, { type: "busy" });
    await input.send(sessionId, binding.messageId!);
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
