import { createHash, randomUUID } from "node:crypto";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import type { ApprovalService } from "../../approvals.js";
import type { GovernanceScope } from "../../ai-governance-schema.js";
import { ApiError } from "../../errors.js";
import type { ServerConfig } from "../../types.js";
import { readGovernanceProfiles } from "../ai-governance-store.js";
import { eligibleGovernanceProfiles } from "../ai-governance.js";
import type { LawossDocuments } from "../documents/service.js";
import { resolveWorkspaceFilePath } from "../filesystem-boundary.js";
import { createHostDecisionPort } from "../host-decision.js";
import { ProtectedDocumentTools } from "./document-tools.js";
import { ProtectedAiTransport, protectedAiTarget } from "./transport.js";
import { ProtectedVmEngine, type ProtectedVmOpen } from "./vm-engine.js";
import { runtimeStorageDir } from "../../runtime-opencode-config-store.js";
import { MAX_PROTECTED_CHECKPOINT, ProtectedSessionStore, type StoredProtectedSession } from "./persisted-state.js";
import { canonicalFilePath } from "../../file-write-lock.js";

export const protectedGenerationInputSchema = z.strictObject({
  workspaceId: z.string().min(1).max(256), caseDirectory: z.string().max(4096).default(""), providerId: z.string().min(1).max(128), modelId: z.string().min(1).max(200), profileId: z.string().min(1).max(128).optional(),
  sources: z.array(z.strictObject({ id: z.string().uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/) })).min(1).max(500),
});
type GenerationInput = z.input<typeof protectedGenerationInputSchema>;
export type GuestMeasurements = { engineSha256: string; runtimeManifestSha256: string; pluginSha256: string; configSha256: string; launcherSha256: string; checkpointSha256?: string };
const measurementHash = z.string().regex(/^[a-f0-9]{64}$/);
const measurementsSchema = z.strictObject({ engineSha256: measurementHash, runtimeManifestSha256: measurementHash, pluginSha256: measurementHash, configSha256: measurementHash, launcherSha256: measurementHash, checkpointSha256: measurementHash.optional() });
export type ProtectedGuestBundle = { directory: string; emptyDirectory: string; measurements: GuestMeasurements;
  currentBinding: () => Promise<GuestMeasurements>; dispose?: () => Promise<void> };
type Engine = Pick<ProtectedVmEngine, "fetch" | "stop">;
type SessionClaim = { owner: ProtectedDocumentRuntime; failed?: boolean };
type WorkerSlot = { owner: ProtectedDocumentRuntime; entry?: Entry };
type RuntimeOwnership = { store: ProtectedSessionStore; claims: Map<string, SessionClaim>; known: Map<string, Set<string>>; workers: Set<WorkerSlot>; admission: Promise<unknown> };
const runtimeOwners = new WeakMap<ServerConfig, RuntimeOwnership>();
const sessionKey = (workspaceId: string, sessionId: string) => JSON.stringify([workspaceId, sessionId]);
/** A synchronous host claim wins over every listener's historical read model,
 * including while a native decision or final checkpoint is still pending. */
export function activeProtectedRuntime(config: ServerConfig, workspaceId: string, sessionId: string): ProtectedDocumentRuntime | undefined {
  return runtimeOwners.get(config)?.claims.get(sessionKey(workspaceId, sessionId))?.owner;
}
type RuntimeOptions = { config: ServerConfig; approvals: ApprovalService; documents: LawossDocuments;
  getGuestBundle: (input: { modelId: string; operationId: string; checkpoint?: { path: string; sha256: string } }) => Promise<ProtectedGuestBundle>;
  /** Constructor-only protocol test seam, never supplied through HTTP or settings. */
  openEngine?: (input: ProtectedVmOpen) => Promise<Engine> };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
// Engine v2 public session record; the guest location is its fixed private scratch directory.
const sessionSchema = z.object({ id: z.string().regex(/^ses_[A-Za-z0-9]{1,128}$/), location: z.object({ directory: z.string().min(1) }).passthrough() }).passthrough();
const sessionEnvelope = z.object({ data: sessionSchema }).passthrough();
type GuestSession = z.infer<typeof sessionSchema>;
const GUEST_DIRECTORY = "/tmp/home/protected-engine/workspace";
const GUEST_PROVIDER = "protected-documents";
/** The normalized host-to-guest turn: text only, with an optional fixed variant. */
const promptSchema = z.strictObject({ text: z.string().min(1).max(2 * 1024 * 1024), variant: z.literal("high").optional() });
type GuestPrompt = z.infer<typeof promptSchema>;
const messageRecordSchema = z.object({ id: z.string().regex(/^msg_[A-Za-z0-9]{1,128}$/), type: z.string() }).passthrough();
const messagesEnvelope = z.object({ data: z.array(messageRecordSchema), cursor: z.object({ next: z.string().max(4096).nullish() }).passthrough() }).passthrough();
const activeEnvelope = z.object({ data: z.record(z.string(), z.unknown()) }).passthrough();
/** The terminal receipt of one delivered queued turn, read from the guest's own history. */
export type ProtectedTurnResult = { messageID: string; outcome: "succeeded" | "failed" | "interrupted"; assistant: Record<string, unknown> | null };
type Entry = { workspaceId: string; sessionId: string; directory: string; hostDirectory: string; operationId: string;
  workspaceRoot: string; sources: Array<{ id: string; hash: string }>;
  turnUploads: Map<string, string>; submitting?: boolean; busy?: boolean; evicting?: boolean; activityRevision: number; worker: WorkerSlot;
  input: z.output<typeof protectedGenerationInputSchema>; initialSourceSetSha256: string; rootIdentity: string; egress: AbortController; snapshotting?: Promise<void>;
  providerId: string; modelId: string;
  engine: Engine; bundle: ProtectedGuestBundle; controller: AbortController; timer: ReturnType<typeof setTimeout>;
  assertCurrent: () => Promise<void>; tools: Set<Promise<unknown>>; events?: Promise<void>; closing?: Promise<void> };
type Subscriber = { controller: ReadableStreamDefaultController<Uint8Array>; close: () => void };
// Native v2 queued intent (legacy v1 queue files are decoded into this shape by
// @legalwork/types). Text and copies of selected originals only: no agents, skills,
// reminders or other ambient context, and only the selected model.
const queueExecutionSchema = z.strictObject({ kind: z.literal("prompt"), id: z.string().max(256).optional(), text: z.string().max(512_000),
  files: z.array(z.strictObject({ uri: z.string().max(8192), name: z.string().max(4096).optional() })).max(16).optional(),
  agents: z.array(z.unknown()).max(0).optional(), skills: z.array(z.unknown()).max(0).optional(),
  metadata: z.strictObject({ legalworkPrompt: z.strictObject({ visibleText: z.string().max(512_000), reminders: z.array(z.string()).max(0) }) }).optional(),
  model: z.strictObject({ providerID: z.string().min(1).max(128), id: z.string().min(1).max(200), variant: z.literal("high").optional() }),
  agent: z.literal("legalwork").optional() });
