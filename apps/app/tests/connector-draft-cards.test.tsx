import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DynamicToolUIPart } from "ai";
import { EmailDraftSchema } from "@legalwork/types/email-draft";
import { CalendarEventDraftSchema } from "@legalwork/types/calendar-event-draft";
import { isEmailDraftTool, parseEmailDraftCard } from "../src/components/chat/email-draft-card";
import { isCalendarEventDraftTool, parseCalendarEventDraftCard } from "../src/components/chat/calendar-event-draft-card";
import { ConnectorDraftActions } from "../src/components/chat/connector-draft-actions";

const metadata = { id: "b26d21f3-85ad-4c9f-a6ec-5249b2da280a", workspaceId: "project", revision: "e24143f1-b8b9-4a44-a497-8a3f2b3772b7", path: ".legalwork/draft", updatedAt: 0 };
const mail = EmailDraftSchema.parse({ ...metadata, subject: "Review", to: "client@example.com", connectorTarget: { connectorId: "gmail", connectionId: "local-account" } });
const calendar = CalendarEventDraftSchema.parse({ ...metadata, title: "Review", start: "2026-10-14", end: "2026-10-15", startInstant: "2026-10-14T00:00:00.000Z", endInstant: "2026-10-15T00:00:00.000Z", sequence: 0, connectorTarget: { connectorId: "outlook-calendar", connectionId: "local-account", calendarId: "primary" } });
const part = (extensionId: string, action: string, draft: unknown): DynamicToolUIPart => ({ type: "dynamic-tool", toolName: "legalwork_extension_call", toolCallId: "fixture-call", state: "output-available", input: { extensionId, action }, output: { ok: true, result: { draft } } });
const noop = () => {};

test("native connector tool outputs render the existing email and calendar cards, including send results", () => {
  expect(isEmailDraftTool(part("gmail", "create_draft", mail))).toBe(true);
  expect(isEmailDraftTool(part("outlook", "send_draft", mail))).toBe(true);
  expect(isCalendarEventDraftTool(part("outlook-calendar", "create_event", calendar))).toBe(true);
  expect(isCalendarEventDraftTool(part("google-calendar", "create_event", calendar))).toBe(true);
  expect(isCalendarEventDraftTool(part("google-calendar", "update_event", calendar))).toBe(true);
  expect(isEmailDraftTool(part("google-drive", "create_folder", mail))).toBe(false);
  expect(isCalendarEventDraftTool(part("gmail", "create_draft", mail))).toBe(false);
  expect(parseEmailDraftCard(part("gmail", "create_draft", mail).output)).toEqual(mail);
  expect(parseCalendarEventDraftCard(JSON.stringify(part("outlook-calendar", "create_event", calendar).output))).toEqual(calendar);
  expect(parseEmailDraftCard({ referenceData: { draft: mail } })).toEqual(mail);
  expect(parseEmailDraftCard({ ok: false, error: "failure" })).toBeNull();
});

test("provider actions separate Save, Send and Open and remove sending after success or an ambiguous result", () => {
  const initial = renderToStaticMarkup(<ConnectorDraftActions draft={mail} disabled={false} onSave={noop} onSend={noop} onOpen={noop} />);
  expect(initial).toContain("Save draft in Gmail"); expect(initial).toContain("Send"); expect(initial).not.toContain("Open in Gmail");
  const saved = renderToStaticMarkup(<ConnectorDraftActions draft={{ ...mail, delivery: { state: "saved", id: "provider-draft" } }} disabled={false} onSave={noop} onSend={noop} onOpen={noop} />);
  expect(saved).toContain("Open in Gmail"); expect(saved).toContain("Send"); expect(saved).not.toContain("Save draft in Gmail");
  for (const state of ["sent", "uncertain"] satisfies Array<"sent" | "uncertain">) {
    const output = renderToStaticMarkup(<ConnectorDraftActions draft={{ ...mail, delivery: { state } }} disabled={false} onSave={noop} onSend={noop} onOpen={noop} />);
    expect(output).not.toContain(">Send<"); expect(output).toContain("Open in Gmail");
  }
  const event = renderToStaticMarkup(<ConnectorDraftActions draft={calendar} disabled={false} onSave={noop} onOpen={noop} />);
  expect(event).toContain("Add to Outlook Calendar"); expect(event).not.toContain(">Send<");
  const update = CalendarEventDraftSchema.parse({ ...calendar, connectorTarget: { connectorId: "google-calendar", connectionId: "local-account", calendarId: "primary" }, googleCalendar: { requestId: metadata.id, conference: { status: "none" }, update: { eventId: "existing-event", etag: '"version"', original: calendar } } });
  const editing = renderToStaticMarkup(<ConnectorDraftActions draft={update} disabled={false} onSave={noop} onOpen={noop} />);
  expect(editing).toContain("Update in Google Calendar"); expect(editing).not.toContain("Add to Google Calendar");
});
