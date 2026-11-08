import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RecorderService, writeTranscriptFiles } from "./audio/recorder-service.mjs";
import { editTranscriptSpeakers } from "./audio/transcript-edit.mjs";

const segment = (id, speaker) => ({ id, speaker, text: `Sentence ${id}`, startMs: 10, endMs: 100, final: true });
const detail = { meta: { id: "test", speakerCount: 2 }, segments: [segment("a", 0), segment("b", 0), segment("c", 1)] };

test("rename, add, individual assignment, and bulk reassignment retain stable ids and original text", () => {
  let updated = editTranscriptSpeakers(detail, { type: "rename-speaker", speaker: 0, name: "  Chris  " });
  updated = editTranscriptSpeakers(updated, { type: "add-speaker", name: "Alex" });
  updated = editTranscriptSpeakers(updated, { type: "assign-segments", segmentIds: ["b"], speaker: 2 });
  assert.deepEqual(updated.segments.map(item => item.speaker), [0, 2, 1]);
  assert.equal(updated.meta.speakerNames[0], "Chris");
  assert.equal(updated.meta.speakerNames[2], "Alex");
  updated = editTranscriptSpeakers(updated, { type: "reassign-speaker", from: 0, to: 1 });
  assert.deepEqual(updated.segments.map(item => item.speaker), [1, 2, 1]);
  assert.equal(updated.meta.speakerNames[0], "Chris", "unused people remain assignable");
  updated = editTranscriptSpeakers(updated, { type: "assign-segments", segmentIds: ["a"], speaker: null });
  assert.equal(updated.segments[0].speaker, null);
  assert.deepEqual(updated.segments.map(({ speaker, ...rest }) => rest), detail.segments.map(({ speaker, ...rest }) => rest));
  assert.deepEqual(detail.segments.map(item => item.speaker), [0, 0, 1], "input is not mutated");
});

test("invalid speaker edits do not silently change unrelated segments", () => {
  for (const edit of [
    null, {}, { type: "rename-speaker", speaker: 999, name: "Chris" },
    { type: "rename-speaker", speaker: 0, name: " " },
    { type: "add-speaker", name: "x".repeat(121) },
    { type: "assign-segments", segmentIds: ["missing"], speaker: 0 },
    { type: "assign-segments", segmentIds: ["a"], speaker: -1 },
    { type: "reassign-speaker", from: 0, to: 99 },
    { type: "remove-speaker", speaker: 99, reassignTo: null },
    { type: "remove-speaker", speaker: 0, reassignTo: 0 },
    { type: "remove-speaker", speaker: 0, reassignTo: 99 },
    { type: "remove-speaker", speaker: 0 },
  ]) assert.throws(() => editTranscriptSpeakers(detail, edit));
});

test("removing speakers preserves every segment and supports reassignment, unused people, and the last speaker", () => {
  let updated = editTranscriptSpeakers(detail, { type: "add-speaker", name: "Unused" });
  updated = editTranscriptSpeakers(updated, { type: "remove-speaker", speaker: 2, reassignTo: null });
  assert.deepEqual(updated.segments, detail.segments);
  assert.equal(Object.hasOwn(updated.meta.speakerNames, 2), false);
  updated = editTranscriptSpeakers(updated, { type: "remove-speaker", speaker: 0, reassignTo: 1 });
  assert.deepEqual(updated.segments.map(item => item.speaker), [1, 1, 1]);
  assert.equal(Object.hasOwn(updated.meta.speakerNames, 0), false);
  assert.equal(updated.meta.speakerCount, 1);
  updated = editTranscriptSpeakers(updated, { type: "remove-speaker", speaker: 1, reassignTo: null });
  assert.deepEqual(updated.meta.speakerNames, {});
  assert.equal(updated.meta.speakerCount, 0);
  assert.ok(updated.segments.every(item => item.speaker === null));
  assert.deepEqual(updated.segments.map(({ speaker, ...rest }) => rest), detail.segments.map(({ speaker, ...rest }) => rest));
});

test("concurrent edits persist across reopen and regenerate readable transcript exports", async () => {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "lw-speaker-edit-"));
  const service = new RecorderService({ userDataDir });
  const folder = path.join(service.recordingsDir, "test");
  /** @type {import("@legalwork/types/audio").AudioRecordingMeta} */
  const meta = { ...detail.meta, title: "Test meeting", folderPath: folder, status: "complete", createdAt: 1, durationMs: 100, language: "en", sources: ["microphone"], modelId: null, audioPath: null, transcriptPath: null, sizeBytes: 0, segmentCount: 3, error: null };
  try {
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "meta.json"), JSON.stringify(meta));
    await writeTranscriptFiles(meta, detail.segments);
    await Promise.all([
      service.editTranscript("test", { type: "rename-speaker", speaker: 0, name: "Chris" }),
      service.editTranscript("test", { type: "assign-segments", segmentIds: ["c"], speaker: 0 }),
    ]);
    const reopened = new RecorderService({ userDataDir });
    const saved = await reopened.getRecording("test");
    assert.equal(saved.meta.speakerNames[0], "Chris");
    assert.deepEqual(saved.segments.map(item => item.speaker), [0, 0, 0]);
    for (const extension of ["txt", "srt", "md"]) {
      const text = await readFile(path.join(folder, `transcript.${extension}`), "utf8");
      assert.match(text, /Chris/); assert.doesNotMatch(text, /Speaker 2/);
    }
    assert.equal(JSON.parse(await readFile(path.join(folder, "transcript.json"), "utf8")).speakerNames[0], "Chris");
    await service.editTranscript("test", { type: "remove-speaker", speaker: 0, reassignTo: 1 });
    const removed = await reopened.getRecording("test");
    assert.deepEqual(removed.segments.map(item => item.speaker), [1, 1, 1]);
    assert.equal(Object.hasOwn(removed.meta.speakerNames, 0), false);
    for (const extension of ["txt", "srt", "md", "json"]) {
      const text = await readFile(path.join(folder, `transcript.${extension}`), "utf8");
      assert.doesNotMatch(text, /Chris/);
      assert.match(text, /Sentence a/);
    }
    await assert.rejects(service.editTranscript("../test", { type: "add-speaker", name: "X" }), /Invalid recording/);
    service.activeRecordings.set("test", { meta, segments: [], sizeBytes: 0, startedAt: 1, audioStream: null, resolveFinalized: null });
    await assert.rejects(service.editTranscript("test", { type: "add-speaker", name: "X" }), /Finish recording/);
  } finally { await rm(userDataDir, { recursive: true, force: true }); }
});
