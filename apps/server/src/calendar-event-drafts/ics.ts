import ICAL from "ical.js";
import { emptyCalendar, serializeCalendar } from "../calendar/ical.js";
import { dayDate, zonedInstant } from "../calendar/dates.js";
import { ApiError } from "../errors.js";
import type { CalendarEventDraftInput } from "@legalwork/types/calendar-event-draft";

export function eventDraftTimes(input: CalendarEventDraftInput) {
  const allDay = input.start.length === 10;
  if (allDay !== (input.end.length === 10)) throw new ApiError(400, "calendar_event_dates", "Start and end must both be dates or both include a time.");
  const start = allDay ? dayDate(input.start).toISOString() : zonedInstant(input.start, input.timeZone);
  const end = allDay ? dayDate(input.end).toISOString() : zonedInstant(input.end, input.timeZone);
  if (end <= start) throw new ApiError(400, "calendar_event_dates", "The event must end after it starts. All-day end dates are exclusive.");
  return { startInstant: start, endInstant: end };
}

export function renderEventDraft(input: CalendarEventDraftInput, id: string, sequence: number, now = new Date()): string {
  const times = eventDraftTimes(input);
  const root = emptyCalendar(), event = new ICAL.Component("vevent");
  root.addPropertyWithValue("method", "PUBLISH");
  root.addPropertyWithValue("x-wr-timezone", input.timeZone);
  event.addPropertyWithValue("uid", `${id}@legalwork.local`);
  event.addPropertyWithValue("dtstamp", ICAL.Time.fromJSDate(now, true));
  event.addPropertyWithValue("sequence", sequence);
  event.addPropertyWithValue("summary", input.title);
  event.addPropertyWithValue("description", input.description);
  event.addPropertyWithValue("location", input.location);
  for (const [key, value, instant] of [["dtstart", input.start, times.startInstant], ["dtend", input.end, times.endInstant]]) {
    event.addPropertyWithValue(key, value.length === 10 ? ICAL.Time.fromDateString(value) : ICAL.Time.fromJSDate(new Date(instant), true));
  }
  if (input.url) event.addPropertyWithValue("url", input.url);
  if (input.organizer) event.addPropertyWithValue("organizer", `mailto:${input.organizer}`);
  for (const email of input.attendees.split(",").map(value => value.trim()).filter(Boolean)) {
    const attendee = new ICAL.Property("attendee"); attendee.setValue(`mailto:${email}`);
    attendee.setParameter("role", "REQ-PARTICIPANT"); event.addProperty(attendee);
  }
  for (const minutes of input.reminders) {
    const alarm = new ICAL.Component("valarm"); alarm.addPropertyWithValue("action", "DISPLAY");
    alarm.addPropertyWithValue("description", input.title); alarm.addPropertyWithValue("trigger", ICAL.Duration.fromSeconds(-minutes * 60)); event.addSubcomponent(alarm);
  }
  root.addSubcomponent(event);
  return serializeCalendar(root);
}
