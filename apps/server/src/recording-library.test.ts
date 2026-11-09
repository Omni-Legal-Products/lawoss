import { expect, test } from "bun:test";
import type { AudioRecordingMeta, AudioTranscriptSegment } from "@legalwork/types/audio";
import type { RecorderBridge } from "./types.js";
import { listRecordingLibrary, readRecordingTranscript } from "./recording-library.js";

function recording(id: string, date: string, extra: Partial<AudioRecordingMeta> = {}): AudioRecordingMeta {
  return { id, title: id, createdAt: Date.parse(date), durationMs: 12000, language: "auto", modelId: null,
    sources: ["microphone"], folderPath: "/private/recordings", audioPath: null, transcriptPath: null,
    sizeBytes: 100, segmentCount: 0, status: "complete", error: null, ...extra };
}
function source(items: AudioRecordingMeta[], segments: AudioTranscriptSegment[] = []) {
  const recorder: RecorderBridge = {
    status: () => ({ available: true, recordingActive: false, liveTranscriptActive: false, fileName: null, error: null }),
    setLiveTranscript(_enabled, workspacePath) { return this.status(workspacePath); },
    listRecordings: async () => items,
    readRecording: async id => { const meta = items.find(item => item.id === id); return meta ? { meta, segments } : null; },
  };
  return { recorder, workspaces: [] };
}

test("yesterday includes global and all project recordings using the local calendar date", async () => {
  const data = source([
    recording("global", "2026-10-19T22:00:00Z"), // Oct 20 in Berlin
    recording("project-a", "2026-10-20T12:00:00Z", { projectIds: ["a"] }),
    recording("project-b", "2026-10-20T21:59:59Z", { projectIds: ["b"], speakerNames: { "0": "Johann" } }),
    recording("today", "2026-10-20T22:00:00Z"),
    recording("dictation", "2026-10-20T13:00:00Z", { ephemeral: true }),
  ]);
  const now = Date.parse("2026-10-21T08:00:00Z");
  const all = await listRecordingLibrary(data, { period: "yesterday", timeZone: "Europe/Berlin" }, now);
  expect(all.totalMatches).toBe(3);
  expect(all.recordings.map(item => item.id)).toEqual(["project-b", "project-a", "global"]);
  expect(all.recordings.every(item => item.localDate === "2026-10-20")).toBe(true);
  expect(JSON.stringify(all)).not.toContain("/private/");
  expect((await listRecordingLibrary(data, { projectId: "a" }, now)).recordings.map(item => item.id)).toEqual(["project-a"]);
  expect((await listRecordingLibrary(data, { query: "PROJECT-B" }, now)).recordings.map(item => item.id)).toEqual(["project-b"]);
  expect(JSON.stringify(all)).not.toContain("Johann");
  expect((await listRecordingLibrary(data, { query: "JOHANN" }, now)).recordings).toEqual([]);
  expect((await listRecordingLibrary(data, { scope: "global", period: "yesterday", timeZone: "Europe/Berlin" }, now)).recordings.map(item => item.id)).toEqual(["global"]);
});

test("yesterday covers the entire 25-hour daylight saving transition day", async () => {
  const data = source([
    recording("first", "2026-10-24T22:00:00Z"),
    recording("last", "2026-10-25T22:59:59Z"),
    recording("next", "2026-10-25T23:00:00Z"),
  ]);
  expect((await listRecordingLibrary(data, { period: "yesterday", timeZone: "Europe/Berlin" }, Date.parse("2026-10-26T08:00:00Z"))).totalMatches).toBe(2);
});

test("pagination carries filters and excludes new recordings without losing timestamp ties", async () => {
  const items = ["a", "b", "c"].map(id => recording(id, "2026-10-20T10:00:00Z", { projectIds: ["p"] }));
  const data = source(items);
  const first = await listRecordingLibrary(data, { projectId: "p", limit: 1 }, Date.parse("2026-10-21T00:00:00Z"));
  expect(first.recordings.map(item => item.id)).toEqual(["c"]);
  items.unshift(recording("new", "2026-10-21T01:00:00Z", { projectIds: ["p"] }));
  const second = await listRecordingLibrary(data, { cursor: first.nextCursor, limit: 1 });
  const third = await listRecordingLibrary(data, { cursor: second.nextCursor, limit: 1 });
  expect(second.recordings.map(item => item.id)).toEqual(["b"]);
  expect(third.recordings.map(item => item.id)).toEqual(["a"]);
  expect(second.totalMatches).toBe(3);
  expect(third.nextCursor).toBeNull();
  await expect(listRecordingLibrary(data, { cursor: first.nextCursor, query: "different" })).rejects.toMatchObject({ status: 400 });
  await expect(listRecordingLibrary(data, { cursor: "nonsense" })).rejects.toMatchObject({ status: 400 });
});

test("transcript reads reflect speaker corrections, skip partials, and page long recordings", async () => {
  const meta = recording("meeting", "2026-10-20T10:00:00Z", { status: "recording", speakerNames: { "0": "Michael" } });
  const data = source([meta], [
    { id: "s1", startMs: 3600000, endMs: 3610000, text: "Hello. ".repeat(500), speaker: 0, final: true },
    { id: "s2", startMs: 3620000, endMs: 3630000, text: "Yes.", speaker: 1, final: true },
    { id: "partial", startMs: 3640000, endMs: 3650000, text: "Do not include partial speech", final: false },
  ]);
  let offset = 0, combined = "";
  while (true) {
    const page = await readRecordingTranscript(data, "meeting", { offset, limit: 1000 });
    expect(page.live).toBe(true);
    expect(page.recording.segmentCount).toBe(2);
    combined += page.content;
    if (page.nextOffset === null) { expect(combined.length).toBe(page.totalCharacters); break; }
    offset = page.nextOffset;
  }
  expect(combined).toStartWith("[1:00:00] Michael: Hello.");
  expect(combined).toEndWith("[1:00:20] Speaker 2: Yes.");
  expect(combined).not.toContain("partial speech");
  meta.speakerNames = { "0": "Chris" };
  expect((await readRecordingTranscript(data, "meeting", {})).content).toStartWith("[1:00:00] Chris:");
});

test("unavailable, missing and invalid requests are not reported as empty libraries", async () => {
  await expect(listRecordingLibrary({ workspaces: [], recorder: null }, {})).rejects.toMatchObject({ status: 503 });
  await expect(readRecordingTranscript({ workspaces: [], recorder: null }, "missing", {})).rejects.toMatchObject({ status: 503 });
  const data = source([recording("temporary", "2026-10-20T10:00:00Z", { ephemeral: true })]);
  await expect(readRecordingTranscript(data, "temporary", {})).rejects.toMatchObject({ status: 404 });
  await expect(readRecordingTranscript(data, "missing", {})).rejects.toMatchObject({ status: 404 });
  await expect(readRecordingTranscript(data, "../secret", {})).rejects.toThrow();
  await expect(listRecordingLibrary(data, { period: "yesterday", from: "2026-10-20" })).rejects.toMatchObject({ status: 400 });
  await expect(listRecordingLibrary(data, { from: "2026-10-21", to: "2026-10-20" })).rejects.toMatchObject({ status: 400 });
  await expect(listRecordingLibrary(data, { timeZone: "invalid" })).rejects.toThrow();
});
