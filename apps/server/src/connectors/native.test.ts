import { afterEach, expect, test } from "bun:test";
import { googleCalendarAdapter, outlookCalendarAdapter, calendarEventsInput, calendarCreateInput } from "./calendar.js";
import { googleDriveAdapter, microsoftFilesAdapter, fileListInput, fileDownloadInput, driveListInput } from "./files.js";
import { boundedDownload, microsoftDownload, MAX_CONNECTOR_DOWNLOAD } from "./native.js";
import { callConnectorExtensionAction, CONNECTOR_EXTENSION_ACTIONS } from "./index.js";
import type { ServerConfig } from "../types.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const range = { timeMin: "2026-10-25T00:00:00+02:00", timeMax: "2026-10-26T00:00:00+01:00" };

test("Google Calendar expands recurring occurrences and preserves DST offsets and pagination", async () => {
  let url: URL | undefined;
  const result = await googleCalendarAdapter.events(async (path) => {
    url = new URL(path, "https://www.googleapis.com");
    return { items: [{ id: "occurrence-1", summary: "Hearing", start: { dateTime: "2026-10-25T10:00:00+01:00" }, end: { dateTime: "2026-10-25T11:00:00+01:00" } }], nextPageToken: "opaque-next" };
  }, calendarEventsInput.parse({ ...range, calendarId: "client/calendar", pageToken: "opaque-current" }));
  expect(url?.pathname).toBe("/calendar/v3/calendars/client%2Fcalendar/events");
  expect(url?.searchParams.get("singleEvents")).toBe("true");
  expect(url?.searchParams.get("timeMin")).toBe(range.timeMin);
  expect(url?.searchParams.get("timeMax")).toBe(range.timeMax);
  expect(url?.searchParams.get("pageToken")).toBe("opaque-current");
  expect(result.events[0].start).toBe("2026-10-25T10:00:00+01:00");
  expect(result.nextPageToken).toBe("opaque-next");
});

