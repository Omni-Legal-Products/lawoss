import ICAL from "ical.js";
import { ApiError } from "../../errors.js";
import { renderEventDraft } from "../../calendar-event-drafts/ics.js";
import { addDays } from "../../calendar/dates.js";
import { sha256 } from "./hash.js";
import type { ConfirmedDeadlineRecord } from "./types.js";
/** Pure projection; no connector, scheduler or calendar store is imported. */
function renderProjection(record: ConfirmedDeadlineRecord): { bytes: string; sha256: string; uid: string; sequence: number } {
  const bytes = renderEventDraft({ title: record.input.jurisdiction === "cz" ? "Lhůta" : "Lehota", description: `LAWOSS ${record.matterId}. Local ICS export only; review the current OKF. Imported calendars are not updated automatically.`, location: "", start: record.calculation.dueDate, end: addDays(record.calculation.dueDate, 1), timeZone: record.calculation.timeZone, organizer: "", url: "", attendees: "", reminders: [], googleMeet: false }, `lawoss-${record.candidateId}`, record.export.sequence, new Date(record.export.decidedAt));
  let output = bytes;
  if (record.export.cancelled) { const root = new ICAL.Component(ICAL.parse(bytes)); root.getFirstSubcomponent("vevent")!.updatePropertyWithValue("status", "CANCELLED"); output = root.toString() + "\r\n"; }
  return { bytes: output, sha256: sha256(output), uid: `lawoss-${record.candidateId}@legalwork.local`, sequence: record.export.sequence };
}

/** Production projection requires a committed confirmation/revocation shape. */
export function renderDeadlineIcs(record: ConfirmedDeadlineRecord): ReturnType<typeof renderProjection> {
  if ((record.state !== "confirmed" && record.state !== "revoked") || (record.state === "revoked") !== record.export.cancelled) throw new ApiError(409,"deadline_confirmation_required","A canonical confirmation or revocation is required for ICS export.");
  return renderProjection(record);
}
/** Clearly tentative preview: not a commit, receipt, file write or grant. */
export function renderDeadlineIcsPreview(record: ConfirmedDeadlineRecord): ReturnType<typeof renderProjection> { return renderProjection(record); }
