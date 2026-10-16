import type { CalendarEventDraft } from "@legalwork/types/calendar-event-draft";

export function calendarComposeLink(draft: CalendarEventDraft, app: "google" | "outlook") {
  const allDay = draft.start.length === 10;
  const query = new URLSearchParams();
  if (app === "google") {
    const stamp = (value: string) => value.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    query.set("action", "TEMPLATE"); query.set("text", draft.title);
    query.set("details", [draft.description, draft.url].filter(Boolean).join("\n\n"));
    query.set("location", draft.location); query.set("ctz", draft.timeZone);
    query.set("dates", `${stamp(allDay ? draft.start : draft.startInstant)}/${stamp(allDay ? draft.end : draft.endInstant)}`);
    return `https://calendar.google.com/calendar/render?${query}`;
  }
  query.set("path", "/calendar/action/compose"); query.set("rru", "addevent");
  query.set("subject", draft.title); query.set("body", [draft.description, draft.url].filter(Boolean).join("\n\n"));
  query.set("location", draft.location); query.set("startdt", allDay ? draft.start : draft.startInstant);
  query.set("enddt", allDay ? draft.end : draft.endInstant); query.set("allday", String(allDay));
  return `https://outlook.office.com/calendar/0/deeplink/compose?${query}`;
}

export function calendarDraftLocalValue(value: string, zone: string) {
  if (value.length <= 19) return value.slice(0, 16);
  try {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (key: string) => parts.find(item => item.type === key)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
  } catch { return value.slice(0, 16); }
}

/** Keep the selected input mode stable while either date is temporarily empty. */
export function calendarDraftModeTimes(draft: Pick<CalendarEventDraft, "start" | "end" | "timeZone">, allDay: boolean) {
  const start = calendarDraftLocalValue(draft.start, draft.timeZone).slice(0, 10);
  const end = calendarDraftLocalValue(draft.end, draft.timeZone).slice(0, 10);
  const shift = (day: string, days: number) => {
    const date = new Date(`${day}T00:00:00Z`);
    if (!Number.isFinite(date.getTime())) return "";
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };
  if (allDay) return { start, end: end > start ? end : shift(start, 1) };
  // All-day ends are exclusive, so a one-day event becomes 09:00-10:00 that day.
  const lastDay = end ? shift(end, -1) : "";
  return { start: start ? `${start}T09:00:00` : "", end: lastDay ? `${lastDay < start ? start : lastDay}T10:00:00` : "" };
}
