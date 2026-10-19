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
const sessionSchema = z.object({ id: z.string().min(1).max(256), directory: z.string().min(1) }).passthrough();
const GUEST_DIRECTORY = "/tmp/home/protected-engine/workspace";
const promptSchema = z.strictObject({
  parts: z.array(z.strictObject({ type: z.literal("text"), text: z.string().min(1).max(512_000), id: z.string().min(1).max(128).optional() })).min(1).max(8),
  model: z.strictObject({ providerID: z.string().min(1).max(128), modelID: z.string().min(1).max(200) }),
  agent: z.literal("legalwork").optional(), variant: z.literal("high").optional(), messageID: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/).optional(),
});
type Entry = { workspaceId: string; sessionId: string; directory: string; hostDirectory: string; operationId: string;
  workspaceRoot: string; sources: Array<{ id: string; hash: string }>;
  turnUploads: Map<string, string>; submitting?: boolean; busy?: boolean; worker: WorkerSlot;
  input: z.output<typeof protectedGenerationInputSchema>; initialSourceSetSha256: string; rootIdentity: string; egress: AbortController; snapshotting?: Promise<void>;
  providerId: string; modelId: string;
  engine: Engine; bundle: ProtectedGuestBundle; controller: AbortController; timer: ReturnType<typeof setTimeout>;
  assertCurrent: () => Promise<void>; tools: Set<Promise<unknown>>; events?: Promise<void>; closing?: Promise<void> };
type Subscriber = { controller: ReadableStreamDefaultController<Uint8Array>; close: () => void };
const queueExecutionSchema = z.strictObject({ kind: z.literal("prompt"), model: promptSchema.shape.model,
  agent: z.literal("legalwork").optional(), variant: z.literal("high").optional(),
  parts: z.array(z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("text"), text: z.string().max(512_000), synthetic: z.boolean().optional() }),
    z.strictObject({ type: z.literal("file"), url: z.string().max(8192), mime: z.string().max(256), filename: z.string().max(4096).optional() }),
  ])).min(1).max(24) });