type QueuedInput = { workspaceId: string; sessionId: string; execution: unknown };
type QueuedContext = Pick<Entry, "workspaceId" | "workspaceRoot" | "sources" | "providerId" | "modelId" | "assertCurrent">;
function decodeDirectory(value: string | null) { if (!value) return null; try { return decodeURIComponent(value); } catch { return value; } }
async function uploadedCopyHash(workspaceRoot: string, url: string): Promise<{ path: string; sha256: string }> {
  let path: string;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "file:" || !["", "localhost"].includes(parsed.hostname) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error();
    path = fileURLToPath(parsed);
  } catch { throw new ApiError(403, "protected_attachment_unselected", "Reselect this document in a new protected operation; arbitrary file URLs are unavailable."); }
  const canonical = await realpath(path);
  const suffix = relative(workspaceRoot, canonical).replaceAll("\\", "/");
  const match = /^\.legalwork\/attachments\/([a-f0-9-]{36})\/([^/]+)$/.exec(suffix);
  if (!match || !z.string().uuid().safeParse(match[1]).success) throw new ApiError(403, "protected_attachment_unselected", "Only a newly uploaded copy of an already selected original is available.");
  let cursor = path;
  for (let depth = 0; depth < 4; depth++) { if ((await lstat(cursor)).isSymbolicLink()) throw new ApiError(403, "protected_attachment_unselected", "Attachment aliases are unavailable."); cursor = dirname(cursor); }
  if (await realpath(cursor) !== workspaceRoot) throw new ApiError(403, "protected_attachment_unselected", "Attachment owner changed.");
  path = canonical;
  const file = await open(path, "r");
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > 32 * 1024 * 1024) throw new ApiError(413, "protected_attachment_too_large", "The attachment exceeds the bounded selected-copy check.");
    const digest = createHash("sha256"); let bytes = 0;
    for await (const chunk of file.createReadStream({ autoClose: false, highWaterMark: 64 * 1024 })) { bytes += chunk.length; if (bytes > 32 * 1024 * 1024) throw new ApiError(413, "protected_attachment_too_large", "The attachment changed while reading."); digest.update(chunk); }
    const after = await file.stat(), named = await lstat(path);
    if (bytes !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || named.dev !== after.dev || named.ino !== after.ino || named.isSymbolicLink()) throw new ApiError(409, "protected_attachment_stale", "The uploaded copy changed while reading.");
    return { path: suffix, sha256: digest.digest("hex") };
  } finally { await file.close(); }
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
/** Engine v2 frame `{id, type, location?: {directory}, data: {sessionID, ...}}`. Only frames of
 * this session pass, and only host-owned technical location metadata is projected; text, tool
 * payloads and arbitrary model strings are never searched or substituted. Connection notices
 * and heartbeats of the private guest stream stay private. */
function guestEvent(frame: string): Record<string, unknown> | undefined {
  const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
  if (!data) return undefined;
  try { const value: unknown = JSON.parse(data); return record(value) ? value : undefined; } catch { return undefined; }
}
const ownedEvent = (event: Record<string, unknown>, entry: Pick<Entry, "sessionId" | "directory">) =>
  record(event.data) && event.data.sessionID === entry.sessionId && (event.location === undefined || (record(event.location) && event.location.directory === entry.directory));
function projectEventFrame(event: Record<string, unknown>, entry: Entry): string | undefined {
  if (!ownedEvent(event, entry)) return undefined;
  const location = record(event.location) ? { location: { ...event.location, directory: entry.hostDirectory } } : {};
  const data = record(event.data) && record(event.data.location) && event.data.location.directory === entry.directory
    ? { data: { ...event.data, location: { ...event.data.location, directory: entry.hostDirectory } } } : {};
  return `data: ${JSON.stringify({ ...event, ...location, ...data })}\n\n`;
}
const TERMINAL_EVENTS = new Set(["session.idle", "session.execution.succeeded", "session.execution.failed", "session.execution.interrupted"]);
const terminalEvent = (event: Record<string, unknown>, entry: Pick<Entry, "sessionId" | "directory">) => ownedEvent(event, entry)
  && (TERMINAL_EVENTS.has(String(event.type)) || (event.type === "session.status" && record(event.data) && record(event.data.status) && event.data.status.type === "idle"));
const hostSession = (session: GuestSession, hostDirectory: string) => ({ ...session, location: { ...session.location, directory: hostDirectory } });
const inside = (root: string, path: string) => { const suffix = relative(root, path); return !isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith("../") && !suffix.startsWith("..\\"); };
async function boundedBody(request: Request, maximum: number, ownerSignal: AbortSignal): Promise<string> {
  const reader = request.body?.getReader(); if (!reader) return "";
  const signal = AbortSignal.any([request.signal, ownerSignal]);
  const chunks: Uint8Array[] = []; let count = 0;
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) { signal.throwIfAborted(); const next = await reader.read(); signal.throwIfAborted(); if (next.done) break;
      count += next.value.byteLength; if (count > maximum) throw new ApiError(413, "protected_prompt_too_large", "Narrow the protected prompt."); chunks.push(next.value); }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally { signal.removeEventListener("abort", cancel); try { await reader.cancel(); } finally { reader.releaseLock(); } }
}

const pageCursor = z.strictObject({ offset: z.number().int().min(0).max(10000), order: z.enum(["asc", "desc"]) });
/** Engine v2 message-list paging over captured history (oldest first), with an opaque cursor. */
function historicalPage(messages: Array<Record<string, unknown>>, query: URLSearchParams) {
  const encode = (value: z.infer<typeof pageCursor>) => Buffer.from(JSON.stringify(value)).toString("base64url");
  let cursor: z.infer<typeof pageCursor> | undefined;
  const raw = query.get("cursor");
  if (raw) { try { cursor = pageCursor.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))); } catch { throw new ApiError(400, "protected_cursor_invalid", "The captured history cursor is invalid."); } }
  const order = cursor?.order ?? z.enum(["asc", "desc"]).default("desc").parse(query.get("order") ?? undefined);
  const limit = z.coerce.number().int().min(1).max(10000).parse(query.get("limit") ?? 10000);
  const type = query.get("type");
  const ordered = (order === "asc" ? messages : [...messages].reverse()).filter(message => !type || message.type === type);
  const offset = Math.min(cursor?.offset ?? 0, ordered.length);
  const data = ordered.slice(offset, offset + limit);
  return { data, cursor: { ...(offset > 0 ? { previous: encode({ offset: Math.max(0, offset - limit), order }) } : {}),
    ...(offset + limit < ordered.length ? { next: encode({ offset: offset + limit, order }) } : {}) } };
}

/** One owner for a selected source set, host decision, confined engine and tools.
 * Legacy engine sessions cannot acquire this authority by copying their ID. */
export class ProtectedDocumentRuntime {
  private readonly entries = new Map<string, Entry>();
  private readonly opening = new Set<Promise<unknown>>();
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private closed = false;
  private closing?: Promise<void>;
  private readonly shutdown = new AbortController();
  private initialized?: Promise<void>;
  private readonly restoring = new Map<string, Promise<unknown>>();
  private readonly store: ProtectedSessionStore;
  private readonly ownership: RuntimeOwnership;
  constructor(private readonly options: RuntimeOptions) {
    const ownership = runtimeOwners.get(options.config) ?? { store: new ProtectedSessionStore(join(runtimeStorageDir(options.config), "protected-document-sessions")), claims: new Map<string, SessionClaim>(), known: new Map<string, Set<string>>(), workers: new Set<WorkerSlot>(), admission: Promise.resolve() };
    runtimeOwners.set(options.config, ownership); this.ownership = ownership; this.store = ownership.store;
  }
  private remember(saved: StoredProtectedSession) {
    const known = this.ownership.known.get(saved.workspaceId) ?? new Set<string>(); known.add(saved.sessionId); this.ownership.known.set(saved.workspaceId, known);
  }
  initialize(): Promise<void> { this.initialized ??= (async () => { for (const saved of await this.store.load()) this.remember(saved); })(); return this.initialized; }
  private claim(workspaceId: string, sessionId: string) {
    const key = sessionKey(workspaceId, sessionId), current = this.ownership.claims.get(key);
    if (current) throw new ApiError(409, "protected_session_busy", "Another protected operation already owns this session; wait for its verified shutdown.");
    const claim: SessionClaim = { owner: this }; this.ownership.claims.set(key, claim);
    return claim;
  }
  private release(workspaceId: string, sessionId: string) {
    const key = sessionKey(workspaceId, sessionId); if (this.ownership.claims.get(key)?.owner === this) this.ownership.claims.delete(key);
  }
  private async currentHistory(workspaceId: string, sessionId: string) {
    const saved = await this.store.read(workspaceId, sessionId); if (saved) this.remember(saved); return saved;
  }
  private reserveWorker(signal: AbortSignal): Promise<WorkerSlot> {
    const work = this.ownership.admission.then(async () => {
      signal.throwIfAborted();
      if (this.ownership.workers.size >= 2) {
        for (const worker of this.ownership.workers) {
          if (worker.entry && await worker.owner.evictIdle(worker.entry, signal)) break;
        }
      }
      signal.throwIfAborted();
      if (this.closed) throw new ApiError(409, "protected_runtime_closed", "The protected runtime is stopping.");
      if (this.ownership.workers.size >= 2) throw new ApiError(409, "protected_runtime_capacity", "Both protected workers are active. Wait for a completed operation before opening another.");
      const worker: WorkerSlot = { owner: this }; this.ownership.workers.add(worker); return worker;
    });
    this.ownership.admission = work.then(() => {}, () => {}); return work;
  }
  private async evictIdle(entry: Entry, signal: AbortSignal): Promise<boolean> {
    if (entry.closing || entry.evicting || entry.submitting || entry.busy) return false;
    const revision = entry.activityRevision;
    const budget = AbortSignal.any([signal, entry.controller.signal, AbortSignal.timeout(15000)]);
    let retiring = false;
    entry.evicting = true;
    try {
    // Freeze new SDK admissions, but let every accepted read finish naturally.
    // Guest callbacks remain owned and admissible; their arrival invalidates
    // this probe rather than denying work to manufacture idle capacity.
    await new Promise<void>((resolve, reject) => {
      const abort = () => { budget.removeEventListener("abort", abort); reject(budget.reason); };
      budget.addEventListener("abort", abort, { once: true });
      void Promise.allSettled([...entry.tools]).then(() => { budget.removeEventListener("abort", abort); resolve(); });
      if (budget.aborted) abort();
    });
    const blocked = () => entry.closing || entry.submitting || entry.busy || entry.tools.size || entry.activityRevision !== revision;
    if (blocked()) return false;
    const read = (async () => {
      const response = await entry.engine.fetch(new Request("http://protected/api/session/active", { signal: budget }));
      if (!response.ok) { await response.body?.cancel(); return undefined; }
      return activeEnvelope.parse(await response.json()).data;
    })();
    entry.tools.add(read);
    let active: Awaited<typeof read>; try { active = await read; } finally { entry.tools.delete(read); }
    if (!active) return false;
    // Engine v2 lists only active sessions: idle means absent.
    if (Object.hasOwn(active, entry.sessionId) || blocked()) return false;
    budget.throwIfAborted();
    retiring = true;
    await this.closeEntry(entry.sessionId); return true;
    } catch (error) {
      if (retiring) throw error;
      signal.throwIfAborted();
      if (budget.aborted) return false;
      throw error;
    } finally { entry.evicting = false; }
  }

