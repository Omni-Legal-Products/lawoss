import { ApiError } from "../../errors.js";
import { legalFingerprint } from "./hash.js";
import { candidateSchema, payloadSchema } from "./schema.js";
import { patchDeadlineEnvelope, readDeadlineEnvelope } from "./runtime.js";
import type { CandidateRevision, DeadlinePayload, DeadlineDomainEvent } from "./types.js";
export const semanticHash = (candidate: Omit<CandidateRevision, "revisionHash"> | CandidateRevision): string => legalFingerprint({ candidateId: candidate.candidateId, matterId: candidate.matterId, workspaceId: candidate.workspaceId, input: candidate.input, calculation: candidate.calculation });
export const candidateTruth = (candidate: CandidateRevision): string => JSON.stringify({ revisionHash: candidate.revisionHash, input: candidate.input, calculation: candidate.calculation });
export function parseDeadlineRecord(text: string): DeadlinePayload | null {
  try {
    const envelope = readDeadlineEnvelope(text); if (!envelope) return null;
    if (Buffer.byteLength(envelope.body) > 512 * 1024) throw new Error("Payload limit");
    const parsed: unknown = JSON.parse(envelope.body);
    if (JSON.stringify(parsed) !== envelope.body.trim()) throw new Error("Managed payload must use canonical compact JSON without duplicate keys.");
    const payload = payloadSchema.parse(parsed);
    const candidate = payload.revisions.at(-1)!;
    for (const [i, revision] of payload.revisions.entries()) if (revision.revisionHash !== semanticHash(revision) || revision.revision !== i + 1 || (i > 0 && revision.supersedesRevisionHash !== payload.revisions[i - 1]?.revisionHash)) throw new Error("Invalid revision chain");
    const due = candidate.calculation.kind === "determinate" ? candidate.calculation.dueDate : null;
    if (envelope.id !== candidate.candidateId || envelope.type !== "task" || envelope.truth !== candidateTruth(candidate) || envelope.state !== candidate.state || envelope.status !== "active" || JSON.stringify(envelope.deadlines) !== JSON.stringify(due ? [due] : [])) throw new Error("Truth/frontmatter do not match managed payload");
    return payload;
  } catch { throw new ApiError(409, "deadline_record_invalid", "Managed deadline is damaged or was edited externally. Preserve the file and review it."); }
}
export function encodeDeadlineRecord(current: string | null, payload: DeadlinePayload, event: DeadlineDomainEvent): string {
  const previous = current === null ? null : parseDeadlineRecord(current);
  if (current !== null && !previous) throw new ApiError(409, "deadline_legacy", "Cannot overwrite a legacy record.");
  if (previous && (payload.revisions.length < previous.revisions.length || payload.events.length < previous.events.length || previous.events.some((value, i) => JSON.stringify(value) !== JSON.stringify(payload.events[i])) || previous.revisions.slice(0, -1).some((value, i) => JSON.stringify(value) !== JSON.stringify(payload.revisions[i])))) throw new ApiError(409, "deadline_history", "Deadline history cannot shrink or change.");
  const candidate = candidateSchema.parse(payload.revisions.at(-1));
  const next = payloadSchema.parse({ ...payload, events: [...payload.events, event] });
  const body = JSON.stringify(next);
  if (Buffer.byteLength(body) > 512 * 1024) throw new ApiError(409, "deadline_limit", "Archive review required; history is full.");
  return patchDeadlineEnvelope(current, { id: candidate.candidateId, jurisdiction: candidate.input.jurisdiction, status: "active", truth: candidateTruth(candidate), state: candidate.state, at: event.at, event: `${event.kind} ${event.id} ${event.revisionHash}`, deadlines: candidate.calculation.kind === "determinate" ? [candidate.calculation.dueDate] : [], body });
}
