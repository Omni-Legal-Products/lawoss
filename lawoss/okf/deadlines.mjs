// Portable canonical parser/writer seam; included in the Node server bundle.
import { parseRecord, serializeRecord, recordRevision } from "../okf-pamat/src/record.ts";
import { planWrite } from "../okf-pamat/src/write.ts";
import { withRecordWriteLock } from "../okf-pamat/src/store.ts";
export { withRecordWriteLock };
const heading = "LAWOSS deadline workflow v1";
export function readDeadlineEnvelope(text) {
  const record = parseRecord(text);
  const sections = (record.sections ?? []).filter(section => section.heading.startsWith("LAWOSS deadline workflow"));
  if (!sections.length && !record.tags?.some(tag => tag.startsWith("lawoss-deadline")) && !record.id.startsWith("deadline_")) return null;
  if (sections.length !== 1 || sections[0].heading !== heading || !record.tags?.includes("lawoss-deadline-v1")) throw new Error("Invalid managed deadline marker.");
  return { id: record.id, type: record.type, status: record.status, truth: record.truth, deadlines: record.deadlines ?? [], state: record.state, body: sections[0].body.trim(), fingerprint: recordRevision(record) };
}
export function patchDeadlineEnvelope(text, patch) {
  const before = text === null ? undefined : parseRecord(text);
  const record = { ...(before ?? { okf: 0.2, id: patch.id, type: "task", layer: "L2", jurisdiction: patch.jurisdiction, title: "Lehota / Lhůta", description: "Managed deadline; native review required.", created: patch.at.slice(0,10), timeline: [], truth: "" }), status: patch.status, updated: patch.at.slice(0,10), truth: patch.truth, state: patch.state, deadlines: patch.deadlines, tags: [...new Set([...(before?.tags ?? []), "lawoss-deadline-v1"])], timeline: [...(before?.timeline ?? []), { date: patch.at.slice(0,10), text: patch.event, kind: "deadline_workflow" }], sections: [...(before?.sections ?? []).filter(section => !section.heading.startsWith("LAWOSS deadline workflow")), { heading, body: patch.body }] };
  planWrite(before, record, patch.event);
  return serializeRecord(record);
}