type QueuedInput = { workspaceId: string; sessionId: string; execution: unknown };
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
function projectEventFrame(frame: string, entry: Entry): string {
  const lines = frame.split(/\r?\n/), data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).replace(/^ /, "")).join("\n");
  let value: unknown; try { value = JSON.parse(data); } catch { return frame; }
  if (!record(value)) return frame;
  const wrapped = record(value.payload), payload = wrapped && record(value.payload) ? value.payload : value;
  if (!record(payload.properties)) return frame;
  const properties = payload.properties, info = properties.info;
  let projected: Record<string, unknown> | undefined;
  if (["session.created", "session.updated"].includes(String(payload.type)) && record(info) && info.id === entry.sessionId && info.directory === entry.directory) {
    projected = { ...payload, properties: { ...properties, info: { ...info, directory: entry.hostDirectory } } };
  } else if (payload.type === "message.updated" && record(info) && info.role === "assistant" && info.sessionID === entry.sessionId && record(info.path)) {
    const path = info.path;
    if (path.cwd === entry.directory || path.root === entry.directory) projected = { ...payload, properties: { ...properties, info: { ...info,
      path: { ...path, ...(path.cwd === entry.directory ? { cwd: entry.hostDirectory } : {}), ...(path.root === entry.directory ? { root: entry.hostDirectory } : {}) } } } };
  }
  const part = properties.part;
  const owned = properties.sessionID === entry.sessionId || (record(info) && info.sessionID === entry.sessionId) || (record(part) && part.sessionID === entry.sessionId)
    || (["session.created", "session.updated"].includes(String(payload.type)) && record(info) && info.id === entry.sessionId && info.directory === entry.directory);
  if (!projected && !(wrapped && owned && value.directory === entry.directory)) return frame;
  // Only host-owned technical metadata is projected. Text/tool payloads and
  // arbitrary model strings are never searched or substituted.
  const result = wrapped ? { ...value, ...(owned && value.directory === entry.directory ? { directory: entry.hostDirectory } : {}), payload: projected ?? payload } : projected;
  let inserted = false;
  return lines.flatMap(line => { if (!line.startsWith("data:")) return [line]; if (inserted) return []; inserted = true; return [`data: ${JSON.stringify(result)}`]; }).join("\n");
}
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
          if (worker.entry && await worker.owner.evictIdle(worker.entry)) break;
        }
      }
      signal.throwIfAborted();
      if (this.closed) throw new ApiError(409, "protected_runtime_closed", "The protected runtime is stopping.");
      if (this.ownership.workers.size >= 2) throw new ApiError(409, "protected_runtime_capacity", "Both protected workers are active. Wait for a completed operation before opening another.");
      const worker: WorkerSlot = { owner: this }; this.ownership.workers.add(worker); return worker;
    });
    this.ownership.admission = work.then(() => {}, () => {}); return work;
  }
  private async evictIdle(entry: Entry): Promise<boolean> {
    if (entry.closing || entry.submitting || entry.busy || entry.tools.size) return false;
    const read = (async () => {
      const response = await entry.engine.fetch(new Request("http://protected/session/status", { signal: AbortSignal.timeout(15000) }));
      if (!response.ok) { await response.body?.cancel(); return undefined; }
      return z.record(z.string(), z.unknown()).parse(await response.json());
    })();
    entry.tools.add(read);
    let statuses: Awaited<typeof read>; try { statuses = await read; } finally { entry.tools.delete(read); }
    if (!statuses) return false;
    const status = statuses[entry.sessionId];
    if ((status !== undefined && (!record(status) || status.type !== "idle")) || entry.closing || entry.submitting || entry.busy || entry.tools.size) return false;
    await this.closeEntry(entry.sessionId); return true;
  }

  open(raw: GenerationInput, signal: AbortSignal) {
    if (this.closed) return Promise.reject(new ApiError(409, "protected_runtime_closed", "The protected document runtime is stopping."));
    const pending = (async () => { await this.initialize(); return this.openOperation(raw, AbortSignal.any([signal, this.shutdown.signal])); })();
    this.opening.add(pending);
    void pending.finally(() => this.opening.delete(pending)).catch(() => {});
    return pending;
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
    const readProfile = async () => {
      const profile = input.profileId ? (await readGovernanceProfiles(o.config)).find(item => item.id === input.profileId) : undefined;
      if (input.profileId && (!profile || profile.scope.workspaceId !== workspace.id || profile.targetFingerprint !== target.fingerprint || !profile.scope.matterId))
        throw new ApiError(403, "protected_ai_profile_missing", "Select a current host-owned legal profile for this matter and model target.");
      if (profile) {
        const eligibility = await eligibleGovernanceProfiles(o.config, { operationId, kind: "chat", scope: profile.scope, targetFingerprint: target.fingerprint, dataClasses: ["protected"], purpose: "confined-document-processing" });
        if ("allowed" in eligibility) throw new ApiError(403, "ai_transfer_denied", "The legal profile does not admit this protected transmission.", { reason: eligibility.reason });
      }
      return profile;
    };
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
      const response = await engine.fetch(recovery ? new Request(`http://protected/session/${recovery.sessionId}`, { signal: controller.signal }) : new Request("http://protected/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Protected document operation" }), signal: controller.signal }));
      if (!response.ok) throw new ApiError(502, "protected_session_failed", "The confined engine could not create a session.");
      const session = sessionSchema.parse(await response.json());
      if (recovery && session.id !== recovery.sessionId) throw new ApiError(409, "protected_session_identity", "The restored database did not retain the actual session identity.");
      if (session.directory !== GUEST_DIRECTORY) throw new ApiError(409, "protected_session_stale", "The confined engine did not use its private scratch directory.");
      if (this.closed) throw new ApiError(409, "protected_runtime_closed", "The protected runtime is stopping.");
      if (this.entries.has(session.id)) throw new ApiError(409, "protected_session_identity", "The confined session identity is already owned.");
      if (!recovery) { this.claim(workspace.id, session.id); createdSessionId = session.id; }
      issuedSessionId = session.id;
      const timer = setTimeout(() => { void this.closeEntry(session.id).catch(() => {}); }, 600_000); timer.unref?.();
      const entry: Entry = { workspaceId: workspace.id, sessionId: session.id, directory: session.directory, hostDirectory, workspaceRoot: rootDirectory, sources: input.sources, turnUploads, providerId: input.providerId, modelId: input.modelId, operationId, engine, bundle, controller, egress, timer, assertCurrent, tools: pendingTools, input, initialSourceSetSha256: initial.sourceSetSha256, rootIdentity: initial.rootIdentity, worker };
      worker.entry = entry;
      this.entries.set(session.id, entry);
      entry.events = this.pumpEvents(entry);
      void entry.events.catch(() => {});
      return { session: { ...session, directory: hostDirectory }, directoryMapping: { guestDirectory: session.directory, hostDirectory, rootIdentity: initial.rootIdentity }, operationId, legalApproval: false as const };
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
    return entry;
  }

  async preflightQueued(input: QueuedInput): Promise<z.infer<typeof promptSchema>> {
    await this.reactivate(input.workspaceId, input.sessionId, AbortSignal.timeout(600_000));
    const entry = this.entry(input.workspaceId, input.sessionId);
    const work = this.normalizeQueued(entry, input.execution); entry.tools.add(work);
    try { return (await work).payload; } finally { entry.tools.delete(work); }
  }
  private async normalizeQueued(entry: Entry, execution: unknown): Promise<{ payload: z.infer<typeof promptSchema>; uploads: Array<{ path: string; sha256: string }> }> {
    await entry.assertCurrent();
    const parsed = queueExecutionSchema.safeParse(execution);
    if (!parsed.success || parsed.data.model.providerID !== entry.providerId || parsed.data.model.modelID !== entry.modelId) throw new ApiError(403, "protected_prompt_invalid", "This document session accepts only the selected model, text and copies of its selected originals.");
    const workspace = this.options.config.workspaces.find(item => item.id === entry.workspaceId);
    if (!workspace) throw new ApiError(404, "protected_workspace_missing", "The selected project no longer exists.");
    const parts: Array<{ type: "text"; text: string }> = [];
    const uploads: Array<{ path: string; sha256: string }> = [];
    for (const part of parsed.data.parts) {
      if (part.type === "text") { if (part.text) parts.push({ type: "text", text: part.text }); continue; }
      const uploaded = await uploadedCopyHash(entry.workspaceRoot, part.url);
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
      parts.push({ type: "text", text: JSON.stringify({ untrustedSelectedDocument: true, documentId: original.id, originalPath: original.provenance.sourcePath, sha256: original.hash, uploadedCopyPath: uploaded.path, text }) });
    }
    const normalized = promptSchema.parse({ model: parsed.data.model, agent: "legalwork", ...(parsed.data.variant ? { variant: parsed.data.variant } : {}), parts });
    if (Buffer.byteLength(JSON.stringify(normalized)) > 2 * 1024 * 1024) throw new ApiError(413, "protected_prompt_too_large", "Narrow the protected queued message.");
    await entry.assertCurrent(); return { payload: normalized, uploads };
  }
  async submitQueued(input: QueuedInput & { id: string }, signal: AbortSignal = AbortSignal.timeout(600_000)): Promise<Response> {
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
    const response = await this.proxy({ workspaceId: input.workspaceId, sessionId: input.sessionId, request: new Request(`http://protected/session/${input.sessionId}/message`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...normalized.payload, messageID: `msg_${id.replaceAll("-", "")}` }), signal }) });
    if (!response.body) { entry.submitting = false; return response; }
    const reader = response.body.getReader();
    const finish = () => { entry.submitting = false; reader.releaseLock(); };
    return new Response(new ReadableStream<Uint8Array>({ async pull(controller) {
      try { const next = await reader.read(); if (next.done) { controller.close(); finish(); } else controller.enqueue(next.value); }
      catch (error) { controller.error(error); finish(); }
    }, async cancel(reason) { try { await reader.cancel(reason); } finally { finish(); } } }), { status: response.status, headers: response.headers });
    } catch (error) { entry.submitting = false; throw error; }
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
      if (request.method === "GET" || request.method === "PATCH") {
        const work = this.historicalResponse(saved, request); this.opening.add(work);
        try { return await work; } finally { this.opening.delete(work); }
      }
      await this.reactivate(workspaceId, sessionId, request.signal);
    }
    const entry = this.entry(workspaceId, sessionId);
    const work = this.proxyOwned(entry, sessionId, request); entry.tools.add(work);
    try { return await work; } finally { entry.tools.delete(work); }
  }
  private async proxyOwned(entry: Entry, sessionId: string, request: Request): Promise<Response> {
    if (request.method === "POST" && /\/(?:message|prompt_async)$/.test(new URL(request.url).pathname)) await entry.snapshotting;
    await entry.assertCurrent();
    const url = new URL(request.url), path = url.pathname;
    const suffix = path.slice(path.indexOf("/session/"));
    if (!suffix.startsWith(`/session/${sessionId}`) || !/^(?:|\/message(?:\/[A-Za-z0-9_-]{1,128})?|\/prompt_async|\/abort|\/todo|\/children|\/protected-transport)$/.test(suffix.slice(`/session/${sessionId}`.length)))
      throw new ApiError(403, "protected_route_denied", "This route is outside the selected document operation.");
    for (const [key] of url.searchParams) if (!["directory", "limit", "before", "offset"].includes(key)) throw new ApiError(403, "protected_route_denied", "Unsupported protected engine query.");
    for (const directory of [url.searchParams.get("directory"), decodeDirectory(request.headers.get("x-opencode-directory"))]) {
      if (!directory) continue;
      const physical = await realpath(directory).catch(() => "");
      if (physical !== entry.hostDirectory && !(request.method === "GET" && physical === entry.workspaceRoot)) throw new ApiError(403, "protected_source_scope", "The SDK request does not belong to the selected case directory.");
    }
    url.pathname = suffix;
    url.searchParams.set("directory", entry.directory);
    if (request.method === "GET" && suffix.endsWith("/protected-transport")) return Response.json({ sessionId: entry.sessionId, operationId: entry.operationId, directoryMapping: { guestDirectory: entry.directory, hostDirectory: entry.hostDirectory, rootIdentity: entry.rootIdentity }, transport: "protected-documents-v1", legalApproval: false });
    let body: string | undefined;
    if (request.method === "PATCH" && suffix === `/session/${sessionId}`) {
      let value: unknown; try { value = JSON.parse(await boundedBody(request, 1024, AbortSignal.any([entry.controller.signal, entry.egress.signal]))); } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, "protected_prompt_invalid", "Provide valid bounded metadata JSON."); }
      const update = z.strictObject({ time: z.strictObject({ archived: z.literal(0) }) }).safeParse(value);
      if (!update.success) throw new ApiError(403, "protected_route_denied", "Only the SDK's exact unarchive metadata update is available.");
      body = JSON.stringify(update.data);
    } else if (request.method === "POST" && ["/message", "/prompt_async"].some(end => suffix.endsWith(end))) {
      let value: unknown; try { value = JSON.parse(await boundedBody(request, 2 * 1024 * 1024, AbortSignal.any([entry.controller.signal, entry.egress.signal]))); } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, "protected_prompt_invalid", "Provide valid bounded UTF-8 JSON."); }
      const parsed = promptSchema.safeParse(value);
      if (!parsed.success) throw new ApiError(400, "protected_prompt_invalid", "Provide text, the selected model and the document agent only.");
      if (![entry.providerId, "protected-documents"].includes(parsed.data.model.providerID) || parsed.data.model.modelID !== entry.modelId) throw new ApiError(403, "protected_prompt_invalid", "The selected model changed.");
      // The original selected provider account is host-only. The guest sees one
      // fixed provider with no credential and no arbitrary destination.
      body = JSON.stringify({ ...parsed.data, model: { providerID: "protected-documents", modelID: parsed.data.model.modelID }, agent: "legalwork" });
    } else if (request.method === "POST" && suffix.endsWith("/abort")) {
      await boundedBody(request, 0, AbortSignal.any([entry.controller.signal, entry.egress.signal]));
    } else if (request.method !== "GET") throw new ApiError(403, "protected_route_denied", "Unsupported protected engine method.");
    if (request.method === "POST" && /\/(?:message|prompt_async)$/.test(suffix)) entry.busy = true;
    const response = await entry.engine.fetch(new Request(url, { method: request.method, headers: { accept: request.headers.get("accept") ?? "application/json", ...(body ? { "content-type": "application/json" } : {}) }, body, signal: AbortSignal.any([request.signal, entry.controller.signal, entry.egress.signal]) }));
    if (request.method === "GET" && suffix === `/session/${sessionId}` && response.ok) {
      const session = sessionSchema.parse(await response.json());
      if (session.id !== sessionId || session.directory !== entry.directory) throw new ApiError(409, "protected_session_stale", "The confined session directory changed.");
      return Response.json({ ...session, directory: entry.hostDirectory });
    }
    return response;
  }

  workspaceStatus(workspaceId: string, request: Request): Promise<Response> {
    if (this.closed) return Promise.reject(new ApiError(409, "protected_runtime_closed", "The protected runtime is stopping."));
    const work = this.readWorkspaceStatus(workspaceId, request); this.opening.add(work);
    void work.finally(() => this.opening.delete(work)).catch(() => {}); return work;
  }
  private async readWorkspaceStatus(workspaceId: string, request: Request): Promise<Response> {
    const statuses: Record<string, unknown> = {};
    for (const id of this.sessionIds(workspaceId)) {
      const history = this.entries.has(id) ? undefined : await this.currentHistory(workspaceId, id);
      if (activeProtectedRuntime(this.options.config, workspaceId, id) && activeProtectedRuntime(this.options.config, workspaceId, id) !== this) continue;
      if (!this.entries.has(id) && history) { await this.validateHistorical(history); if (Object.hasOwn(history.statuses, id)) statuses[id] = history.statuses[id]; continue; }
      const entry = this.entry(workspaceId, id);
      const work = (async () => {
        await entry.assertCurrent();
        const response = await entry.engine.fetch(new Request("http://protected/session/status", { signal: AbortSignal.any([request.signal, entry.controller.signal, entry.egress.signal]) }));
        if (!response.ok) throw new ApiError(502, "protected_status_unavailable", "The confined engine status is unavailable.");
        const value: unknown = await response.json();
        if (value && typeof value === "object" && Object.hasOwn(value, id)) statuses[id] = Reflect.get(value, id);
      })();
      entry.tools.add(work); try { await work; } finally { entry.tools.delete(work); }
    }
    return Response.json(statuses);
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
      const response = await entry.engine.fetch(new Request("http://protected/event", { signal: entry.controller.signal }));
      if (!response.ok || !response.body) throw new Error("Protected engine events unavailable");
      const decoder = new TextDecoder("utf-8", { fatal: true }), encoder = new TextEncoder(); let buffered = "";
      for await (const chunk of response.body) {
        buffered += decoder.decode(chunk, { stream: true });
        if (Buffer.byteLength(buffered) > 4 * 1024 * 1024) throw new Error("Protected engine event frame is too large");
        for (;;) {
          const boundary = /\r?\n\r?\n/.exec(buffered); if (!boundary) break;
          const end = boundary.index + boundary[0].length, frame = encoder.encode(projectEventFrame(buffered.slice(0, end), entry)); buffered = buffered.slice(end);
          // Multiplex complete real frames: byte chunks from separate workers
          // must never interleave halfway through another session's JSON.
          for (const subscriber of this.subscribers.get(entry.workspaceId) ?? []) {
            if ((subscriber.controller.desiredSize ?? 0) < frame.byteLength) subscriber.close(); else subscriber.controller.enqueue(frame);
          }
          if (!entry.closing) {
            const text = new TextDecoder().decode(frame), match = /^data: (.+)$/m.exec(text);
            if (match) { try { const event: unknown = JSON.parse(match[1]); if (record(event) && record(event.properties) && event.properties.sessionID === entry.sessionId && (event.type === "session.idle" || (event.type === "session.status" && record(event.properties.status) && event.properties.status.type === "idle"))) { entry.busy = false; void this.persistEntry(entry).catch(() => {}); } } catch {} }
          }
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
    return { workspaceRoot, hostDirectory, rootIdentity: binding.rootIdentity };
  }

  private async historicalResponse(saved: StoredProtectedSession, request: Request): Promise<Response> {
    const mapping = await this.validateHistorical(saved), url = new URL(request.url), suffix = url.pathname.slice(url.pathname.indexOf(`/session/${saved.sessionId}`) + `/session/${saved.sessionId}`.length);
    for (const directory of [url.searchParams.get("directory"), decodeDirectory(request.headers.get("x-opencode-directory"))]) {
      if (!directory) continue; const path = await realpath(directory).catch(() => "");
      if (path !== mapping.hostDirectory && !(request.method === "GET" && path === mapping.workspaceRoot)) throw new ApiError(403, "protected_source_scope", "This historical SDK read belongs to another directory.");
    }
    if (request.method === "PATCH" && suffix === "") {
      const body: unknown = JSON.parse(await boundedBody(request, 1024, this.shutdown.signal));
      if (!z.strictObject({ time: z.strictObject({ archived: z.literal(0) }) }).safeParse(body).success || (record(saved.session.time) && Boolean(saved.session.time.archived))) throw new ApiError(403, "protected_route_denied", "Reauthorize this historical operation before changing it.");
      return Response.json({ ...saved.session, directory: mapping.hostDirectory });
    }
    if (request.method !== "GET") throw new ApiError(403, "protected_route_denied", "Historical data grants no new model operation.");
    if (suffix === "") return Response.json({ ...saved.session, directory: mapping.hostDirectory });
    if (suffix === "/protected-transport") return Response.json({ sessionId: saved.sessionId, operationId: saved.operationId, directoryMapping: { guestDirectory: saved.guestDirectory, hostDirectory: mapping.hostDirectory, rootIdentity: mapping.rootIdentity }, transport: "protected-documents-v1", legalApproval: false });
    if (suffix === "/children") return Response.json(saved.children);
    if (suffix === "/todo") return Response.json(saved.todo);
    if (suffix === "/message") {
      const limit = z.coerce.number().int().min(1).max(10000).parse(url.searchParams.get("limit") ?? 10000);
      let messages = saved.messages;
      const before = url.searchParams.get("before"); if (before) { const index = messages.findIndex(message => record(message.info) && message.info.id === before); if (index < 0) throw new ApiError(404, "protected_message_missing", "The captured message is unavailable."); messages = messages.slice(0, index); }
      return Response.json(messages.slice(-limit));
    }
    const messageId = /^\/message\/([A-Za-z0-9_-]{1,128})$/.exec(suffix)?.[1];
    const message = messageId && saved.messages.find(item => record(item.info) && item.info.id === messageId);
    if (message) return Response.json(message);
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
      const statuses = z.record(z.string(), z.unknown()).parse(await (await read("/session/status")).json());
      const status = statuses[entry.sessionId];
      if (record(status) && status.type !== "idle") throw new ApiError(409, "protected_checkpoint_busy", "Only an actual idle session may be captured.");
      const checkpoint = await read("/_protected/checkpoint"), expected = checkpoint.headers.get("x-protected-sha256");
      const chunks: Uint8Array[] = []; let bytes = 0;
      if (!checkpoint.body) throw new ApiError(502, "protected_checkpoint_failed", "The actual engine checkpoint is empty.");
      const reader = checkpoint.body.getReader();
      try {
        for (;;) { signal.throwIfAborted(); const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > MAX_PROTECTED_CHECKPOINT) throw new ApiError(413, "protected_checkpoint_too_large", "The checkpoint exceeds the verified capacity."); chunks.push(next.value); }
      } finally { try { await reader.cancel(); } finally { reader.releaseLock(); } }
      const database = Buffer.concat(chunks);
      if (!expected || createHash("sha256").update(database).digest("hex") !== expected) throw new ApiError(409, "protected_checkpoint_invalid", "The actual engine checkpoint hash does not match.");
      const session = sessionSchema.parse(await (await read(`/session/${entry.sessionId}`)).json());
      const messages = z.array(z.record(z.string(), z.unknown())).parse(await (await read(`/session/${entry.sessionId}/message`)).json());
      const children = z.array(z.unknown()).parse(await (await read(`/session/${entry.sessionId}/children`)).json());
      const todo = z.array(z.unknown()).parse(await (await read(`/session/${entry.sessionId}/todo`)).json());
      const saved = await this.store.save({ version: 1, workspaceId: entry.workspaceId, sessionId: entry.sessionId, operationId: entry.operationId, input: entry.input, rootIdentity: entry.rootIdentity,
        sourceSetSha256: entry.initialSourceSetSha256, hostDirectory: entry.hostDirectory, workspaceRoot: entry.workspaceRoot, guestDirectory: GUEST_DIRECTORY,
        capturedAt: new Date().toISOString(), session, messages, children, todo, statuses }, database);
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
        const stopped = await entry.engine.fetch(new Request(`http://protected/session/${entry.sessionId}/abort`, { method: "POST", signal: AbortSignal.timeout(15000) })); await stopped.body?.cancel();
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
