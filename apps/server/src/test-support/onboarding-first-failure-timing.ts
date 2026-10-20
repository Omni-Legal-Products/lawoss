import type { OnboardingApplyCheckpoint } from "../lawoss/onboarding.js";

export interface OnboardingFirstFailureTiming {
  checkpoint?: (value: OnboardingApplyCheckpoint) => void;
  request(endpoint: "plan" | "apply", state: "enter" | "done" | "failed", action?: unknown): void;
  freeze(): void;
}

export function createOnboardingFirstFailureTiming(options: {
  env: Readonly<Record<string, string | undefined>>;
  now: () => number;
  write: (frame: string) => void;
}): OnboardingFirstFailureTiming {
  const quiet = { request() {}, freeze() {} };
  if (options.env.LAWOSS_PROJECT_SYNC_TEST_DIAGNOSTICS !== "1" || options.env.CI !== "true" || options.env.GITHUB_ACTIONS !== "true") return quiet;
  const checkpoints: readonly string[] = [
    "ticket-enter", "ticket-done", "directories-enter", "directories-done", "execute-enter", "execute-done",
    "receipt-enter", "receipt-done", "register-enter", "register-done", "office-grant-enter", "office-grant-done",
    "watchers-enter", "watchers-done", "profile-enter", "profile-done",
  ];
  const { now, write } = options;
  const clock = () => { try { return now(); } catch { return NaN; } };
  const start = clock();
  let elapsedMs = 0, ordinal = 0, dropped = 0;
  let pending: "plan" | "apply" | null = null;
  let action: "office" | "practice" | "client" | "subject" | "matter" | "existing" | null = null;
  let currentCheckpoint: OnboardingApplyCheckpoint | null = null, lastCompletedCheckpoint: OnboardingApplyCheckpoint | null = null;
  let failed = false, frozen = false;
  const events: { phase: string; elapsedMs: number }[] = [];
  const elapsed = () => {
    const delta = clock() - start;
    if (Number.isFinite(delta)) elapsedMs = Math.max(elapsedMs, Math.min(2147483647, Math.max(0, Math.floor(delta))));
    return elapsedMs;
  };
  const record = (phase: string) => {
    const elapsedMs = elapsed();
    if (events.length < 96) events.push({ phase, elapsedMs }); else dropped = Math.min(65535, dropped + 1);
  };
  const freeze = () => {
    if (frozen) return;
    frozen = true;
    if (!pending && !failed) return;
    const snapshot = { protocol: "onboarding-first-failure", schema: 1, action, ordinal, pending, failed,
      currentCheckpoint, lastCompletedCheckpoint, elapsedMs: elapsed(), events: events.slice(), dropped };
    try { write(`LAWOSS_ONBOARDING_FIRST_FAILURE ${JSON.stringify(snapshot)}\n`); } catch { /* Preserve the original test failure. */ }
  };
  return {
    checkpoint(value) {
      // Reject unknown runtime input before reading clocks or retaining values.
      if (frozen || pending !== "apply" || typeof value !== "string" || !checkpoints.includes(value)) return;
      if (value.endsWith("-enter")) currentCheckpoint = value;
      // A completed checkpoint does not name the next await. In particular,
      // receipt lookup and office-grant lstat occur between observed stages.
      else { currentCheckpoint = null; lastCompletedCheckpoint = value; }
      record(value);
    },
    request(endpoint, state, requestedAction) {
      if (frozen || endpoint !== "plan" && endpoint !== "apply" || state !== "enter" && state !== "done" && state !== "failed") return;
      if (state === "enter") {
        if (endpoint === "plan") {
          action = requestedAction === "office" || requestedAction === "practice" || requestedAction === "client" || requestedAction === "subject" || requestedAction === "matter" || requestedAction === "existing" ? requestedAction : null;
          ordinal = Math.min(65535, ordinal + 1);
        }
        pending = endpoint; currentCheckpoint = null; lastCompletedCheckpoint = null;
      } else {
        if (pending !== endpoint) return;
        pending = null;
        if (state === "failed") failed = true;
      }
      record(`${endpoint}-${state}`);
    },
    freeze,
  };
}
