import { describe, expect, test } from "bun:test";

import { createModeRestoreGuard } from "./lite-smoke.mjs";

// Covers the fix for review finding #1: SIGINT/SIGTERM and the normal
// `finally` path both call the same guard — it must restore at most once
// (no double restore / no race), and never hang past its timeout.

describe("lite-smoke: createModeRestoreGuard", () => {
  test("restores exactly once even when called concurrently (finally + signal race)", async () => {
    let calls = 0;
    const guard = createModeRestoreGuard({
      getClient: () => ({}),
      getOriginalMode: () => "pro",
      restore: async () => { calls += 1; },
      timeoutMs: 1000,
    });

    const [first, second] = await Promise.all([guard(), guard()]);
    expect(calls).toBe(1);
    expect(first).toEqual({ attempted: true, ok: true });
    expect(second).toEqual({ attempted: true, ok: true });
  });

  test("repeated calls after settling return the same cached outcome, still one restore", async () => {
    let calls = 0;
    const guard = createModeRestoreGuard({
      getClient: () => ({}),
      getOriginalMode: () => "lite",
      restore: async () => { calls += 1; },
      timeoutMs: 1000,
    });

    await guard();
    await guard();
    expect(calls).toBe(1);
  });

  test("nothing to restore (no client / no original mode yet) is reported, not attempted", async () => {
    const guard = createModeRestoreGuard({
      getClient: () => null,
      getOriginalMode: () => null,
      restore: async () => { throw new Error("must not be called"); },
      timeoutMs: 1000,
    });
    expect(await guard()).toEqual({ attempted: false });
  });

  test("a restore that never resolves times out (bounded) instead of hanging", async () => {
    const guard = createModeRestoreGuard({
      getClient: () => ({}),
      getOriginalMode: () => "lite",
      restore: () => new Promise(() => {}),
      timeoutMs: 30,
    });
    const outcome = await guard();
    expect(outcome.attempted).toBe(true);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("timed out");
  });

  test("a restore that throws is reported as a failed (not attempted=false) outcome", async () => {
    const guard = createModeRestoreGuard({
      getClient: () => ({}),
      getOriginalMode: () => "pro",
      restore: async () => { throw new Error("mode.set rejected"); },
      timeoutMs: 1000,
    });
    const outcome = await guard();
    expect(outcome).toEqual({ attempted: true, ok: false, error: "mode.set rejected" });
  });
});

describe("lite-smoke: import bez vedlejších efektů (final review M3)", () => {
  test("import modulu neinstaluje obsluhu SIGINT/SIGTERM", () => {
    const code = 'const b = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]; await import("./scripts/lite-smoke.mjs"); console.log(JSON.stringify([b, [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]]));';
    const run = Bun.spawnSync([process.execPath, "-e", code], { cwd: new URL("..", import.meta.url).pathname });
    const [before, after] = JSON.parse(run.stdout.toString().trim().split("\n").pop());
    expect(after).toEqual(before);
  });
});
