/** Host evidence is derived at read time, never authority embedded in Markdown. */
import { recordRevision, type OkfRecord } from "../okf-pamat/src/record.ts";
export type DeadlineWorkflowEvidence = Readonly<Record<string, { recordFingerprint: string; revisionHash: string; receiptId: string | null; trusted: boolean }>>;
export function isManagedDeadline(record: OkfRecord): boolean {
  return record.id.startsWith("deadline_") || Boolean(record.tags?.some(tag => tag.startsWith("lawoss-deadline"))) || Boolean(record.sections?.some(section => section.heading.startsWith("LAWOSS deadline workflow")));
}
export function managedDeadlineTrusted(record: OkfRecord, evidence?: DeadlineWorkflowEvidence): boolean {
  if (!isManagedDeadline(record)) return false;
  const proof = evidence?.[record.id];
  if (!proof?.trusted || !proof.receiptId || proof.recordFingerprint !== recordRevision(record) || record.state !== "confirmed") return false;
  try {
    const sections = record.sections?.filter(section => section.heading.startsWith("LAWOSS deadline workflow"));
    if (sections?.length !== 1 || sections[0]?.heading !== "LAWOSS deadline workflow v1") return false;
    const payload: unknown = JSON.parse(sections[0].body);
    if (!payload || typeof payload !== "object" || !("version" in payload) || payload.version !== 1 || !("revisions" in payload) || !Array.isArray(payload.revisions)) return false;
    const latest: unknown = payload.revisions.at(-1);
    return !!latest && typeof latest === "object" && "revisionHash" in latest && latest.revisionHash === proof.revisionHash && "state" in latest && latest.state === "confirmed";
  } catch { return false; }
}
