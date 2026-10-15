import { describe, expect, test } from "bun:test";
import { createProjectSyncFirstFailureTiming } from "./project-sync-first-failure-timing.js";

const enabled = { LAWOSS_PROJECT_SYNC_TEST_DIAGNOSTICS: "1", CI: "true", GITHUB_ACTIONS: "true" };
const prefix = "LAWOSS_PROJECT_SYNC_FIRST_FAILURE ";

function fixture(env: Readonly<Record<string, string | undefined>> = enabled) {
  let time = 0;
  let reads = 0;
  const frames: string[] = [];
  const observer = createProjectSyncFirstFailureTiming({
    env,
    now: () => { reads++; return time; },
    write: (frame) => { frames.push(frame); },
  });
  return { observer, frames, advance: (value: number) => { time = value; }, reads: () => reads };
}

function payload(frame: string) {
  expect(frame.startsWith(prefix)).toBe(true);
  expect(frame.endsWith("\n")).toBe(true);
  expect(Buffer.byteLength(frame, "utf8")).toBeLessThanOrEqual(8192);
  return JSON.parse(frame.slice(prefix.length));
}

describe("first project-sync failure statement observation", () => {
  test("requires all three exact flags, reads no disabled clock and keeps a passing fixture quiet", () => {
    for (const [key, expected] of Object.entries(enabled)) {
      for (const value of [undefined, "", "TRUE", "false", "0", "1 ", "1", "true"].filter((value) => value !== expected)) {
        const f = fixture({ ...enabled, [key]: value });
        f.observer.enter(25);
        f.observer.failed();
        f.observer.settled();
        f.observer.cleanupEntry(3);
        f.observer.cleanupExit(true, 2);
        expect(f.frames).toEqual([]);
        expect(f.reads()).toBe(0);
      }
    }
    const missing = fixture({});
    missing.observer.cleanupEntry(0);
    expect(missing.reads()).toBe(0);
    expect(missing.frames).toEqual([]);
    const f = fixture();
    f.observer.enter(39);
    f.observer.done(39);
    f.observer.complete();
    f.observer.settled();
    f.observer.cleanupEntry(0);
    f.observer.cleanupExit(false, 0);
    expect(f.frames).toEqual([]);
  });

  test("freezes pending outer statement 25 at cleanup entry without inventing terminal cleanup", () => {
    const f = fixture();
    f.observer.enter(24);
    f.observer.done(24);
    f.observer.enter(25);
    f.advance(5000);
    f.observer.cleanupEntry(4);
    expect(f.frames).toHaveLength(1);
    expect(payload(f.frames[0])).toMatchObject({
      protocol: "project-sync-first-failure", schema: 1, case: "revoke", kind: "body",
      elapsedMs: 5000, bodyComplete: false, bodySettled: false, bodyFailed: false,
      currentStatement: 25, lastCompletedStatement: 24, cleanupCount: 4, dropped: 0,
    });
    f.advance(9000);
    expect(f.frames).toHaveLength(1);
  });

  test("late A continuations cannot mutate its bytes or B after A freezes", () => {
    const a = fixture();
    a.observer.enter(25);
    a.observer.cleanupEntry(1);
    const bytes = a.frames[0];
    const b = fixture();
    b.observer.enter(3);
    a.advance(12000);
    a.observer.done(25);
    a.observer.failed();
    a.observer.complete();
    a.observer.settled();
    a.observer.cleanupEntry(500);
    expect(a.frames).toEqual([bytes]);
    b.observer.cleanupEntry(2);
    expect(payload(b.frames[0])).toMatchObject({ currentStatement: 3, bodyFailed: false, bodySettled: false });
    expect(payload(bytes)).toMatchObject({ currentStatement: 25, bodyFailed: false, bodySettled: false });
  });

  test("body rethrow and the unchanged miniature LIFO drain preserve identity, fail-fast and remainder", async () => {
    const bodyError = { privateText: "private-body-error" };
    const cleanupError = { privateText: "private-cleanup-error" };
    for (const env of [{}, enabled]) {
      const f = fixture(env);
      let caughtBody: unknown;
      try {
        try {
          f.observer.enter(12);
          throw bodyError;
        } catch (error) {
          f.observer.failed();
          throw error;
        } finally {
          f.observer.settled();
        }
      } catch (error) { caughtBody = error; }
      const calls: number[] = [];
      const cleanups = [
        async () => { calls.push(1); },
        async () => { calls.push(2); throw cleanupError; },
        async () => { calls.push(3); },
      ];
      f.observer.cleanupEntry(cleanups.length);
      let caughtCleanup: unknown;
      try {
        try {
          while (cleanups.length) await cleanups.pop()?.();
        } catch (error) {
          f.observer.cleanupExit(true, cleanups.length);
          throw error;
        }
        f.observer.cleanupExit(false, cleanups.length);
      } catch (error) { caughtCleanup = error; }
      expect(caughtBody).toBe(bodyError);
      expect(caughtCleanup).toBe(cleanupError);
      expect(calls).toEqual([3, 2]);
      expect(cleanups).toHaveLength(1);
      if (env === enabled) {
        expect(f.frames).toHaveLength(2);
        expect(payload(f.frames[0])).toMatchObject({ bodyFailed: true, bodySettled: true, currentStatement: 12 });
        expect(payload(f.frames[1])).toMatchObject({ kind: "cleanup", exited: false, rejected: true, remainingCallbacks: 1 });
        expect(f.frames.join("")).not.toContain("private-");
      } else expect(f.frames).toEqual([]);
    }
  });

  test("cleanup rejection after a completed body is still reported and successful drain has a distinct receipt", () => {
    const complete = fixture();
    complete.observer.complete();
    complete.observer.settled();
    complete.observer.cleanupEntry(2);
    expect(complete.frames).toEqual([]);
    complete.observer.cleanupExit(true, 1);
    expect(complete.frames).toHaveLength(1);
    expect(payload(complete.frames[0])).toMatchObject({ kind: "cleanup", rejected: true, exited: false });
    const pending = fixture();
    pending.observer.cleanupEntry(2);
    pending.observer.cleanupExit(false, 0);
    expect(pending.frames).toHaveLength(2);
    expect(payload(pending.frames[1])).toMatchObject({ kind: "cleanup", rejected: false, exited: true, remainingCallbacks: 0 });
  });

  test("bounded chunks keep the unfinished current statement after the event cap and reject invalid inputs", () => {
    const f = fixture();
    for (let chunk = 0; chunk < 4; chunk++) {
      for (let i = 0; i < 20; i++) {
        f.advance(chunk * 100 + i);
        f.observer.enter(1);
        f.observer.done(1);
      }
    }
    f.observer.enter(39);
    for (const invalid of [-1, 0, 40, 1.5, NaN, Infinity, -Infinity]) {
      f.observer.enter(invalid);
      f.observer.done(invalid);
    }
    Reflect.apply(f.observer.enter, f.observer, ["private-statement"]);
    Reflect.apply(f.observer.done, f.observer, ["private-statement"]);
    f.advance(-10);
    f.observer.cleanupEntry(1e20);
    const body = payload(f.frames[0]);
    expect(body.events).toHaveLength(96);
    expect(body.dropped).toBe(66);
    expect(body.currentStatement).toBe(39);
    expect(body.lastCompletedStatement).toBe(1);
    expect(body.cleanupCount).toBe(65535);
    expect(body.elapsedMs).toBe(319);
    let previous = 0;
    for (const event of body.events) {
      expect(event.elapsedMs).toBeGreaterThanOrEqual(previous);
      previous = event.elapsedMs;
    }
    f.advance(Infinity);
    f.observer.cleanupExit(false, NaN);
    expect(payload(f.frames[1])).toMatchObject({ elapsedMs: 319, remainingCallbacks: 0 });
  });

  test("saturates elapsed and dropped counts without losing current phase or exceeding a frame", () => {
    const f = fixture();
    f.advance(1e20);
    for (let i = 0; i < 66000; i++) f.observer.enter(25);
    f.observer.cleanupEntry(-1);
    const body = payload(f.frames[0]);
    expect(body.elapsedMs).toBe(2147483647);
    expect(body.dropped).toBe(65535);
    expect(body.currentStatement).toBe(25);
    expect(body.cleanupCount).toBe(0);
    const nonfinite = fixture();
    nonfinite.advance(NaN);
    nonfinite.observer.enter(25);
    nonfinite.observer.cleanupEntry(Infinity);
    expect(payload(nonfinite.frames[0])).toMatchObject({ elapsedMs: 0, currentStatement: 25, cleanupCount: 0 });
  });

  test("runtime-invalid callback counts and rejection values cannot inject private content", () => {
    const f = fixture();
    Reflect.apply(f.observer.cleanupEntry, f.observer, ["private-count"]);
    Reflect.apply(f.observer.cleanupExit, f.observer, ["private-rejection", "private-count"]);
    expect(f.frames).toHaveLength(2);
    expect(payload(f.frames[0])).toMatchObject({ cleanupCount: 0 });
    expect(payload(f.frames[1])).toMatchObject({ rejected: false, exited: true, remainingCallbacks: 0 });
    expect(f.frames.join("")).not.toContain("private-");
  });

  test("publication is closed and at most once across reentrant throwing writers and repeated callbacks", () => {
    const frames: string[] = [];
    let observer: ReturnType<typeof createProjectSyncFirstFailureTiming>;
    observer = createProjectSyncFirstFailureTiming({
      env: enabled, now: () => 0,
      write: (frame) => {
        frames.push(frame);
        observer.done(25);
        observer.failed();
        observer.settled();
        observer.cleanupEntry(9);
        observer.cleanupExit(true, 1);
        throw { privateText: "private-writer-error" };
      },
    });
    observer.enter(25);
    expect(() => observer.cleanupEntry(2)).not.toThrow();
    observer.cleanupExit(false, 0);
    observer.cleanupExit(true, 8);
    expect(frames).toHaveLength(2);
    const body = payload(frames[0]);
    const cleanup = payload(frames[1]);
    expect(Object.keys(body).sort()).toEqual([
      "bodyComplete", "bodyFailed", "bodySettled", "case", "cleanupCount", "currentStatement", "dropped",
      "elapsedMs", "events", "kind", "lastCompletedStatement", "protocol", "schema",
    ]);
    expect(Object.keys(cleanup).sort()).toEqual([
      "case", "elapsedMs", "exited", "kind", "protocol", "rejected", "remainingCallbacks", "schema",
    ]);
    expect(body).toMatchObject({ currentStatement: 25, bodyFailed: false, bodySettled: false });
    expect(cleanup).toMatchObject({ rejected: true, exited: false, remainingCallbacks: 1 });
    expect(frames.join("")).not.toContain("private-");
    for (const event of body.events) expect(Object.keys(event).sort()).toEqual(["elapsedMs", "kind", "statement"]);
  });
});
