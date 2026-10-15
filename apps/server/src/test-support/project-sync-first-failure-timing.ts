import type { ProjectSyncSettingsCheckpoint } from "../project-sync.js";

// Test-only outer-statement observations. A pending statement does not identify
// an inner helper await, and missing cleanup exit remains unknown.
type Environment = Readonly<Record<string, string | undefined>>;
type EventKind = "body-enter" | "enter" | "done" | "body-failed" | "body-settled" | "body-complete";
type Event = Readonly<{ kind: EventKind; statement: number | null; elapsedMs: number }>;

export interface ProjectSyncFirstFailureTiming {
  settingsCheckpoint?: (checkpoint: ProjectSyncSettingsCheckpoint) => void;
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
const settingsCheckpoints: readonly ProjectSyncSettingsCheckpoint[] = [
  "callback-enter",
  "connection-enter",
  "connection-done",
  "project-store-enter",
  "project-store-done",
  "task-store-enter",
  "task-store-done",
  "link-checks-enter",
  "link-checks-done",
  "metadata-enter",
  "metadata-done",
  "mutations-enter",
  "mutations-done",
  "schedule-enter",
  "schedule-done",
  "status-call",
];
const settingsPrefix = "LAWOSS_PROJECT_SYNC_SETTINGS_FIRST_FAILURE ";
type SettingsEvent = Readonly<{ checkpoint: ProjectSyncSettingsCheckpoint; elapsedMs: number }>;
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
  const settingsEvents: SettingsEvent[] = [];
  let settingsSeen = false;
  let settingsArmed = false;
  let settingsNext = 0;
  let settingsElapsedMs = 0;
  const settingsCheckpoint = (checkpoint: ProjectSyncSettingsCheckpoint) => {
    if (frozen || !settingsArmed || bodyFailed || bodySettled || bodyComplete || currentStatement !== 5 || settingsNext >= settingsCheckpoints.length || settingsEvents.length >= 16) return;
    // Strict equality rejects runtime-unknown values without inspecting them or
    // reading the clock. Existing links skip only the two metadata checkpoints.
    const skipMetadata = settingsNext === 9 && checkpoint === "mutations-enter";
    if (!skipMetadata && checkpoint !== settingsCheckpoints[settingsNext]) return;
    const delta = clock() - start;
    if (Number.isFinite(delta)) settingsElapsedMs = Math.max(settingsElapsedMs, Math.min(2147483647, Math.max(0, Math.floor(delta))));
    settingsEvents.push(Object.freeze({ checkpoint, elapsedMs: settingsElapsedMs }));
    settingsNext = skipMetadata ? 12 : settingsNext + 1;
  };
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
    settingsCheckpoint,
    enter(statement) {
      if (frozen || !validStatement(statement)) return;
      settingsArmed = !settingsSeen && statement === 5 && !bodyFailed && !bodySettled && !bodyComplete;
      if (statement === 5) settingsSeen = true;
      currentStatement = statement;
      record("enter", statement);
    },
    done(statement) {
      if (frozen || !validStatement(statement) || currentStatement !== statement) return;
      settingsArmed = false;
      currentStatement = null;
      lastCompletedStatement = statement;
      record("done", statement);
    },
    failed() {
      if (frozen) return;
      settingsArmed = false;
      bodyFailed = true;
      record("body-failed");
    },
    settled() {
      if (frozen) return;
      settingsArmed = false;
      bodySettled = true;
      record("body-settled");
    },
    complete() {
      if (frozen) return;
      settingsArmed = false;
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
      // Freeze both protocols before invoking any writer. Reuse the original
      // snapshot clock read; inner normalization never changes outer bytes.
      const settingsOutcome = !snapshot.bodyFailed && !snapshot.bodySettled ? "pending"
        : snapshot.bodyFailed && snapshot.bodySettled ? "caught-failure" : null;
      const settingsFrame = !snapshot.bodyComplete && snapshot.currentStatement === 5 && snapshot.lastCompletedStatement === 4 && settingsOutcome
        ? `${settingsPrefix}${JSON.stringify(Object.freeze({
          protocol: "project-sync-settings-first-failure", schema: 1, case: "revoke", statement: 5, kind: "settings",
          outcome: settingsOutcome, elapsedMs: Math.max(snapshot.elapsedMs, settingsElapsedMs),
          currentCheckpoint: settingsEvents.at(-1)?.checkpoint ?? null, events: Object.freeze(settingsEvents.slice()),
        }))}\n` : null;
      if (!bodyComplete || bodyFailed) {
        bodyPublished = true;
        publish(snapshot);
      }
      if (settingsFrame !== null) {
        try { write(settingsFrame); } catch { /* Preserve original errors. */ }
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
