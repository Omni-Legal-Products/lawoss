// Test-only outer-statement observations. A pending statement does not identify
// an inner helper await, and missing cleanup exit remains unknown.
type Environment = Readonly<Record<string, string | undefined>>;
type EventKind = "body-enter" | "enter" | "done" | "body-failed" | "body-settled" | "body-complete";
type Event = Readonly<{ kind: EventKind; statement: number | null; elapsedMs: number }>;

export interface ProjectSyncFirstFailureTiming {
  enter(statement: number): void;
  done(statement: number): void;
  failed(): void;
  settled(): void;
  complete(): void;
  cleanupEntry(callbackCount: number): void;
  cleanupExit(rejected: boolean, remainingCallbacks: number): void;
}

const quiet: ProjectSyncFirstFailureTiming = Object.freeze({
  enter() {}, done() {}, failed() {}, settled() {}, complete() {}, cleanupEntry() {}, cleanupExit() {},
});
const prefix = "LAWOSS_PROJECT_SYNC_FIRST_FAILURE ";
const protocol = { protocol: "project-sync-first-failure", schema: 1, case: "revoke" };
const boundedCount = (value: number) => Number.isFinite(value) ? Math.min(65535, Math.max(0, Math.floor(value))) : 0;
const validStatement = (value: number) => Number.isInteger(value) && value >= 1 && value <= 39;

export function createProjectSyncFirstFailureTiming(options: {
  env: Environment;
  now: () => number;
  write: (frame: string) => void;
}): ProjectSyncFirstFailureTiming {
  if (options.env.LAWOSS_PROJECT_SYNC_TEST_DIAGNOSTICS !== "1" ||
      options.env.CI !== "true" || options.env.GITHUB_ACTIONS !== "true") return quiet;

  // Do not retain environment/configuration or writer errors in observations.
  const { now, write } = options;
  const clock = () => {
    try { return now(); } catch { return NaN; }
  };
  const start = clock();
  let elapsedMs = 0;
  const elapsed = () => {
    const delta = clock() - start;
    if (Number.isFinite(delta)) elapsedMs = Math.max(elapsedMs, Math.min(2147483647, Math.max(0, Math.floor(delta))));
    return elapsedMs;
  };
  const events: Event[] = [];
  let dropped = 0;
  let currentStatement: number | null = null;
  let lastCompletedStatement: number | null = null;
  let bodyComplete = false;
  let bodySettled = false;
  let bodyFailed = false;
  let frozen = false;
  let bodyPublished = false;
  let cleanupPublished = false;
  const record = (kind: EventKind, statement: number | null = null) => {
    const time = elapsed();
    if (events.length < 96) events.push(Object.freeze({ kind, statement, elapsedMs: time }));
    else dropped = Math.min(65535, dropped + 1);
  };
  const publish = (snapshot: object) => {
    // All fields are copied closed ASCII literals, booleans or bounded numbers.
    // Even 96 maximum-width events fit within the 8192-byte frame bound.
    const frame = `${prefix}${JSON.stringify(Object.freeze(snapshot))}\n`;
    try { write(frame); } catch { /* Diagnostic output must preserve the original error. */ }
  };
  record("body-enter");
  return {
    enter(statement) {
      if (frozen || !validStatement(statement)) return;
      currentStatement = statement;
      record("enter", statement);
    },
    done(statement) {
      if (frozen || !validStatement(statement) || currentStatement !== statement) return;
      currentStatement = null;
      lastCompletedStatement = statement;
      record("done", statement);
    },
    failed() {
      if (frozen) return;
      bodyFailed = true;
      record("body-failed");
    },
    settled() {
      if (frozen) return;
      bodySettled = true;
      record("body-settled");
    },
    complete() {
      if (frozen) return;
      bodyComplete = true;
      record("body-complete");
    },
    cleanupEntry(callbackCount) {
      if (frozen) return;
      frozen = true;
      const snapshot = Object.freeze({
        ...protocol, kind: "body", elapsedMs: elapsed(), bodyComplete, bodySettled, bodyFailed,
        currentStatement, lastCompletedStatement, cleanupCount: boundedCount(callbackCount),
        events: Object.freeze(events.slice()), dropped,
      });
      if (!bodyComplete || bodyFailed) {
        bodyPublished = true;
        publish(snapshot);
      }
    },
    cleanupExit(rejected, remainingCallbacks) {
      if (!frozen || cleanupPublished) return;
      cleanupPublished = true;
      const cleanupRejected = rejected === true;
      if (!bodyPublished && !cleanupRejected) return;
      publish(Object.freeze({
        ...protocol, kind: "cleanup", elapsedMs: elapsed(), exited: !cleanupRejected, rejected: cleanupRejected,
        remainingCallbacks: boundedCount(remainingCallbacks),
      }));
    },
  };
}
