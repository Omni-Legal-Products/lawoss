import { expect, test } from "bun:test";
import { calendarEventsInput, outlookCalendarAdapter } from "./calendar.js";
import type { ConnectorRequest } from "./request.js";

const input = calendarEventsInput.parse({ calendarId: "personal", timeMin: "2026-10-26T00:00:00Z", timeMax: "2026-11-02T00:00:00Z" });
test("Outlook all-day dates retain their original Windows time zone after UTC conversion", async () => {
  const calls: { path: string; prefer?: string }[] = [];
  const request: ConnectorRequest = async (path, options) => {
    calls.push({ path, prefer: options?.headers?.Prefer });
    const event = { id: "all-day", subject: "All day", isAllDay: true, originalStartTimeZone: "W. Europe Standard Time", type: "occurrence", start: { dateTime: "2026-10-25T23:00:00", timeZone: "UTC" }, end: { dateTime: "2026-10-27T23:00:00", timeZone: "UTC" } };
    if (path.includes("calendarView")) return { value: [event] };
    return { ...event, start: { dateTime: "2026-10-26T00:00:00", timeZone: "W. Europe Standard Time" }, end: { dateTime: "2026-10-28T00:00:00", timeZone: "W. Europe Standard Time" } };
  };
  const page = await outlookCalendarAdapter.events(request, input);
  expect(page.events[0]).toMatchObject({ start: "2026-10-26T00:00:00", end: "2026-10-28T00:00:00", timeZone: "W. Europe Standard Time", allDay: true, recurring: true });
  expect(calls).toHaveLength(2);
  expect(calls[1]).toEqual({ path: "/v1.0/me/calendars/personal/events/all-day", prefer: 'outlook.timezone="W. Europe Standard Time", outlook.body-content-type="text"' });
});
test("timed Outlook occurrences stay in UTC without additional provider calls", async () => {
  let calls = 0;
  const request: ConnectorRequest = async () => { calls++; return { value: [{ id: "timed", subject: "Meeting", originalStartTimeZone: "W. Europe Standard Time", type: "exception", start: { dateTime: "2026-10-26T23:30:00", timeZone: "UTC" }, end: { dateTime: "2026-10-27T00:30:00", timeZone: "UTC" } }] }; };
  const page = await outlookCalendarAdapter.events(request, input);
  expect(page.events[0]).toMatchObject({ start: "2026-10-26T23:30:00", timeZone: "UTC", recurring: true });
  expect(calls).toBe(1);
});
test("UTC-midnight all-day events need no additional fetch when their original zone currently uses UTC", async () => {
  let calls = 0;
  const request: ConnectorRequest = async () => { calls++; return { value: [{ id: "holiday", isAllDay: true, originalStartTimeZone: "GMT Standard Time", start: { dateTime: "2026-12-25T00:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-12-26T00:00:00.0000000", timeZone: "UTC" } }] }; };
  expect((await outlookCalendarAdapter.events(request, input)).events[0]).toMatchObject({ start: "2026-12-25T00:00:00.0000000", allDay: true });
  expect(calls).toBe(1);
});
