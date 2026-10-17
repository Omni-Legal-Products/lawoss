import { test } from "node:test";
import { strict as assert } from "node:assert";
import ICAL from "ical.js";
import { CalendarEventDraftInputSchema } from "@legalwork/types/calendar-event-draft";
import { eventDraftTimes, renderEventDraft } from "./ics.js";
import { readDraft, saveDraftFiles } from "../email-drafts/store.js";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const input = CalendarEventDraftInputSchema.parse({ title: "Conference : Grüße", description: "Line one\nLine two, details; review", location: "Office, room 2", start: "2026-10-13T14:00:00", end: "2026-10-13T15:00:00", timeZone: "Europe/Berlin", organizer: "lawyer@example.com", attendees: "client@example.com, colleague@example.com", url: "https://example.com/meeting" });
test("exports editable event details, UTC times, guests and reminders in valid ICS", () => {
  const ics = renderEventDraft(input, "event", 0), root = ICAL.Component.fromString(ics), event = root.getFirstSubcomponent("vevent");
  assert.ok(event); assert.equal(root.getFirstPropertyValue("method"), "PUBLISH");
  assert.equal(event.getFirstPropertyValue("summary"), input.title); assert.equal(event.getFirstPropertyValue("description"), input.description);
  assert.equal(event.getFirstPropertyValue("location"), input.location); assert.equal(event.getFirstPropertyValue("organizer"), "mailto:lawyer@example.com");
  assert.equal(String(event.getFirstPropertyValue("dtstart")), "2026-10-13T12:00:00Z");
  assert.equal(event.getAllProperties("attendee").length, 2); assert.equal(event.getAllSubcomponents("valarm").length, 1);
  assert.equal(String(event.getFirstSubcomponent("valarm")?.getFirstPropertyValue("trigger")), "-PT15M");
});
test("all-day dates have exclusive ends and never change with the host time zone", () => {
  const event = ICAL.Component.fromString(renderEventDraft({ ...input, start: "2026-10-13", end: "2026-10-14" }, "all-day", 0)).getFirstSubcomponent("vevent");
  assert.ok(event); assert.equal(String(event.getFirstPropertyValue("dtstart")), "2026-10-13"); assert.equal(String(event.getFirstPropertyValue("dtend")), "2026-10-14");
  assert.throws(() => eventDraftTimes({ ...input, start: "2026-10-13", end: "2026-10-13" }), /end after/);
  assert.throws(() => eventDraftTimes({ ...input, end: "2026-10-14" }), /both/);
});
test("rejects DST gaps and folds, accepts explicit offsets and escapes ICS text", () => {
  assert.throws(() => eventDraftTimes({ ...input, start: "2026-03-29T02:30:00", end: "2026-03-29T04:00:00" }), /ambiguous/);
  assert.throws(() => eventDraftTimes({ ...input, start: "2026-10-25T02:30:00", end: "2026-10-25T04:00:00" }), /ambiguous/);
  assert.equal(eventDraftTimes({ ...input, start: "2026-10-25T02:30:00+02:00", end: "2026-10-25T03:30:00+01:00" }).startInstant, "2026-10-25T00:30:00.000Z");
  const event = ICAL.Component.fromString(renderEventDraft({ ...input, title: "Meet\nATTENDEE:evil@example.com" }, "safe", 0)).getFirstSubcomponent("vevent");
  assert.ok(event); assert.equal(event.getAllProperties("attendee").length, 2); assert.equal(event.getFirstPropertyValue("summary"), "Meet\nATTENDEE:evil@example.com");
});
test("calendar files use the same revision-protected draft persistence", async () => {
  const root = await mkdtemp(join(tmpdir(), "legalwork-event-"));
  try {
    const draft = await saveDraftFiles(root, "ws_test", "calendar", async id => ({ input: { ...input, ...eventDraftTimes(input), sequence: 0 }, content: renderEventDraft(input, id, 0) }));
    assert.match(draft.path, /^\.legalwork\/calendar-drafts\/.*\.ics$/);
    assert.deepEqual(await readDraft(root, draft.id, "calendar"), draft);
    assert.ok((await readFile(join(root, draft.path), "utf8")).includes("BEGIN:VEVENT"));
    await saveDraftFiles(root, "ws_test", "calendar", async id => ({ input: { ...input, title: "Human edit", sequence: 1 }, content: renderEventDraft({ ...input, title: "Human edit" }, id, 1) }), draft);
    await assert.rejects(saveDraftFiles(root, "ws_test", "calendar", async () => ({ input, content: "stale" }), draft), /changed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
