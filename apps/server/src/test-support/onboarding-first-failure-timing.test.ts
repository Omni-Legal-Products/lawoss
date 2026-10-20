import { expect, test } from "bun:test";
import { createOnboardingFirstFailureTiming } from "./onboarding-first-failure-timing.js";

const enabled = { CI: "true", GITHUB_ACTIONS: "true", LAWOSS_PROJECT_SYNC_TEST_DIAGNOSTICS: "1" };
const prefix = "LAWOSS_ONBOARDING_FIRST_FAILURE ";
function fixture(env: Readonly<Record<string, string | undefined>> = enabled) {
  let time = 0, reads = 0;
  const frames: string[] = [];
  const observer = createOnboardingFirstFailureTiming({ env, now: () => { reads++; return time; }, write: frame => { frames.push(frame); } });
  return { observer, frames, advance: (value: number) => { time = value; }, reads: () => reads };
}
function payload(frame: string) {
  expect(frame.startsWith(prefix)).toBe(true);
  expect(Buffer.byteLength(frame)).toBeLessThanOrEqual(16384);
  return JSON.parse(frame.slice(prefix.length));
}

test("pending public apply freezes its exact entered step before cleanup, independent of late work", () => {
  const f = fixture();
  f.observer.request("plan", "enter", "matter"); f.observer.request("plan", "done");
  f.observer.request("apply", "enter");
  f.observer.checkpoint?.("ticket-enter"); f.observer.checkpoint?.("ticket-done");
  f.observer.checkpoint?.("directories-enter"); f.observer.checkpoint?.("directories-done");
  f.observer.checkpoint?.("execute-enter");
  f.advance(5000); f.observer.freeze();
  expect(f.frames).toHaveLength(1);
  expect(payload(f.frames[0])).toMatchObject({ protocol: "onboarding-first-failure", schema: 1, action: "matter", ordinal: 1,
    pending: "apply", failed: false, currentCheckpoint: "execute-enter", lastCompletedCheckpoint: "directories-done", elapsedMs: 5000, dropped: 0 });
  const bytes = f.frames[0], reads = f.reads();
  f.advance(9000); f.observer.checkpoint?.("execute-done"); f.observer.request("apply", "failed"); f.observer.freeze();
  expect(f.frames).toEqual([bytes]); expect(f.reads()).toBe(reads);
});

test("gaps after completed checkpoints remain unknown instead of inventing a pending step", () => {
  const f = fixture(); f.observer.request("plan", "enter", "client"); f.observer.request("plan", "done");
  f.observer.request("apply", "enter"); f.observer.checkpoint?.("ticket-enter"); f.observer.checkpoint?.("ticket-done");
  f.observer.freeze();
  expect(payload(f.frames[0])).toMatchObject({ currentCheckpoint: null, lastCompletedCheckpoint: "ticket-done", pending: "apply" });
});

test("disabled observers inspect no inputs, clocks or writers; passing operations stay quiet", () => {
  const hostile = new Proxy({}, { get() { throw new Error("private getter"); } });
  for (const env of [{}, { ...enabled, CI: "TRUE" }, { ...enabled, GITHUB_ACTIONS: "false" }, { ...enabled, LAWOSS_PROJECT_SYNC_TEST_DIAGNOSTICS: "true" }]) {
    const f = fixture(env); f.observer.request("plan", "enter", hostile); f.observer.freeze();
    expect(f.observer.checkpoint).toBeUndefined(); expect(f.reads()).toBe(0); expect(f.frames).toEqual([]);
  }
  const f = fixture(); f.observer.request("plan", "enter", "client"); f.observer.request("plan", "done");
  f.observer.request("apply", "enter"); f.observer.request("apply", "done"); f.observer.freeze(); expect(f.frames).toEqual([]);
});

test("unknown runtime values are dropped before the clock and only bounded closed fields survive", () => {
  const f = fixture(); f.observer.request("plan", "enter", "private-client-name"); f.observer.request("plan", "done"); f.observer.request("apply", "enter");
  const reads = f.reads();
  Reflect.apply(f.observer.checkpoint!, undefined, ["private-client-path/execute-enter"]);
  Reflect.apply(f.observer.request, undefined, ["private-route", "enter"]);
  Reflect.apply(f.observer.request, undefined, ["apply", "private-error"]);
  expect(f.reads()).toBe(reads);
  for (let i = 0; i < 120; i++) { f.advance(i); f.observer.checkpoint?.("execute-enter"); f.observer.checkpoint?.("execute-done"); }
  f.advance(Infinity); f.observer.freeze();
  const value = payload(f.frames[0]);
  expect(value).toMatchObject({ action: null, currentCheckpoint: null, lastCompletedCheckpoint: "execute-done", elapsedMs: 119 });
  expect(value.events).toHaveLength(96); expect(value.dropped).toBeGreaterThan(0);
  expect(f.frames[0]).not.toContain("private-"); expect(f.frames[0]).not.toContain("Infinity");
});

test("request errors retain no error value and observation failures cannot replace the original failure", () => {
  const failure = new Error("private source path and error");
  const f = fixture();
  let caught: unknown;
  try { f.observer.request("apply", "enter"); throw failure; }
  catch (error) { f.observer.request("apply", "failed"); caught = error; }
  f.observer.freeze(); expect(caught).toBe(failure);
  expect(payload(f.frames[0])).toMatchObject({ pending: null, failed: true }); expect(f.frames[0]).not.toContain(failure.message);
  const observer = createOnboardingFirstFailureTiming({ env: enabled, now: () => { throw failure; }, write: () => { throw failure; } });
  expect(() => { observer.request("apply", "enter"); observer.freeze(); observer.freeze(); }).not.toThrow();
});
