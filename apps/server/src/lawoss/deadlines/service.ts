import { sameReceiptUse, type ProjectionAttestation, type DeadlineReceiptLedger } from "./ledger.js";
import { closeSync, constants, existsSync, fsyncSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { ApiError } from "../../errors.js";
import type { WorkspaceInfo } from "../../types.js";
import type { HostDecisionPort } from "../host-decision.js";
import { fingerprint, legalFingerprint, sha256, stableJson } from "./hash.js";
import { calculate, selectRule } from "./compute.js";
import { proposeDeadline, uncertainty } from "./extract.js";
import { semanticHash } from "./record.js";
import { readDeadlineEvidence, type DocumentEvidencePort } from "./evidence.js";
import { renderDeadlineIcs, renderDeadlineIcsPreview } from "./ics.js";
import { receiptBindingHash, verifyDeadlineReceipt } from "./approval.js";
import { proposedRulePacks, holidaySets } from "./rules.js";
import { assertMatterBinding, assertSourceBytes, listStoredDeadlines, readStoredDeadline, safePath, syncDirectory, withDeadlineLock, writeDeadlineRecord, type StoredDeadline } from "./repository.js";
import { idSchema, inputSchema } from "./schema.js";
import type { CalculationInput, CandidateRevision, CommitResult, ConfirmedDeadlineRecord, DeadlinePayload, DeadlineReceiptBinding, HolidaySet, MatterBinding, ReviewPreview, RulePack } from "./types.js";
export type DeadlineWorkflowOptions = { host: HostDecisionPort; ledger: DeadlineReceiptLedger; documents?: DocumentEvidencePort; workspace?: WorkspaceInfo; rules?: readonly RulePack[]; holidays?: readonly HolidaySet[]; now?: () => string; mirrorAudit?: (binding: MatterBinding, payload: DeadlinePayload) => Promise<void>; fault?: (point: string) => void };
const conflict = (message: string) => new ApiError(409, "deadline_conflict", message);
const head = (record: StoredDeadline): CandidateRevision => record.payload.revisions.at(-1)!;
export class DeadlineWorkflow {
  private readonly rules: readonly RulePack[]; private readonly holidays: readonly HolidaySet[];
  constructor(private readonly options: DeadlineWorkflowOptions) { this.rules = options.rules ?? proposedRulePacks; this.holidays = options.holidays ?? holidaySets; }
  private ledgerKey(binding: MatterBinding, candidateId: string): string { return fingerprint({ workspaceId: binding.workspaceId, matterId: binding.matterId, receiptScope: binding.receiptScope, candidateId }); }
  private now(): string { return this.options.now?.() ?? new Date().toISOString(); }
  private result(record: StoredDeadline, replay = false): CommitResult { const candidate = head(record); return { candidateId: candidate.candidateId, revisionHash: candidate.revisionHash, state: candidate.state, exportState: record.payload.confirmation ? record.payload.export?.state ?? "not_requested" : "not_requested", recordHash: record.recordHash, ...(replay ? { replay: true } : {}), ...(record.payload.export?.error ? { error: record.payload.export.error } : {}) }; }
  private event(operationId: string, kind: DeadlinePayload["events"][number]["kind"], candidate: CandidateRevision, reason: string) { return { id: randomUUID(), operationId, kind, revisionHash: candidate.revisionHash, reason, at: this.now() }; }
  private calculateCandidate(binding: MatterBinding, input: CalculationInput): CandidateRevision {
    const candidate = proposeDeadline({ workspaceId: binding.workspaceId, matterId: binding.matterId, input });
    const selected = selectRule(candidate.input, this.rules);
    const calculation = "code" in selected ? { kind: "indeterminate" as const, uncertainties: [...candidate.input.uncertainties, selected] } : (() => { const holidays = this.holidays.find(value => value.id === selected.holidaySetId); return holidays ? calculate(candidate.input, selected, holidays) : { kind: "indeterminate" as const, uncertainties: [uncertainty("rule_outside_coverage", "Holiday catalogue is unavailable.")] }; })();
    const next = { ...candidate, state: calculation.kind === "determinate" ? "candidate" as const : "needs_review" as const, calculation };
    return { ...next, revisionHash: semanticHash(next) };
  }
  async saveCandidate(binding: MatterBinding, value: CalculationInput, expectedRecordHash: string | null, replacement?: { candidateId: string; supersedesRevisionHash: string }): Promise<CommitResult> {
    const input = inputSchema.parse(value); if (input.jurisdiction !== binding.jurisdiction) throw conflict("Selected rule jurisdiction differs from the matter card."); const candidate = this.calculateCandidate(binding, input);
    const allEvidence = [...input.evidence, ...(input.delivery ? [input.delivery.evidence] : [])];
    if (new Set(input.evidence.map(e => e.originalId)).size > 1 || new Set(allEvidence.map(e => e.originalId)).size > 2) throw conflict("Select one decision and at most one service proof.");
    if (this.options.documents && this.options.workspace) await this.revalidateEvidence(binding, { version: 1, revisions: [candidate], events: [], confirmation: null, export: null });
    return withDeadlineLock(binding, () => {
      const existing = listStoredDeadlines(binding).find(record => head(record).candidateId === (replacement?.candidateId ?? candidate.candidateId));
      const target = existing ? head(existing).candidateId : candidate.candidateId;
      if (existing && head(existing).revisionHash === candidate.revisionHash && replacement === undefined) return this.result(existing, true);
      if (existing && (expectedRecordHash === null || existing.recordHash !== expectedRecordHash)) throw conflict("Editing an existing candidate requires its full current OKF hash.");
      if (replacement && (!existing || replacement.supersedesRevisionHash !== head(existing).revisionHash)) throw conflict("Explicit supersedes revision does not match the current candidate.");
      const prior = existing ? head(existing) : null;
      const next = { ...candidate, candidateId: target, revision: prior ? prior.revision + 1 : 1, supersedesRevisionHash: prior?.revisionHash ?? null }; next.revisionHash = semanticHash(next);
      // A committed record remains immutable until a separate native revocation; edit by explicit replacement after revoke.
      if (prior?.state === "confirmed") throw conflict("Revoke the confirmed deadline before preparing a replacement revision.");
      const payload: DeadlinePayload = { version: 1, revisions: [...(existing?.payload.revisions ?? []), next], events: existing?.payload.events ?? [], confirmation: null, export: existing?.payload.export ?? null };
      assertSourceBytes(binding, payload);
      const saved = writeDeadlineRecord(binding, target, existing?.recordHash ?? expectedRecordHash, payload, this.event(randomUUID(), "candidate", next, "Untrusted manual/model extraction"), this.options.fault);
      return this.result(saved);
    });
  }
  private async revalidateEvidence(binding: MatterBinding, payload: DeadlinePayload): Promise<void> {
    assertMatterBinding(binding); assertSourceBytes(binding, payload);
    if (!this.options.documents || !this.options.workspace) return;
    const candidate = payload.revisions.at(-1)!;
    const old = [...candidate.input.evidence, ...(candidate.input.delivery ? [candidate.input.delivery.evidence] : [])];
    const selected = { documentIds: [...new Set(old.map(e => e.documentId))], locators: old.map(e => ({ documentId: e.documentId, locator: e.locator })) };
    const current = await readDeadlineEvidence(this.options.documents, this.options.workspace, selected);
    const withoutTime = (value: unknown) => stableJson(value).replace(/,"retrievedAt":"[^"]*"/g, "");
    for (const previous of old) { const match = current.find(value => value.documentId === previous.documentId && value.locator.locatorId === previous.locator.locatorId); if (!match || withoutTime(match) !== withoutTime(previous)) throw conflict("Prepared evidence, provenance or exact locator changed."); }
    assertSourceBytes(binding, payload);
  }
  private sourceSetHash(candidate: CandidateRevision): string { return legalFingerprint({ evidence: candidate.input.evidence, delivery: candidate.input.delivery }); }
  private preview(record: StoredDeadline): ReviewPreview {
    const candidate = head(record), calculation = candidate.calculation;
    const selected = selectRule(candidate.input, this.rules), holidays = "code" in selected ? null : this.holidays.find(value => value.id === selected.holidaySetId);
    const currentCalculation = "code" in selected || !holidays ? null : calculate(candidate.input, selected, holidays);
    const canConfirm = candidate.state === "candidate" && calculation.kind === "determinate" && currentCalculation?.kind === "determinate" && fingerprint(currentCalculation) === fingerprint(calculation);
    const icsPreview = calculation.kind === "determinate" ? renderDeadlineIcsPreview({ ...candidate, calculation, export: { uid: `lawoss-${candidate.candidateId}@legalwork.local`, sequence: 0, decidedAt: "2000-01-01T00:00:00Z", cancelled: false } }).bytes : "";
    const sourceSetHash = this.sourceSetHash(candidate), okfDiff = `state: ${candidate.state} → confirmed + export_pending\nrevision: ${candidate.revisionHash}\nlocal file: exports/deadlines/${candidate.candidateId}.ics`;
    const warnings = calculation.kind === "indeterminate" ? calculation.uncertainties.map(issue => issue.detail) : ["Local ICS file only. Importing it does not create a managed remote reminder."];
    const reviewHash = fingerprint({ candidate, sourceSetHash, okfDiff, icsPreview, recordHash: record.recordHash });
    return { candidate, reviewHash, sourceSetHash, okfDiff, icsPreview, warnings, canConfirm, recordHash: record.recordHash };
  }
  private currentPreview(binding: MatterBinding, record: StoredDeadline): ReviewPreview {
    const preview = this.preview(record);
    try { assertSourceBytes(binding, record.payload); return preview; }
    catch (error) {
      const candidate = head(record), refs = [...candidate.input.evidence, ...(candidate.input.delivery ? [candidate.input.delivery.evidence] : [])];
      const sourceState = refs.map(ref => { try { return { path: ref.relativePath, hash: sha256(readFileSync(safePath(binding.workspaceRoot,ref.relativePath))) }; } catch { return { path: ref.relativePath, hash: "unavailable" }; } });
      const sourceSetHash = fingerprint({ historical: preview.sourceSetHash, current: sourceState });
      const detail = error instanceof ApiError ? error.message : "Source is missing or unreadable; the old date is historical and requires review.";
      return { ...preview, sourceSetHash, reviewHash: fingerprint({ reviewHash: preview.reviewHash, sourceSetHash }), canConfirm: false, warnings: [...preview.warnings,detail] };
    }
  }
  async prepareReview(binding: MatterBinding, candidateId: string, expectedRevisionHash: string): Promise<ReviewPreview> {
    const record = readStoredDeadline(binding, candidateId); if (head(record).revisionHash !== expectedRevisionHash) throw conflict("Candidate revision changed.");
    assertMatterBinding(binding);
    const preview = this.currentPreview(binding, record);
    try { await this.revalidateEvidence(binding, record.payload); return preview; }
    catch (error) { const detail = error instanceof ApiError ? error.message : "Source is missing or unreadable; the old date is historical and requires review."; return { ...preview, canConfirm: false, warnings: [...new Set([...preview.warnings, detail])] }; }
  }
  private binding(binding: MatterBinding, preview: ReviewPreview, action: "deadline.confirm" | "deadline.revoke", operationId: string): DeadlineReceiptBinding {
    const calc = preview.candidate.calculation; if (calc.kind !== "determinate") throw conflict("Cannot confirm an indeterminate deadline.");
    return { workspaceId: binding.workspaceId, matterId: binding.matterId, candidateId: preview.candidate.candidateId, revisionHash: preview.candidate.revisionHash, reviewHash: preview.reviewHash, sourceSetHash: preview.sourceSetHash, ruleSetHash: calc.ruleSetHash, holidaySetHash: calc.holidaySetHash, action, operationId, workspaceRootGeneration: binding.workspaceRootGeneration };
  }
  async decide(binding: MatterBinding, candidateId: string, expectedRevisionHash: string, decision: "confirm" | "defer" | "reject" | "revoke", operationId: string, signal?: AbortSignal, expectedReviewHash?: string, reason = "Native deadline review"): Promise<CommitResult> {
    idSchema.parse(operationId);
    const before = readStoredDeadline(binding, candidateId), priorEvent = before.payload.events.find(event => event.operationId === operationId);
    if (priorEvent) { const expectedKind = decision === "confirm" ? "confirmed" : decision === "revoke" ? "revoked" : decision === "defer" ? "deferred" : "rejected"; if (priorEvent.kind !== expectedKind || priorEvent.revisionHash !== expectedRevisionHash || (expectedReviewHash && before.payload.confirmation?.reviewHash !== expectedReviewHash)) throw conflict("Operation ID was already used for a different payload."); return this.result(before, true); }
    const preview = await this.prepareReview(binding, candidateId, expectedRevisionHash);
    if (expectedReviewHash && preview.reviewHash !== expectedReviewHash) throw conflict("Review preview changed; review the current inputs.");
    if (decision === "defer" || decision === "reject") return withDeadlineLock(binding, () => {
      const current = readStoredDeadline(binding, candidateId); if (current.recordHash !== before.recordHash || ["confirmed", "revoked"].includes(head(current).state)) throw conflict("Current state cannot be deferred or rejected.");
      const next = { ...head(current), state: decision === "defer" ? "needs_review" as const : "rejected" as const }, payload = { ...current.payload, revisions: [...current.payload.revisions.slice(0, -1), next] };
      return this.result(writeDeadlineRecord(binding, candidateId, current.recordHash, payload, this.event(operationId, decision === "defer" ? "deferred" : "rejected", next, reason), this.options.fault));
    });
    if (decision === "confirm" && !preview.canConfirm) throw conflict("A complete candidate and legally approved current rule are required.");
    if (decision === "revoke" && (head(before).state !== "confirmed" || !before.payload.confirmation)) throw conflict("Only a confirmed deadline can be revoked.");
    const action = decision === "confirm" ? "deadline.confirm" : "deadline.revoke", bound = this.binding(binding, preview, action, operationId), bindingHash = receiptBindingHash(bound);
    const ledgerKey = this.ledgerKey(binding,candidateId), pendingUse = await this.options.ledger.run(store => store.current(ledgerKey));
    const receipt = pendingUse?.operationId === operationId && pendingUse.bindingHash === bindingHash
      ? await verifyDeadlineReceipt(this.options.host,pendingUse.receiptId,bound)
      : await this.options.host.requestDecision({ workspaceId: binding.workspaceId, action, operationId, bindingHash, summary: `${preview.candidate.input.ruleId} @ ${preview.candidate.input.ruleVersion}\n${preview.candidate.input.delivery ? `Service: ${preview.candidate.input.delivery.occurredAt} / ${preview.candidate.input.delivery.recipientRef} / ${preview.candidate.input.delivery.method}` : "Service not evidenced"}\n${preview.candidate.input.evidence.map(value=>`${value.relativePath} / ${value.locator.locatorId}: ${value.locator.quote.slice(0,1500)}`).join("\n")}\n${decision === "confirm" ? "Confirm" : "Revoke"} deadline ${preview.candidate.calculation.kind === "determinate" ? preview.candidate.calculation.dueDate : ""}\n${preview.okfDiff}\n${reason}\n${decision === "revoke" ? "Local cancellation ICS does not remove imported events from other calendars." : ""}`, paths: [`${binding.relativePath}/memory/${candidateId}.md`, `${binding.relativePath}/exports/deadlines/${candidateId}.ics`], readCurrentBindingHash: async () => { const latest = await this.prepareReview(binding, candidateId, expectedRevisionHash); return receiptBindingHash(this.binding(binding, latest, action, operationId)); } }, signal);
    if (signal?.aborted) throw conflict("Native review was cancelled.");
    await verifyDeadlineReceipt(this.options.host, receipt.id, bound);
    if (decision === "confirm") await this.revalidateEvidence(binding, before.payload);
    const committed = await this.options.ledger.run(ledger => withDeadlineLock(binding, () => {
      const current = readStoredDeadline(binding, candidateId);
      if (current.recordHash !== preview.recordHash || this.currentPreview(binding,current).reviewHash !== preview.reviewHash) throw conflict("Review became stale before the canonical commit.");
      if (decision === "confirm") assertSourceBytes(binding, current.payload);
      const next = { ...head(current), state: decision === "confirm" ? "confirmed" as const : "revoked" as const }, calculation = next.calculation;
      if (calculation.kind !== "determinate") throw conflict("Determinate calculation required.");
      const previousUse = ledger.current(ledgerKey);
      if (previousUse && !previousUse.projection) throw conflict("Projection authority is unavailable for this historical receipt; preserve the files for explicit review.");
      const resuming = previousUse?.operationId === operationId && previousUse.receiptId === receipt.id && previousUse.bindingHash === bindingHash;
      const sequence = resuming ? previousUse.projection!.sequence : (previousUse?.projection?.sequence ?? -1) + 1;
      const projected = renderDeadlineIcs({ ...next, calculation, export: { uid: `lawoss-${candidateId}@legalwork.local`, sequence, decidedAt: receipt.decidedAt, cancelled: decision === "revoke" } });
      const projection: ProjectionAttestation = resuming ? previousUse.projection! : { uid: projected.uid, sequence: projected.sequence, sha256: projected.sha256, decidedAt: receipt.decidedAt, cancelled: decision === "revoke", ownedHashes: [...(previousUse?.projection?.ownedHashes ?? []),projected.sha256] };
      if (projection.ownedHashes.length > 65 || projection.sha256 !== projected.sha256 || projection.uid !== projected.uid || projection.decidedAt !== receipt.decidedAt || projection.cancelled !== (decision === "revoke")) throw conflict("Native projection history is full or the reserved operation changed; archive review is required.");
      const plannedExport = { state: "export_pending" as const, uid: projection.uid, sequence: projection.sequence, decidedAt: projection.decidedAt, sha256: projection.sha256, previousHashes: projection.ownedHashes.slice(0,-1), error: null, cancelled: projection.cancelled };
      const payload: DeadlinePayload = { ...current.payload, revisions: [...current.payload.revisions.slice(0, -1), next], confirmation: { receiptId: receipt.id, operationId, bindingHash, reviewHash: preview.reviewHash, sourceSetHash: preview.sourceSetHash, revisionHash: next.revisionHash, decidedAt: receipt.decidedAt, action, workspaceRootGeneration: binding.workspaceRootGeneration }, export: plannedExport };
      if (previousUse && previousUse.operationId !== operationId && !current.payload.events.some(event => event.operationId === previousUse.operationId && ["confirmed","revoked"].includes(event.kind))) throw conflict("A previous native operation must be recovered before this confirmation.");
      if (!ledger.advance(ledgerKey,previousUse?.receiptId ?? null,{receiptId:receipt.id,operationId,bindingHash,action,projection})) throw conflict("A concurrent native decision already consumed this revision.");
      try { return writeDeadlineRecord(binding, candidateId, current.recordHash, payload, { ...this.event(operationId, decision === "confirm" ? "confirmed" : "revoked", next, reason), at: receipt.decidedAt }, this.options.fault); }
      catch (error) { try { if (readStoredDeadline(binding,candidateId).recordHash === current.recordHash) ledger.restore(ledgerKey,receipt.id,previousUse); } catch {} throw error; }
    }));
    try { this.options.fault?.("after_okf_commit"); const result = await this.exportDeadlineIcs(binding, candidateId, expectedRevisionHash); try { await this.options.mirrorAudit?.(binding,readStoredDeadline(binding,candidateId).payload); } catch {} return result; }
    catch { return this.result(readStoredDeadline(binding, candidateId)); } // Commit is authoritative; export recovery never rolls it back.
  }
  private async trusted(binding: MatterBinding, record: StoredDeadline, allowRevoked = false): Promise<boolean> {
    try {
      const candidate = head(record), confirmation = record.payload.confirmation;
      if (!confirmation || !record.payload.export || (candidate.state !== "confirmed" && !(allowRevoked && candidate.state === "revoked")) || candidate.calculation.kind !== "determinate" || confirmation.revisionHash !== candidate.revisionHash || confirmation.workspaceRootGeneration !== binding.workspaceRootGeneration || (candidate.state === "confirmed" && confirmation.sourceSetHash !== this.sourceSetHash(candidate))) return false;
      if (candidate.state === "confirmed") await this.revalidateEvidence(binding, record.payload);
      // Revocation must remain exportable even after the legal catalogue is withdrawn.
      if (candidate.state === "confirmed") { const selected = selectRule(candidate.input, this.rules), calendar = "code" in selected ? null : this.holidays.find(value => value.id === selected.holidaySetId); if ("code" in selected || !calendar || fingerprint(calculate(candidate.input, selected, calendar)) !== fingerprint(candidate.calculation)) return false; }
      const bound: DeadlineReceiptBinding = { workspaceId: binding.workspaceId, matterId: binding.matterId, candidateId: candidate.candidateId, revisionHash: candidate.revisionHash, reviewHash: confirmation.reviewHash, sourceSetHash: confirmation.sourceSetHash, ruleSetHash: candidate.calculation.ruleSetHash, holidaySetHash: candidate.calculation.holidaySetHash, action: confirmation.action, operationId: confirmation.operationId, workspaceRootGeneration: binding.workspaceRootGeneration };
      if ((candidate.state === "confirmed") !== (confirmation.action === "deadline.confirm") || receiptBindingHash(bound) !== confirmation.bindingHash) return false;
      const used = await this.options.ledger.run(store => store.current(this.ledgerKey(binding,candidate.candidateId)));
      if (used?.receiptId !== confirmation.receiptId || used.operationId !== confirmation.operationId || used.bindingHash !== confirmation.bindingHash) return false;
      const receipt = await verifyDeadlineReceipt(this.options.host, confirmation.receiptId, bound);
      if (!used.projection || receipt.decidedAt !== confirmation.decidedAt || used.projection.decidedAt !== receipt.decidedAt || used.projection.uid !== `lawoss-${candidate.candidateId}@legalwork.local` || used.projection.cancelled !== (candidate.state === "revoked")) return false;
      const projection = renderDeadlineIcs({ ...candidate, calculation: candidate.calculation, export: used.projection });
      if (projection.sha256 !== used.projection.sha256) return false;
      return true;
    } catch { return false; }
  }
  private exportMetadata(projection: ProjectionAttestation, state: "export_pending" | "exported" | "export_failed", error: string | null): NonNullable<DeadlinePayload["export"]> {
    return { uid: projection.uid, sequence: projection.sequence, decidedAt: projection.decidedAt, sha256: projection.sha256, previousHashes: projection.ownedHashes.slice(0,-1), cancelled: projection.cancelled, state, error };
  }
  private matchesProjectionHint(hint: NonNullable<DeadlinePayload["export"]>, projection: ProjectionAttestation): boolean {
    return stableJson({...hint,state:"export_pending",error:null}) === stableJson(this.exportMetadata(projection,"export_pending",null));
  }
  private observedExport(binding: MatterBinding, record: StoredDeadline, projection: ProjectionAttestation): NonNullable<DeadlinePayload["export"]> {
    try {
      const target = safePath(binding.matterRoot,`exports/deadlines/${head(record).candidateId}.ics`), hash = existsSync(target) ? sha256(readFileSync(target)) : null;
      if (hash === projection.sha256) return this.exportMetadata(projection,"exported",null);
      if (hash !== null && !projection.ownedHashes.includes(hash)) return this.exportMetadata(projection,"export_failed","A foreign or externally edited ICS file is preserved.");
      return this.exportMetadata(projection,record.payload.export?.state === "export_failed" ? "export_failed" : "export_pending",record.payload.export?.error ?? null);
    } catch { return this.exportMetadata(projection,"export_failed","The local ICS path is unavailable or is not an ordinary owned file."); }
  }
  async list(binding: MatterBinding) {
    const records = listStoredDeadlines(binding);
    return Promise.all(records.map(async record => {
      const candidate = head(record), used = await this.options.ledger.run(store=>store.current(this.ledgerKey(binding,candidate.candidateId)));
      const projected = record.payload.confirmation && used?.receiptId === record.payload.confirmation.receiptId && used.projection ? this.observedExport(binding,record,used.projection) : null;
      return { ...this.result(record), ...(projected ? {exportState:projected.state} : {}), candidate, export: projected ?? record.payload.export, trusted: await this.trusted(binding,record), recordFingerprint:record.fingerprint, receiptId:record.payload.confirmation?.receiptId ?? null };
    }));
  }
  async exportDeadlineIcs(binding: MatterBinding, candidateId: string, expectedRevisionHash: string): Promise<CommitResult> {
    const before = readStoredDeadline(binding, candidateId);
    if (head(before).revisionHash !== expectedRevisionHash || !await this.trusted(binding, before, true)) throw conflict("Current native confirmation and unchanged sources are required for export.");
    const admitted = await this.options.ledger.run(store=>store.current(this.ledgerKey(binding,candidateId)));
    return this.options.ledger.run(ledger=>withDeadlineLock(binding, () => {
      const current = readStoredDeadline(binding, candidateId), candidate = head(current), hint = current.payload.export;
      const used = ledger.current(this.ledgerKey(binding,candidateId));
      if (!used?.projection || !admitted || !sameReceiptUse(used,admitted) || used.receiptId !== current.payload.confirmation?.receiptId) throw conflict("Native projection authority changed before export.");
      const exp = { ...used.projection, state: hint?.state ?? "export_pending", previousHashes: used.projection.ownedHashes.slice(0,-1), error: hint?.error ?? null };
      if (current.recordHash !== before.recordHash || !exp || candidate.calculation.kind !== "determinate") throw conflict("Export revision changed.");
      if (candidate.state === "confirmed") assertSourceBytes(binding, current.payload);
      try {
        const projected = renderDeadlineIcs({ ...candidate, calculation: candidate.calculation, export: { ...exp } });
        if (projected.sha256 !== exp.sha256 || projected.uid !== exp.uid) throw conflict("Planned projection does not match canonical OKF.");
        const target = safePath(binding.matterRoot, `exports/deadlines/${candidateId}.ics`, true);
        const oldHash = existsSync(target) ? sha256(readFileSync(target)) : null;
        if (oldHash !== null && !used.projection.ownedHashes.includes(oldHash)) throw conflict("A foreign or externally edited ICS file is preserved.");
        if (oldHash === exp.sha256 && hint?.state === "exported" && this.matchesProjectionHint(hint,used.projection)) return this.result(current,true);
        if (oldHash !== exp.sha256) {
          const temporary = `${target}.${randomUUID()}.tmp`;
          try {
            const fd = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600); try { writeFileSync(fd, projected.bytes); fsyncSync(fd); } finally { closeSync(fd); }
            this.options.fault?.("ics_staged");
            if ((existsSync(target) ? sha256(readFileSync(target)) : null) !== oldHash) throw conflict("ICS changed during staging.");
            renameSync(temporary, target); syncDirectory(dirname(target)); this.options.fault?.("ics_renamed");
          } finally { rmSync(temporary, { force: true }); }
        }
        return this.result(writeDeadlineRecord(binding, candidateId, current.recordHash, { ...current.payload, export: this.exportMetadata(used.projection,"exported",null) }, this.event(randomUUID(), "exported", candidate, "Local ICS hash verified"), this.options.fault));
      } catch (error) {
        const safeError = error instanceof ApiError ? error.message : "Local ICS write failed; retry after resolving the filesystem error.";
        return this.result(writeDeadlineRecord(binding, candidateId, current.recordHash, { ...current.payload, export: this.exportMetadata(used.projection,"export_failed",safeError) }, this.event(randomUUID(), "export_failed", candidate, safeError), this.options.fault));
      }
    }));
  }
  async recoverDeadlineExports(binding: MatterBinding): Promise<readonly CommitResult[]> {
    const results: CommitResult[] = [];
    for (const record of listStoredDeadlines(binding)) {
      const candidate = head(record), used = await this.options.ledger.run(store=>store.current(this.ledgerKey(binding,candidate.candidateId)));
      try {
        if (used && record.payload.confirmation?.receiptId !== used.receiptId && !record.payload.events.some(event=>event.operationId === used.operationId && (event.kind === "confirmed" || event.kind === "revoked"))) {
          const preview = await this.prepareReview(binding,candidate.candidateId,candidate.revisionHash);
          results.push(await this.decide(binding,candidate.candidateId,candidate.revisionHash,used.action === "deadline.confirm" ? "confirm" : "revoke",used.operationId,undefined,preview.reviewHash,"Recover exact previously decided operation"));
        } else if (record.payload.confirmation && used?.projection && (record.payload.export?.state !== "exported" || !this.matchesProjectionHint(record.payload.export,used.projection) || this.observedExport(binding,record,used.projection).state !== "exported")) results.push(await this.exportDeadlineIcs(binding,candidate.candidateId,candidate.revisionHash));
      } catch { results.push({ ...this.result(record), error: "Recovery needs current local confirmation and unchanged evidence." }); }
      try { await this.options.mirrorAudit?.(binding,readStoredDeadline(binding,candidate.candidateId).payload); } catch { results.push({ ...this.result(readStoredDeadline(binding,candidate.candidateId)), error: "Canonical OKF events are preserved; audit mirror awaits retry." }); }
    }
    return results;
  }
}