test("Google event reads expose conference status, attendees and provider versions without loading conference icons", async () => {
  const paths: string[] = [];
  const result = await googleCalendarAdapter.get(async path => {
    paths.push(path);
    return { id: "event", etag: '"version"', attendees: [{ email: "guest@example.com", responseStatus: "accepted" }], organizer: { email: "owner@example.com" }, recurringEventId: "series", conferenceData: { createRequest: { status: { statusCode: "success" } }, conferenceSolution: { key: { type: "hangoutsMeet" }, iconUri: "https://remote-icon.example/icon.png" }, entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/aaa-bbbb-ccc" }] } };
  }, { eventId: "event", calendarId: "primary" });
  expect(paths).toEqual(["/calendar/v3/calendars/primary/events/event"]);
  expect(result.etag).toBe('"version"');
  expect(result.recurringEventId).toBe("series");
  expect(result.attendees[0].responseStatus).toBe("accepted");
  expect(result.conference).toEqual({ status: "success", type: "hangoutsMeet", url: "https://meet.google.com/aaa-bbbb-ccc" });
  expect(JSON.stringify(result)).not.toContain("remote-icon");
});

test("Google-only edit and Meet capabilities do not advertise unsupported Outlook actions", () => {
  const google = CONNECTOR_EXTENSION_ACTIONS.filter(item => item.extensionId === "google-calendar");
  const outlook = CONNECTOR_EXTENSION_ACTIONS.filter(item => item.extensionId === "outlook-calendar");
  expect(google.find(item => item.action === "update_event")?.writes).toBe(true);
  expect(JSON.stringify(google.find(item => item.action === "create_event")?.inputSchema)).toContain("googleMeet");
  expect(outlook.some(item => item.action === "update_event")).toBe(false);
  expect(JSON.stringify(outlook.find(item => item.action === "create_event")?.inputSchema)).not.toContain("googleMeet");
});

test("calendar creation validates dates and never adds invitees", async () => {
  const invalid = [
    { start: "2026-10-13T09:00:00", end: "2026-10-13T10:00:00" },
    { start: "2026-10-13", end: "2026-10-14" },
    { start: "2026-10-14", end: "2026-10-13", allDay: true },
    { start: "2026-10-13", end: "2026-10-14", allDay: true, attendees: ["client@example.com"] },
  ];
  for (const dates of invalid) expect(calendarCreateInput.safeParse({ title: "Hearing", ...dates }).success).toBe(false);
  const calls: { path: string; body: unknown }[] = [];
  const input = calendarCreateInput.parse({ title: "Hearing", start: "2026-10-13", end: "2026-10-14", allDay: true });
  await googleCalendarAdapter.create(async (path, options) => {
    calls.push({ path, body: options?.body });
    return { id: "event", start: { date: input.start }, end: { date: input.end } };
  }, input);
  expect(calls[0].path).toContain("sendUpdates=none");
  expect(calls[0].body).toMatchObject({ start: { date: "2026-10-13" }, end: { date: "2026-10-14" } });
  expect(calls[0].body).not.toHaveProperty("attendees");
  await outlookCalendarAdapter.create(async (path, options) => {
    calls.push({ path, body: options?.body });
    return { id: "event", start: { dateTime: input.start, timeZone: "UTC" }, end: { dateTime: input.end, timeZone: "UTC" } };
  }, input);
  expect(calls[1].body).toMatchObject({ isAllDay: true, attendees: [], start: { dateTime: "2026-10-13T00:00:00", timeZone: "UTC" } });
});

test("Outlook Calendar uses calendarView and refuses pagination into mail", async () => {
  const paths: string[] = [];
  const result = await outlookCalendarAdapter.events(async (path) => {
    paths.push(path);
    return { value: [{ id: "meeting", subject: "Conference", start: { dateTime: "2026-10-25T10:00:00", timeZone: "UTC" }, end: { dateTime: "2026-10-25T11:00:00", timeZone: "UTC" } }] };
  }, calendarEventsInput.parse(range));
  expect(paths[0]).toStartWith("/v1.0/me/calendar/calendarView?");
  expect(result.events[0].timeZone).toBe("UTC");
  await expect(outlookCalendarAdapter.events(async () => ({}), calendarEventsInput.parse({ ...range, pageToken: "https://graph.microsoft.com/v1.0/me/messages" }))).rejects.toMatchObject({ code: "invalid_page_token" });
});

test("Google Drive search escapes literals and downloads native documents through export", async () => {
  const paths: string[] = [];
  const files = await googleDriveAdapter.list(async (path) => { paths.push(path); return { files: [], nextPageToken: "next" }; }, fileListInput.parse({ query: "client's contract", folderId: "folder" }));
  expect(new URL(paths[0], "https://www.googleapis.com").searchParams.get("q")).toBe("trashed = false and 'folder' in parents and fullText contains 'client\\'s contract'");
  expect(files.nextPageToken).toBe("next");
  const result = await googleDriveAdapter.download(async (path, options) => {
    paths.push(path);
    return options?.bytes ? { dataBase64: "cGRm", size: 3, mimeType: "application/pdf" } : { id: "doc", name: "Contract", mimeType: "application/vnd.google-apps.document" };
  }, fileDownloadInput.parse({ fileId: "doc" }));
  expect(paths[2]).toBe("/drive/v3/files/doc/export?mimeType=application%2Fpdf");
  expect(result.filename).toBe("Contract.pdf");
});

test("SharePoint requires a document library and keeps pagination on that library", async () => {
  const adapter = microsoftFilesAdapter({ sharepoint: true });
  const calls: string[] = [];
  const request = async (path: string) => { calls.push(path); return { value: [] }; };
  await expect(adapter.list(request, fileListInput.parse({}))).rejects.toMatchObject({ code: "connector_drive_required" });
  await expect(adapter.drives(request, driveListInput.parse({}))).rejects.toMatchObject({ code: "connector_site_required" });
  expect(calls).toHaveLength(0);
  await adapter.list(request, fileListInput.parse({ driveId: "library", folderId: "folder" }));
  expect(calls[0]).toStartWith("/v1.0/drives/library/items/folder/children?");
  await expect(adapter.list(request, fileListInput.parse({ driveId: "library", pageToken: "https://graph.microsoft.com/v1.0/me/drive/root/children" }))).rejects.toMatchObject({ code: "invalid_page_token" });
});

test("Microsoft download URLs stay private and receive no bearer token", async () => {
  const calls: { url: string; headers: Headers }[] = [];
  globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ url: input.toString(), headers: new Headers(init?.headers) });
    expect(init?.redirect).toBe("error");
    return new Response("private file", { headers: { "Content-Type": "text/plain" } });
  }, { preconnect: originalFetch.preconnect });
  const metadata = { id: "file", name: "Contract.txt", size: 12, file: { mimeType: "text/plain" }, "@microsoft.graph.downloadUrl": "https://firm-my.sharepoint.com/download?temporary-secret=one" };
  const adapter = microsoftFilesAdapter();
  expect(JSON.stringify(await adapter.get(async () => metadata, { fileId: "file" }))).not.toContain("temporary-secret");
  const result = await adapter.download(async () => metadata, fileDownloadInput.parse({ fileId: "file" }));
  expect(Buffer.from(result.dataBase64, "base64").toString()).toBe("private file");
  expect(calls[0].headers.has("Authorization")).toBe(false);
  expect(JSON.stringify(result)).not.toContain("temporary-secret");
  for (const url of ["https://attacker.test/file", "http://firm.sharepoint.com/file", "https://firm.sharepoint.com.attacker.test/file", "https://127.0.0.1/file", "https://firm.sharepoint.com:444/file"]) {
    await expect(microsoftDownload(url)).rejects.toMatchObject({ code: "connector_invalid_download" });
  }
  expect(calls).toHaveLength(1);
});