  open(raw: GenerationInput, signal: AbortSignal) {
    if (this.closed) return Promise.reject(new ApiError(409, "protected_runtime_closed", "The protected document runtime is stopping."));
    const pending = (async () => { await this.initialize(); return this.openOperation(raw, AbortSignal.any([signal, this.shutdown.signal])); })();
    this.opening.add(pending);
    void pending.finally(() => this.opening.delete(pending)).catch(() => {});
    return pending;
  }

  private async currentProfile(input: z.output<typeof protectedGenerationInputSchema>, targetFingerprint: string, operationId: string) {
    const profile = input.profileId ? (await readGovernanceProfiles(this.options.config)).find(item => item.id === input.profileId) : undefined;
    if (input.profileId && (!profile || profile.scope.workspaceId !== input.workspaceId || profile.targetFingerprint !== targetFingerprint || !profile.scope.matterId))
      throw new ApiError(403, "protected_ai_profile_missing", "Select a current host-owned legal profile for this matter and model target.");
    if (profile) {
      const eligibility = await eligibleGovernanceProfiles(this.options.config, { operationId, kind: "chat", scope: profile.scope, targetFingerprint, dataClasses: ["protected"], purpose: "confined-document-processing" });
      if ("allowed" in eligibility) throw new ApiError(403, "ai_transfer_denied", "The legal profile does not admit this protected transmission.", { reason: eligibility.reason });
    }
    return profile;
  }

