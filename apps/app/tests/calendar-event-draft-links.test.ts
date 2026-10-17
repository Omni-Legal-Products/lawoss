import { test } from "node:test";
import { strict as assert } from "node:assert";
import { CalendarEventDraftSchema } from "@legalwork/types/calendar-event-draft";
import { calendarComposeLink, calendarDraftLocalValue, calendarDraftModeTimes } from "../src/components/chat/calendar-event-draft-links";

const draft = CalendarEventDraftSchema.parse({ id: "00000000-0000-4000-8000-000000000001", workspaceId: "ws_test", revision: "00000000-0000-4000-8000-000000000002", sequence: 0, path: ".legalwork/calendar-drafts/event.ics", updatedAt: 1, title: "Meet & review? Grüße", location: "Office, room 2", description: "Details + notes\nNext line", start: "2026-10-13T14:00:00", end: "2026-10-13T15:00:00", timeZone: "Europe/Berlin", startInstant: "2026-10-13T12:00:00.000Z", endInstant: "2026-10-13T13:00:00.000Z" });
test("Google and Outlook links preserve event fields and the intended instant", () => {
  const google = new URL(calendarComposeLink(draft, "google")), outlook = new URL(calendarComposeLink(draft, "outlook"));
  assert.equal(google.host, "calendar.google.com"); assert.equal(google.searchParams.get("dates"), "20261013T120000Z/20261013T130000Z");
  assert.equal(google.searchParams.get("ctz"), "Europe/Berlin"); assert.equal(google.searchParams.get("text"), draft.title);
  assert.equal(google.searchParams.get("details"), draft.description); assert.equal(outlook.searchParams.get("subject"), draft.title);
  assert.equal(outlook.searchParams.get("startdt"), draft.startInstant); assert.equal(outlook.searchParams.get("allday"), "false");
});
test("all-day compose links preserve exclusive dates", () => {
  const event = { ...draft, start: "2026-10-13", end: "2026-10-14" };
  assert.equal(new URL(calendarComposeLink(event, "google")).searchParams.get("dates"), "20261013/20261014");
  const outlook = new URL(calendarComposeLink(event, "outlook")); assert.equal(outlook.searchParams.get("startdt"), event.start); assert.equal(outlook.searchParams.get("allday"), "true");
});
test("editor converts explicit offsets into the selected zone and tolerates incomplete edits", () => {
  assert.equal(calendarDraftLocalValue("2026-10-13T12:00:00Z", "Europe/Berlin"), "2026-10-13T14:00");
  assert.equal(calendarDraftLocalValue(draft.start, draft.timeZone), "2026-10-13T14:00");
  assert.doesNotThrow(() => calendarDraftLocalValue(draft.startInstant, "Europe/"));
});

test("switching all-day mode preserves the intended day and tolerates cleared dates", () => {
  assert.deepEqual(calendarDraftModeTimes({ ...draft, start: "2026-10-13", end: "2026-10-14" }, false), { start: "2026-10-13T09:00:00", end: "2026-10-13T10:00:00" });
  assert.deepEqual(calendarDraftModeTimes(draft, true), { start: "2026-10-13", end: "2026-10-14" });
  assert.deepEqual(calendarDraftModeTimes({ ...draft, start: "", end: "" }, true), { start: "", end: "" });
  assert.deepEqual(calendarDraftModeTimes({ ...draft, start: "", end: "" }, false), { start: "", end: "" });
});