test("personal OneDrive uses its own resource API and legacy download annotation", async () => {
  let path = "";
  const item = await microsoftFilesAdapter({ personal: true }).get(async (value) => {
    path = value; return { id: "file", name: "Personal.pdf", file: { mimeType: "application/pdf" }, "@content.downloadUrl": "https://a.files.1drv.com/private" };
  }, { fileId: "file" });
  expect(path).toBe("/v1.0/drive/items/file");
  expect(JSON.stringify(item)).not.toContain("downloadUrl");
});

test("downloads enforce size from both metadata and chunked responses", async () => {
  const paths: string[] = [];
  await expect(googleDriveAdapter.download(async (path) => {
    paths.push(path); return { id: "large", name: "Large.pdf", mimeType: "application/pdf", size: String(MAX_CONNECTOR_DOWNLOAD + 1) };
  }, fileDownloadInput.parse({ fileId: "large" }))).rejects.toMatchObject({ code: "connector_file_too_large" });
  expect(paths).toHaveLength(1);
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(MAX_CONNECTOR_DOWNLOAD + 1)); controller.close(); } });
  await expect(boundedDownload(new Response(stream))).rejects.toMatchObject({ code: "connector_file_too_large" });
});

test("read-only mode blocks both calendar writes before authentication", async () => {
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "test", hostToken: "test", configPath: "/tmp/unused-connector-test.json",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: true,
    startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  for (const id of ["google-calendar", "outlook-calendar"]) {
    await expect(callConnectorExtensionAction(config, id, "create_event", { title: "Hearing", start: "2026-10-13", end: "2026-10-14", allDay: true }, {})).rejects.toMatchObject({ code: "read_only" });
  }
  for (const action of CONNECTOR_EXTENSION_ACTIONS.filter((item) => item.writes)) {
    await expect(callConnectorExtensionAction(config, action.extensionId, action.action, {}, {})).rejects.toMatchObject({ code: "read_only" });
  }
});