  private async openOperation(raw: GenerationInput, signal: AbortSignal, recovery?: StoredProtectedSession) {
    const input = protectedGenerationInputSchema.parse(raw), o = this.options;
    signal.throwIfAborted();
    if (o.config.readOnly) throw new ApiError(403, "read_only", "This server is read-only.");
    const registered = o.config.workspaces.find(item => item.id === input.workspaceId && item.workspaceType === "local");
    if (!registered) throw new ApiError(404, "protected_workspace_missing", "Select a registered local project.");
    const workspace = { ...registered };
    const relativeCase = input.caseDirectory.replaceAll("\\", "/");
    if (isAbsolute(input.caseDirectory) || /^[A-Za-z]:|^\//.test(relativeCase) || relativeCase.split("/").some(part => part === ".." || part === "."))
      throw new ApiError(400, "protected_case_directory", "Select a relative project case directory.");
    const rootDirectory = await realpath(workspace.path), hostDirectory = await realpath(join(rootDirectory, relativeCase)), caseInfo = await stat(hostDirectory);
    if (!caseInfo.isDirectory() || !inside(rootDirectory, hostDirectory)) throw new ApiError(403, "protected_case_directory", "The selected case directory is outside this project.");
    const caseIdentity = hash([hostDirectory, caseInfo.dev, caseInfo.ino]);
    const requireCase = async () => {
      const current = await realpath(join(rootDirectory, relativeCase)), info = await stat(current);
      if (hash([current, info.dev, info.ino]) !== caseIdentity || !info.isDirectory()) throw new ApiError(409, "protected_source_stale", "The selected case directory changed.");
    };
    const tools = await ProtectedDocumentTools.open({ documents: o.documents, workspace, sources: input.sources, directory: hostDirectory });
    await requireCase();
    const target = await protectedAiTarget(o.config, input.providerId, input.modelId);
    const operationId = randomUUID();
    const readProfile = () => this.currentProfile(input, target.fingerprint, operationId);
    const profile = await readProfile();
    const synthetic = !profile;
    if (synthetic && !["127.0.0.1", "[::1]"].includes(new URL(target.endpoint).hostname))
      throw new ApiError(403, "protected_ai_profile_missing", "Protected client processing requires a current host-owned matter profile. Synthetic classification is available only for a literal loopback test receiver.");
    // Both jurisdictions here describe a bounded synthetic experiment, never a
    // legal determination inferred from a locale, filename or browser setting.
    const scope: GovernanceScope = profile?.scope ?? { workspaceId: workspace.id, matterId: `synthetic:${operationId}`, jurisdictions: ["CZ", "SK"] };
    const bundle = await o.getGuestBundle({ modelId: input.modelId, operationId, ...(recovery ? { checkpoint: recovery.checkpoint } : {}) });
    const controller = new AbortController();
    const egress = new AbortController();
    const cancel = () => controller.abort(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    let engine: Engine | undefined, createdSessionId: string | undefined, worker: WorkerSlot | undefined;
    const turnUploads = new Map<string, string>();
    try {
      const binding = async () => {
        controller.signal.throwIfAborted();
        egress.signal.throwIfAborted();
        if (o.config.readOnly) throw new ApiError(403, "read_only", "This server is read-only.");
        await requireCase();
        const currentWorkspace = o.config.workspaces.find(item => item.id === workspace.id);
        if (!currentWorkspace || currentWorkspace.path !== workspace.path || currentWorkspace.workspaceType !== "local")
          throw new ApiError(409, "protected_source_stale", "The registered project owner changed.");
        const measured = measurementsSchema.parse(await bundle.currentBinding());
        if (Object.entries(measurementsSchema.parse(bundle.measurements)).some(([key, value]) => Reflect.get(measured, key) !== value))
          throw new ApiError(409, "protected_ai_measurement_missing", "The measured protected runtime changed.");
        return { ...measured, ...await tools.currentBinding(), operationId, target: (await protectedAiTarget(o.config, input.providerId, input.modelId)).fingerprint, profile: await readProfile() ?? null };
      };
      const initial = await binding(), initialHash = hash(initial);
      const assertCurrent = async () => { if (hash(await binding()) !== initialHash) throw new ApiError(409, "host_decision_stale", "The selected sources, project, profile or runtime changed."); };
      let description = `${synthetic ? "Classify all selected prepared content as public/synthetic test material only. Do not allow this operation for client, personal or privileged data. This creates no legal profile or future grant." : `Confirm that this exact selected case directory and every displayed source belong to matter ${scope.matterId} in this host-owned profile. Deny if uncertain. This operation receipt creates no legal profile or future transfer grant.`}\nLegal approval of generated content: false\nProject: ${hostDirectory}\nScope: ${JSON.stringify(scope)}\nTarget: ${target.endpoint}\n`;
      for (const source of input.sources) {
        let offset: number | null = 0;
        description += `\nSelected source ${source.id}, SHA-256 ${source.hash}:\n`;
        while (offset !== null) {
          const part = await o.documents.read(workspace, source.id, offset, 16000);
          description += part.text;
          if (Buffer.byteLength(description) > 4 * 1024 * 1024) throw new ApiError(413, "protected_classification_too_large", "Narrow the source set to complete the bounded native classification.");
          offset = part.nextOffset;
        }
      }
      await assertCurrent();
      const receipt = await createHostDecisionPort(o.approvals, o.config).requestDecision({ workspaceId: workspace.id, operationId,
        action: synthetic ? "ai.documents.synthetic" : "ai.documents.protected", bindingHash: initialHash,
        summary: `${synthetic ? "Public/synthetic test only" : "Current protected matter profile"} → ${target.endpoint}; generated-content legal approval: false`, description,
        readCurrentBindingHash: async () => hash(await binding()) }, controller.signal);
      if (receipt.decision !== "allow") throw new ApiError(403, "protected_ai_denied", "The native host declined the selected document operation.");
      await assertCurrent();
      const transport = new ProtectedAiTransport({ config: o.config, approvals: o.approvals, scope, providerId: input.providerId, modelId: input.modelId,
        readCurrentBinding: async () => {
          const value = await binding(); if (hash(value) !== initialHash) throw new ApiError(409, "host_decision_stale", "The selected operation changed.");
          for (const [path, expected] of turnUploads) if ((await uploadedCopyHash(rootDirectory, pathToFileURL(join(rootDirectory, path)).href)).sha256 !== expected) throw new ApiError(409, "protected_attachment_stale", "The queued uploaded copy changed before transmission.");
          const { target: _target, profile: _profile, ...current } = value; return { ...current, uploadSetSha256: hash([...turnUploads]) };
        },
        ...(synthetic ? { syntheticPilot: { endpoint: target.endpoint } } : {}) });
      const pendingTools = new Set<Promise<unknown>>();
      let issuedSessionId: string | undefined;
      const retain = <T>(work: Promise<T>): Promise<T> => {
        const entry = issuedSessionId ? this.entries.get(issuedSessionId) : undefined;
        if (entry) entry.activityRevision++;
        pendingTools.add(work); void work.finally(() => pendingTools.delete(work)).catch(() => {}); return work;
      };
      worker = await this.reserveWorker(controller.signal);
      engine = await (o.openEngine ?? ProtectedVmEngine.open)({ bundleDirectory: bundle.directory, emptyDirectory: bundle.emptyDirectory, signal: controller.signal,
        handleOutbound: (request, active) => {
          if (!issuedSessionId) throw new ApiError(403, "protected_session_missing", "The protected operation has not issued a session.");
          return retain(transport.dispatch(request, AbortSignal.any([active, controller.signal, egress.signal])));
        },
        handleTool: (request, active) => retain((async () => {
          if (!issuedSessionId || request.sessionId !== issuedSessionId) throw new ApiError(403, "protected_session_missing", "This tool call does not belong to the issued protected session.");
          await assertCurrent();
          controller.signal.throwIfAborted();
          if (request.name === "lawoss_documents_export") {
            const output = z.object({ path: z.string() }).parse(request.arguments);
            if (!inside(hostDirectory, await resolveWorkspaceFilePath(workspace.path, output.path))) throw new ApiError(403, "protected_output_denied", "The output must stay in the selected case directory.");
          }
          return tools.invoke(request.name, request.arguments, AbortSignal.any([active, controller.signal, egress.signal]));
        })()) });
      await assertCurrent();
      const response = await engine.fetch(recovery ? new Request(`http://protected/api/session/${recovery.sessionId}`, { signal: controller.signal })
        : new Request("http://protected/api/session", { method: "POST", headers: { "content-type": "application/json" }, signal: controller.signal,
          body: JSON.stringify({ title: "Protected document operation", agent: "legalwork", model: { providerID: GUEST_PROVIDER, id: input.modelId }, location: { directory: GUEST_DIRECTORY } }) }));
      if (!response.ok) throw new ApiError(502, "protected_session_failed", "The confined engine could not create a session.");
      const session = sessionEnvelope.parse(await response.json()).data;
      if (recovery && session.id !== recovery.sessionId) throw new ApiError(409, "protected_session_identity", "The restored database did not retain the actual session identity.");
      if (session.location.directory !== GUEST_DIRECTORY) throw new ApiError(409, "protected_session_stale", "The confined engine did not use its private scratch directory.");
      if (this.closed) throw new ApiError(409, "protected_runtime_closed", "The protected runtime is stopping.");
      if (this.entries.has(session.id)) throw new ApiError(409, "protected_session_identity", "The confined session identity is already owned.");
      if (!recovery) { this.claim(workspace.id, session.id); createdSessionId = session.id; }
      issuedSessionId = session.id;
      const timer = setTimeout(() => { void this.closeEntry(session.id).catch(() => {}); }, 600_000); timer.unref?.();
      const entry: Entry = { workspaceId: workspace.id, sessionId: session.id, directory: session.location.directory, hostDirectory, workspaceRoot: rootDirectory, sources: input.sources, turnUploads, providerId: input.providerId, modelId: input.modelId, operationId, engine, bundle, controller, egress, timer, assertCurrent, tools: pendingTools, input, initialSourceSetSha256: initial.sourceSetSha256, rootIdentity: initial.rootIdentity, activityRevision: 0, worker };
      worker.entry = entry;
      this.entries.set(session.id, entry);
      entry.events = this.pumpEvents(entry);
      void entry.events.catch(() => {});
      return { session: hostSession(session, hostDirectory), directoryMapping: { guestDirectory: session.location.directory, hostDirectory, rootIdentity: initial.rootIdentity }, operationId, legalApproval: false as const };
    } catch (error) {
      controller.abort(error);
      try { try { await engine?.stop(); } finally { await bundle.dispose?.(); } }
      catch (cleanupError) { const id = recovery?.sessionId ?? createdSessionId, claim = id ? this.ownership.claims.get(sessionKey(workspace.id, id)) : undefined; if (claim?.owner === this) claim.failed = true; throw cleanupError; }
      if (createdSessionId) this.release(workspace.id, createdSessionId);
      if (worker) this.ownership.workers.delete(worker);
      throw error;
    } finally { signal.removeEventListener("abort", cancel); }
  }

  ownsSession(workspaceId: string, sessionId: string) { return !this.closed && (this.entries.get(sessionId)?.workspaceId === workspaceId || this.ownership.known.get(workspaceId)?.has(sessionId) === true); }
  sessionIds(workspaceId: string) { return this.closed ? [] : [...new Set([...this.entries.values()].filter(entry => entry.workspaceId === workspaceId).map(entry => entry.sessionId).concat([...this.ownership.known.get(workspaceId) ?? []]))].filter(id => { const owner = activeProtectedRuntime(this.options.config, workspaceId, id); return !owner || owner === this; }); }
  private entry(workspaceId: string, sessionId: string) {
    const entry = this.entries.get(sessionId);
    if (!entry || entry.closing || entry.workspaceId !== workspaceId) throw new ApiError(404, "protected_session_missing", "This project does not own that protected session.");
    if (entry.evicting) throw new ApiError(409, "protected_session_busy", "The protected worker is draining accepted reads before an idle checkpoint.");
    return entry;
  }

  /** Validate a durable intent on the host; this grants no model transfer or VM. */
  admitQueued(input: QueuedInput): Promise<GuestPrompt> {
    const work = this.admitQueuedOwned(input); this.opening.add(work);
    void work.finally(() => this.opening.delete(work)).catch(() => {}); return work;
  }
  private async admitQueuedOwned(input: QueuedInput): Promise<GuestPrompt> {
    if (this.closed) throw new ApiError(409, "protected_runtime_closed", "The protected runtime is stopping.");
    if (this.options.config.readOnly) throw new ApiError(403, "read_only", "This server is read-only.");
    await this.initialize();
    const owner = activeProtectedRuntime(this.options.config, input.workspaceId, input.sessionId);
    if (owner && owner !== this) throw new ApiError(409, "protected_session_busy", "Another protected operation owns this session.");
    if (this.entries.has(input.sessionId)) {
      const entry = this.entry(input.workspaceId, input.sessionId);
      const work = this.normalizeQueued(entry, input.execution); entry.tools.add(work);
      try { return (await work).payload; } finally { entry.tools.delete(work); }
    }
    const saved = await this.currentHistory(input.workspaceId, input.sessionId);
    if (!saved) throw new ApiError(404, "protected_session_missing", "The captured protected session is unavailable.");
    const captured = hash(saved);
    const binding = async () => {
      if (this.closed) throw new ApiError(409, "protected_runtime_closed", "The protected runtime is stopping.");
      if (this.options.config.readOnly) throw new ApiError(403, "read_only", "This server is read-only.");
      const currentOwner = activeProtectedRuntime(this.options.config, input.workspaceId, input.sessionId);
      if (currentOwner && currentOwner !== this) throw new ApiError(409, "protected_session_busy", "Another protected operation owns this session.");
      const current = await this.currentHistory(input.workspaceId, input.sessionId);
      if (!current || hash(current) !== captured) throw new ApiError(409, "protected_source_stale", "The captured protected operation changed.");
      const mapping = await this.validateHistorical(current);
      if (mapping.sourceSetSha256 !== current.sourceSetSha256) throw new ApiError(409, "protected_source_stale", "The captured prepared evidence changed.");
      const target = await protectedAiTarget(this.options.config, current.input.providerId, current.input.modelId);
      const profile = await this.currentProfile(current.input, target.fingerprint, current.operationId);
      if (!profile && !["127.0.0.1", "[::1]"].includes(new URL(target.endpoint).hostname))
        throw new ApiError(403, "protected_ai_profile_missing", "Protected client processing requires a current host-owned matter profile.");
      return {...mapping, target: target.fingerprint, profile: profile ?? null};
    };
    const initial = await binding(), initialHash = hash(initial);
    const context: QueuedContext = {workspaceId: saved.workspaceId, workspaceRoot: initial.workspaceRoot, sources: saved.input.sources,
      providerId: saved.input.providerId, modelId: saved.input.modelId,
      assertCurrent: async () => {if (hash(await binding()) !== initialHash) throw new ApiError(409, "host_decision_stale", "The queued operation changed during host admission.");}};
    return (await this.normalizeQueued(context, input.execution)).payload;
  }

  /** Background delivery alone reauthorizes and provisions a captured worker. */
  async preflightQueued(input: QueuedInput): Promise<GuestPrompt> {
    await this.reactivate(input.workspaceId, input.sessionId, AbortSignal.timeout(600_000));
    const entry = this.entry(input.workspaceId, input.sessionId);
    const work = this.normalizeQueued(entry, input.execution); entry.tools.add(work);
    try { return (await work).payload; } finally { entry.tools.delete(work); }
  }
  private async normalizeQueued(entry: QueuedContext, execution: unknown): Promise<{ payload: GuestPrompt; uploads: Array<{ path: string; sha256: string }> }> {
    await entry.assertCurrent();
    const parsed = queueExecutionSchema.safeParse(execution);
    if (!parsed.success || parsed.data.model.providerID !== entry.providerId || parsed.data.model.id !== entry.modelId
      || (parsed.data.metadata && parsed.data.metadata.legalworkPrompt.visibleText !== parsed.data.text)) throw new ApiError(403, "protected_prompt_invalid", "This document session accepts only the selected model, text and copies of its selected originals.");
    const workspace = this.options.config.workspaces.find(item => item.id === entry.workspaceId);
    if (!workspace) throw new ApiError(404, "protected_workspace_missing", "The selected project no longer exists.");
    const blocks: string[] = parsed.data.text ? [parsed.data.text] : [];
    const uploads: Array<{ path: string; sha256: string }> = [];
    for (const file of parsed.data.files ?? []) {
      const uploaded = await uploadedCopyHash(entry.workspaceRoot, file.uri);
      uploads.push(uploaded);
      const selected = [];
      for (const source of entry.sources) {
        if (source.hash !== uploaded.sha256) continue;
        const evidence = await this.options.documents.evidence(workspace, source.id);
        if (!evidence.provenance.parentId) selected.push(evidence);
      }
      const original = selected[0];
      if (!original) throw new ApiError(403, "protected_attachment_unselected", "Reselect this changed or new document in a new protected operation.");
      let text = "", offset: number | null = 0;
      while (offset !== null) {
        const read = await this.options.documents.read(workspace, original.id, offset, 16000); text += read.text; offset = read.nextOffset;
        if (Buffer.byteLength(text) > 512_000) throw new ApiError(413, "protected_attachment_too_large", "Narrow this selected document before attaching it.");
      }
      blocks.push(JSON.stringify({ untrustedSelectedDocument: true, documentId: original.id, originalPath: original.provenance.sourcePath, sha256: original.hash, uploadedCopyPath: uploaded.path, text }));
    }
    if (!blocks.length) throw new ApiError(403, "protected_prompt_invalid", "This document session accepts only the selected model, text and copies of its selected originals.");
    const normalized = promptSchema.parse({ text: blocks.join("\n\n"), ...(parsed.data.model.variant ? { variant: parsed.data.model.variant } : {}) });
    if (Buffer.byteLength(JSON.stringify(normalized)) > 2 * 1024 * 1024) throw new ApiError(413, "protected_prompt_too_large", "Narrow the protected queued message.");
    await entry.assertCurrent(); return { payload: normalized, uploads };
  }
  /** Deliver one normalized turn to the actual guest session and return its terminal receipt.
   * Engine v2 admits asynchronously; the turn is terminal only once the guest's own history
   * records an idle outcome after this exact user message. */
  async submitQueued(input: QueuedInput & { id: string }, signal: AbortSignal = AbortSignal.timeout(600_000)): Promise<ProtectedTurnResult> {
    const id = z.string().uuid().parse(input.id);
    await this.reactivate(input.workspaceId, input.sessionId, signal);
    const entry = this.entry(input.workspaceId, input.sessionId);
    if (entry.submitting) throw new ApiError(409, "protected_session_busy", "The protected queued turn is still being delivered.");
    entry.submitting = true;
    try {
      const work = this.normalizeQueued(entry, input.execution); entry.tools.add(work);
      let normalized: Awaited<typeof work>; try { normalized = await work; } finally { entry.tools.delete(work); }
      entry.turnUploads.clear(); for (const uploaded of normalized.uploads) entry.turnUploads.set(uploaded.path, uploaded.sha256);
      // Revalidation occurs here as well as admission: a persisted queue is never
      // a portable transfer grant, and a copied upload cannot select new content.
      const delivery = this.deliver(entry, normalized.payload, `msg_${id.replaceAll("-", "")}`, signal); entry.tools.add(delivery);
      try { return await delivery; } finally { entry.tools.delete(delivery); }
    } finally { entry.submitting = false; }
  }
  private async deliver(entry: Entry, payload: GuestPrompt, messageID: string, caller: AbortSignal): Promise<ProtectedTurnResult> {
    await entry.snapshotting;
    await entry.assertCurrent();
    const signal = AbortSignal.any([caller, entry.controller.signal, entry.egress.signal]);
    const guest = async (path: string, init: { method?: string; body?: unknown } = {}) => {
      const response = await entry.engine.fetch(new Request(`http://protected/api${path}`, { method: init.method ?? "GET", signal,
        ...(init.body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }) }));
      if (!response.ok) { await response.body?.cancel(); throw new ApiError(502, "protected_queue_delivery", "The confined engine refused this protected turn."); }
      return response;
    };
    const session = `/session/${entry.sessionId}`;
    // The original selected provider account is host-only. The guest sees one fixed
    // provider with no credential and no arbitrary destination.
    await (await guest(`${session}/model`, { method: "POST", body: { model: { providerID: GUEST_PROVIDER, id: entry.modelId, ...(payload.variant ? { variant: payload.variant } : {}) } } })).body?.cancel();
    entry.busy = true; entry.activityRevision++;
    const admitted = z.object({ data: z.object({ id: z.string() }).passthrough() }).safeParse(await (await guest(`${session}/prompt`, { method: "POST", body: { id: messageID, text: payload.text, delivery: "queue" } })).json());
    if (!admitted.success || admitted.data.data.id !== messageID) throw new ApiError(502, "protected_queue_delivery", "The protected engine admitted a different message.");
    await (await guest(`/experimental${session}/wait`, { method: "POST" })).body?.cancel();
    const history = await this.readMessages(entry.engine, entry.sessionId, signal);
    const start = history.findIndex(message => message.id === messageID && message.type === "user");
    const turn = start < 0 ? [] : history.slice(start + 1);
    const end = turn.findIndex(message => message.type === "user");
    const own = end < 0 ? turn : turn.slice(0, end);
    const idle = own.find(message => message.type === "idle");
    const outcome = idle && ["succeeded", "failed", "interrupted"].includes(String(idle.outcome)) ? idle.outcome as ProtectedTurnResult["outcome"] : undefined;
    const assistant = [...own].reverse().find(message => message.type === "assistant") ?? null;
    if (!outcome) throw new ApiError(502, "protected_queue_delivery", "The protected engine did not record this chat's terminal result.");
    if (outcome === "succeeded" && (!assistant || assistant.finish === "tool-calls" || !record(assistant.time) || typeof assistant.time.completed !== "number"))
      throw new ApiError(502, "protected_queue_delivery", "The protected assistant response is not terminal.");
    return { messageID, outcome, assistant };
  }
  /** Every page of the actual guest history, oldest first, within the bridge bounds. */
  private async readMessages(engine: Engine, sessionId: string, signal: AbortSignal): Promise<Array<z.infer<typeof messageRecordSchema>>> {
    const messages: Array<z.infer<typeof messageRecordSchema>> = []; const seen = new Set<string>();
    let query = "order=asc&limit=200";
    for (let page = 0; page < 50; page++) {
      const response = await engine.fetch(new Request(`http://protected/api/session/${sessionId}/message?${query}`, { signal }));
      if (!response.ok) { await response.body?.cancel(); throw new ApiError(502, "protected_checkpoint_failed", "The actual protected engine history could not be read."); }
      const parsed = messagesEnvelope.parse(await response.json());
      messages.push(...parsed.data);
      if (messages.length > 10000) throw new ApiError(413, "protected_checkpoint_too_large", "The protected history exceeds its bound.");
      const next = parsed.cursor.next;
      if (!next || !parsed.data.length) return messages;
      if (seen.has(next)) throw new ApiError(502, "protected_checkpoint_failed", "The protected engine repeated a history cursor.");
      seen.add(next); query = `cursor=${encodeURIComponent(next)}&limit=200`;
    }
    throw new ApiError(413, "protected_checkpoint_too_large", "The protected history exceeds its bound.");
  }

  proxy(input: { workspaceId: string; sessionId: string; request: Request }): Promise<Response> {
    const work = this.dispatchProxy(input); this.opening.add(work);
    void work.finally(() => this.opening.delete(work)).catch(() => {}); return work;
  }
  private async dispatchProxy({ workspaceId, sessionId, request }: { workspaceId: string; sessionId: string; request: Request }): Promise<Response> {
    if (this.closed) throw new ApiError(409, "protected_runtime_closed", "The protected runtime is stopping.");
    const owner = activeProtectedRuntime(this.options.config, workspaceId, sessionId);
    if (owner && owner !== this) return owner.proxy({ workspaceId, sessionId, request });
    const live = this.entries.get(sessionId);
    if (live?.workspaceId === workspaceId && request.method === "GET" && new URL(request.url).pathname.endsWith("/protected-transport") && await this.authorizedMove(workspaceId, live.workspaceRoot)) await this.closeEntry(sessionId);
    const saved = this.entries.has(sessionId) ? undefined : await this.currentHistory(workspaceId, sessionId);
    const currentOwner = activeProtectedRuntime(this.options.config, workspaceId, sessionId);
    if (currentOwner && currentOwner !== this) return currentOwner.proxy({ workspaceId, sessionId, request });
    if (!this.entries.has(sessionId) && saved?.workspaceId === workspaceId) {
      // A captured history grants no execution: only its queue may reauthorize and restore it.
      const work = this.historicalResponse(saved, request); this.opening.add(work);
      try { return await work; } finally { this.opening.delete(work); }
    }
    const entry = this.entry(workspaceId, sessionId);
    const work = this.proxyOwned(entry, sessionId, request); entry.tools.add(work);
    try { return await work; } finally { entry.tools.delete(work); }
  }
  /** Validate an SDK request's suffix, query and location against this session. Engine v2
   * session routes need no location; a supplied one must name the selected case directory
   * (reads may also name the registered project root). */
  private async sdkRoute(request: Request, sessionId: string, mapping: { hostDirectory: string; workspaceRoot: string }) {
    const url = new URL(request.url), path = url.pathname.replace(/^\/api(?=\/)/, "");
    if (!path.startsWith(`/session/${sessionId}`)) throw new ApiError(403, "protected_route_denied", "This route is outside the selected document operation.");
    const suffix = path.slice(`/session/${sessionId}`.length);
    if (!/^(?:|\/message(?:\/msg_[A-Za-z0-9]{1,128})?|\/context|\/inbox|\/permission|\/form|\/interrupt|\/prompt|\/protected-transport)$/.test(suffix))
      throw new ApiError(403, "protected_route_denied", "This route is outside the selected document operation.");
    for (const [key] of url.searchParams) if (!["location[directory]", "directory", "limit", "order", "cursor", "type"].includes(key)) throw new ApiError(403, "protected_route_denied", "Unsupported protected engine query.");
    for (const directory of [...url.searchParams.getAll("location[directory]"), ...url.searchParams.getAll("directory"), decodeDirectory(request.headers.get("x-opencode-directory"))]) {
      if (!directory) continue;
      const physical = await realpath(directory).catch(() => "");
      if (physical !== mapping.hostDirectory && !(request.method === "GET" && physical === mapping.workspaceRoot)) throw new ApiError(403, "protected_source_scope", "The SDK request does not belong to the selected case directory.");
    }
    const query = new URLSearchParams();
    for (const key of ["limit", "order", "cursor", "type"]) { const value = url.searchParams.get(key); if (value !== null) query.set(key, value); }
    return { suffix, query };
  }
  private async proxyOwned(entry: Entry, sessionId: string, request: Request): Promise<Response> {
    await entry.assertCurrent();
    const { suffix, query } = await this.sdkRoute(request, sessionId, entry);
    if (request.method === "GET" && suffix === "/protected-transport") return Response.json({ sessionId: entry.sessionId, operationId: entry.operationId, directoryMapping: { guestDirectory: entry.directory, hostDirectory: entry.hostDirectory, rootIdentity: entry.rootIdentity }, runtimeState: "ready", transport: "protected-documents-v1", legalApproval: false });
    // Pending permission and form requests cannot exist: the guest rules only allow or deny.
    if (request.method === "GET" && (suffix === "/permission" || suffix === "/form")) return Response.json({ data: [] });
    const signal = AbortSignal.any([request.signal, entry.controller.signal, entry.egress.signal]);
    if (request.method === "POST" && suffix === "/interrupt") {
      // A plain stop only: `resume` would continue pending work outside a queued delivery.
      if (new URL(request.url).searchParams.has("resume")) throw new ApiError(403, "protected_route_denied", "Only stopping this protected operation is available.");
      await boundedBody(request, 1024, AbortSignal.any([entry.controller.signal, entry.egress.signal]));
      return entry.engine.fetch(new Request(`http://protected/api/session/${sessionId}/interrupt`, { method: "POST", signal }));
    }
    if (request.method === "PATCH" && suffix === "") {
      let value: unknown; try { value = JSON.parse(await boundedBody(request, 1024, AbortSignal.any([entry.controller.signal, entry.egress.signal]))); } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, "protected_prompt_invalid", "Provide valid bounded metadata JSON."); }
      // The SDK unarchives before a prompt; this live session is never archived.
      if (!z.strictObject({ archived: z.literal(false) }).safeParse(value).success) throw new ApiError(403, "protected_route_denied", "Only the SDK's exact unarchive metadata update is available.");
      return new Response(null, { status: 204 });
    }
    if (request.method === "POST" && suffix === "/prompt")
      throw new ApiError(409, "protected_session_dispatch", "Send messages in this protected document chat through its message queue.");
    if (request.method !== "GET" || suffix === "/interrupt") throw new ApiError(403, "protected_route_denied", "Unsupported protected engine method.");
    const target = new URL(`http://protected/api/session/${sessionId}${suffix}`);
    if (suffix === "/message") target.search = query.toString();
    const response = await entry.engine.fetch(new Request(target, { headers: { accept: request.headers.get("accept") ?? "application/json" }, signal }));
    if (suffix === "" && response.ok) {
      const session = sessionEnvelope.parse(await response.json()).data;
      if (session.id !== sessionId || session.location.directory !== entry.directory) throw new ApiError(409, "protected_session_stale", "The confined session directory changed.");
      return Response.json({ data: hostSession(session, entry.hostDirectory) });
    }
    // SDK reads are finite JSON under the VM bridge's existing 16 MiB bound.
    // Keep ownership through EOF so eviction cannot abort an accepted body.
    const bytes = await response.arrayBuffer();
    return new Response([204, 205, 304].includes(response.status) ? null : bytes, { status: response.status, headers: response.headers });
  }

  workspaceStatus(workspaceId: string, request: Request): Promise<Response> {
    if (this.closed) return Promise.reject(new ApiError(409, "protected_runtime_closed", "The protected runtime is stopping."));
    const work = this.readWorkspaceStatus(workspaceId, request); this.opening.add(work);
    void work.finally(() => this.opening.delete(work)).catch(() => {}); return work;
  }
  /** Engine v2 `session.active` shape: only active protected sessions are listed. */
  private async readWorkspaceStatus(workspaceId: string, request: Request): Promise<Response> {
    const statuses: Record<string, unknown> = {};
    for (const id of this.sessionIds(workspaceId)) {
      const history = this.entries.has(id) ? undefined : await this.currentHistory(workspaceId, id);
      if (activeProtectedRuntime(this.options.config, workspaceId, id) && activeProtectedRuntime(this.options.config, workspaceId, id) !== this) continue;
      // A captured history is idle by construction: it was checkpointed only while idle.
      if (!this.entries.has(id) && history) { await this.validateHistorical(history); continue; }
      const entry = this.entry(workspaceId, id);
      const work = (async () => {
        await entry.assertCurrent();
        const response = await entry.engine.fetch(new Request("http://protected/api/session/active", { signal: AbortSignal.any([request.signal, entry.controller.signal, entry.egress.signal]) }));
        if (!response.ok) throw new ApiError(502, "protected_status_unavailable", "The confined engine status is unavailable.");
        const active = activeEnvelope.parse(await response.json()).data;
        if (Object.hasOwn(active, id)) statuses[id] = active[id];
      })();
      entry.tools.add(work); try { await work; } finally { entry.tools.delete(work); }
    }
    return Response.json({ data: statuses });
  }

  events(workspaceId: string, signal: AbortSignal): Response {
    let subscriber: Subscriber;
    const close = () => { if (!subscriber) return; signal.removeEventListener("abort", close); this.subscribers.get(workspaceId)?.delete(subscriber); try { subscriber.controller.close(); } catch {} };
    const body = new ReadableStream<Uint8Array>({ start: controller => {
      subscriber = { controller, close };
      const subscribers = this.subscribers.get(workspaceId) ?? new Set<Subscriber>(); this.subscribers.set(workspaceId, subscribers); subscribers.add(subscriber);
      signal.addEventListener("abort", close, { once: true }); if (signal.aborted || this.closed) close();
    }, cancel: close }, { highWaterMark: 4 * 1024 * 1024, size: chunk => chunk?.byteLength ?? 0 });
    return new Response(body, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } });
  }
  private async pumpEvents(entry: Entry) {
    try {
      const response = await entry.engine.fetch(new Request(`http://protected/api/event?location%5Bdirectory%5D=${encodeURIComponent(entry.directory)}`, { signal: entry.controller.signal }));
      if (!response.ok || !response.body) throw new Error("Protected engine events unavailable");
      const decoder = new TextDecoder("utf-8", { fatal: true }), encoder = new TextEncoder(); let buffered = "";
      for await (const chunk of response.body) {
        buffered += decoder.decode(chunk, { stream: true });
        if (Buffer.byteLength(buffered) > 4 * 1024 * 1024) throw new Error("Protected engine event frame is too large");
        for (;;) {
          const boundary = /\r?\n\r?\n/.exec(buffered); if (!boundary) break;
          const end = boundary.index + boundary[0].length, event = guestEvent(buffered.slice(0, end)); buffered = buffered.slice(end);
          if (!event) continue;
          const projected = projectEventFrame(event, entry);
          if (projected) {
            // Multiplex complete real frames: byte chunks from separate workers
            // must never interleave halfway through another session's JSON.
            const frame = encoder.encode(projected);
            for (const subscriber of this.subscribers.get(entry.workspaceId) ?? []) {
              if ((subscriber.controller.desiredSize ?? 0) < frame.byteLength) subscriber.close(); else subscriber.controller.enqueue(frame);
            }
          }
          // Only this session's own terminal event clears its busy latch; eviction
          // independently rechecks actual idle status before closing anything.
          if (!entry.closing && terminalEvent(event, entry)) { entry.busy = false; void this.persistEntry(entry).catch(() => {}); }
        }
      }
      if (!entry.controller.signal.aborted) throw new Error("Protected engine event stream ended");
    } catch (error) { if (!entry.controller.signal.aborted) await this.closeEntry(entry.sessionId, error); }
  }

  private async validateHistorical(saved: StoredProtectedSession) {
    const workspace = this.options.config.workspaces.find(item => item.id === saved.workspaceId && item.workspaceType === "local");
    if (!workspace) throw new ApiError(404, "protected_workspace_missing", "The historical project is no longer registered.");
    const workspaceRoot = await realpath(workspace.path), hostDirectory = await realpath(join(workspaceRoot, saved.input.caseDirectory));
    if (!inside(workspaceRoot, hostDirectory)) throw new ApiError(403, "protected_source_scope", "The historical case is outside its current registered project.");
    const moved = workspaceRoot !== saved.workspaceRoot;
    if (moved && !await this.authorizedMove(saved.workspaceId, saved.workspaceRoot)) throw new ApiError(409, "protected_source_stale", "Reconnect this historical project through the native host before restoring it.");
    const tools = await ProtectedDocumentTools.open({ documents: this.options.documents, workspace, sources: saved.input.sources, directory: hostDirectory });
    const binding = await tools.currentBinding();
    if (!moved && binding.rootIdentity !== saved.rootIdentity) throw new ApiError(409, "protected_source_stale", "The historical project root was replaced.");
    return { workspaceRoot, hostDirectory, rootIdentity: binding.rootIdentity, sourceSetSha256: binding.sourceSetSha256 };
  }

  private async historicalResponse(saved: StoredProtectedSession, request: Request): Promise<Response> {
    const mapping = await this.validateHistorical(saved);
    const { suffix, query } = await this.sdkRoute(request, saved.sessionId, mapping);
    const session = sessionSchema.parse(saved.session);
    if (request.method === "PATCH" && suffix === "") {
      const body: unknown = JSON.parse(await boundedBody(request, 1024, this.shutdown.signal));
      if (!z.strictObject({ archived: z.literal(false) }).safeParse(body).success || (record(saved.session.time) && Boolean(saved.session.time.archived))) throw new ApiError(403, "protected_route_denied", "Reauthorize this historical operation before changing it.");
      return new Response(null, { status: 204 });
    }
    // Captured sessions were checkpointed only while idle: there is nothing to stop.
    if (request.method === "POST" && suffix === "/interrupt" && !new URL(request.url).searchParams.has("resume")) return Response.json({ interrupted: false });
    if (request.method === "POST" && suffix === "/prompt") throw new ApiError(409, "protected_session_dispatch", "Send messages in this protected document chat through its message queue.");
    if (request.method !== "GET") throw new ApiError(403, "protected_route_denied", "Historical data grants no new model operation.");
    if (suffix === "") return Response.json({ data: hostSession(session, mapping.hostDirectory) });
    if (suffix === "/protected-transport") return Response.json({ sessionId: saved.sessionId, operationId: saved.operationId, directoryMapping: { guestDirectory: saved.guestDirectory, hostDirectory: mapping.hostDirectory, rootIdentity: mapping.rootIdentity }, runtimeState: this.restoring.has(saved.sessionId) ? "restoring" : "captured", transport: "protected-documents-v1", legalApproval: false });
    if (suffix === "/permission" || suffix === "/form" || suffix === "/inbox") return Response.json({ data: [] });
    // Captured history holds no compaction (the guest disables it): the context is every message.
    if (suffix === "/context") return Response.json({ data: saved.messages });
    if (suffix === "/message") return Response.json(historicalPage(saved.messages, query));
    const messageId = /^\/message\/(msg_[A-Za-z0-9]{1,128})$/.exec(suffix)?.[1];
    const message = messageId && saved.messages.find(item => item.id === messageId);
    if (message) return Response.json({ data: message });
    throw new ApiError(404, "protected_route_denied", "The requested captured engine resource is unavailable.");
  }

  private async reactivate(workspaceId: string, sessionId: string, signal: AbortSignal): Promise<void> {
    if (this.closed) throw new ApiError(409, "protected_runtime_closed", "The protected runtime is stopping.");
    await this.initialize();
    if (this.closed) throw new ApiError(409, "protected_runtime_closed", "The protected runtime is stopping.");
    const live = this.entries.get(sessionId);
    if (live) { if (await this.authorizedMove(workspaceId, live.workspaceRoot)) await this.closeEntry(sessionId); else return; }
    let pending = this.restoring.get(sessionId);
    if (!pending) {
      // Claim before any source read, approval or bundle provisioning. Neither a
      // second listener nor a queued retry may restore this database in parallel.
      const claim = this.claim(workspaceId, sessionId);
      pending = (async () => {
        try {
          const saved = await this.currentHistory(workspaceId, sessionId);
          if (!saved) throw new ApiError(404, "protected_session_missing", "The captured protected session is unavailable.");
          await this.validateHistorical(saved);
          await this.openOperation(saved.input, AbortSignal.any([signal, this.shutdown.signal]), saved);
        } catch (error) { if (!claim.failed) this.release(workspaceId, sessionId); throw error; }
      })();
      const owned = pending;
      this.restoring.set(sessionId, owned); this.opening.add(owned);
      void owned.finally(() => { this.restoring.delete(sessionId); this.opening.delete(owned); }).catch(() => {});
    }
    await pending;
  }

  private async authorizedMove(workspaceId: string, formerRoot: string): Promise<boolean> {
    const workspace = this.options.config.workspaces.find(item => item.id === workspaceId && item.workspaceType === "local");
    if (!workspace || await realpath(workspace.path) === formerRoot) return false;
    // Historical roots identify the former owner only. All actual source reads
    // and the next native decision use the current registered physical root.
    for (const previous of workspace.previousPaths ?? []) if (await canonicalFilePath(previous) === formerRoot) return true;
    return false;
  }

  private persistEntry(entry: Entry): Promise<void> {
    entry.snapshotting ??= (async () => {
      const signal = AbortSignal.timeout(30_000);
      const read = async (path: string) => {
        const response = await entry.engine.fetch(new Request(`http://protected${path}`, { signal }));
        if (!response.ok) { await response.body?.cancel(); throw new ApiError(502, "protected_checkpoint_failed", "The actual protected engine state could not be captured."); }
        return response;
      };
      // Engine v2 lists only active sessions: the captured one must be absent.
      const active = activeEnvelope.parse(await (await read("/api/session/active")).json()).data;
      if (Object.hasOwn(active, entry.sessionId)) throw new ApiError(409, "protected_checkpoint_busy", "Only an actual idle session may be captured.");
      const checkpoint = await read("/_protected/checkpoint"), expected = checkpoint.headers.get("x-protected-sha256");
      const chunks: Uint8Array[] = []; let bytes = 0;
      if (!checkpoint.body) throw new ApiError(502, "protected_checkpoint_failed", "The actual engine checkpoint is empty.");
      const reader = checkpoint.body.getReader();
      try {
        for (;;) { signal.throwIfAborted(); const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > MAX_PROTECTED_CHECKPOINT) throw new ApiError(413, "protected_checkpoint_too_large", "The checkpoint exceeds the verified capacity."); chunks.push(next.value); }
      } finally { try { await reader.cancel(); } finally { reader.releaseLock(); } }
      const database = Buffer.concat(chunks);
      if (!expected || createHash("sha256").update(database).digest("hex") !== expected) throw new ApiError(409, "protected_checkpoint_invalid", "The actual engine checkpoint hash does not match.");
      const session = sessionEnvelope.parse(await (await read(`/api/session/${entry.sessionId}`)).json()).data;
      if (session.id !== entry.sessionId || session.location.directory !== GUEST_DIRECTORY) throw new ApiError(409, "protected_session_stale", "The confined session directory changed.");
      const messages = await this.readMessages(entry.engine, entry.sessionId, signal);
      // Engine v2 has no children/todo endpoints; actual IDs stay in the guest history.
      const saved = await this.store.save({ version: 2, workspaceId: entry.workspaceId, sessionId: entry.sessionId, operationId: entry.operationId, input: entry.input, rootIdentity: entry.rootIdentity,
        sourceSetSha256: entry.initialSourceSetSha256, hostDirectory: entry.hostDirectory, workspaceRoot: entry.workspaceRoot, guestDirectory: GUEST_DIRECTORY,
        capturedAt: new Date().toISOString(), session, messages, children: [], todo: [], statuses: {} }, database);
      this.remember(saved);
    })().finally(() => { entry.snapshotting = undefined; });
    return entry.snapshotting;
  }

  private closeEntry(id: string, reason?: unknown): Promise<void> {
    const entry = this.entries.get(id); if (!entry) return Promise.resolve();
    entry.closing ??= (async () => {
      clearTimeout(entry.timer); entry.egress.abort(reason);
      let primary: unknown;
      try {
        const stopped = await entry.engine.fetch(new Request(`http://protected/api/session/${entry.sessionId}/interrupt`, { method: "POST", signal: AbortSignal.timeout(15000) })); await stopped.body?.cancel();
      } catch (error) { primary = error; }
      // Losing the engine must never skip accepted host writes or validation
      // readers. Their stores stay owned until every retained callback settles.
      await Promise.allSettled([...entry.tools]);
      try { await entry.snapshotting?.catch(() => {}); await this.persistEntry(entry); } catch (error) { primary ??= error; }
      entry.controller.abort(reason);
      try { await entry.engine.stop(); } catch (error) { primary ??= error; }
      try { await entry.bundle.dispose?.(); } catch (error) { primary ??= error; }
      if (primary) throw primary;
      this.entries.delete(id);
      this.release(entry.workspaceId, id);
      this.ownership.workers.delete(entry.worker);
    })();
    return entry.closing;
  }
  close(): Promise<void> {
    this.closing ??= (async () => {
      this.closed = true;
      this.shutdown.abort(new Error("Protected runtime stopping"));
      for (const entry of this.entries.values()) entry.egress.abort(new Error("Protected runtime stopping"));
      await Promise.allSettled([...this.opening]);
      const results = await Promise.allSettled([...this.entries.keys()].map(id => this.closeEntry(id)));
      for (const subscribers of this.subscribers.values()) for (const subscriber of subscribers) subscriber.close();
      this.subscribers.clear();
      const failed = results.find(result => result.status === "rejected"); if (failed?.status === "rejected") throw failed.reason;
    })();
    return this.closing;
  }
}
