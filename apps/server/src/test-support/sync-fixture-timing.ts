// Pure test-only bounded projection. Callers supply only their fixed stage enum.
export function createSyncFixtureTiming<Stage extends string>(fixture: "tasks-owner-stop" | "task-signout", stages: readonly Stage[]) {
  if (!["tasks-owner-stop", "task-signout"].includes(fixture)) throw new TypeError("Unsupported synthetic timing fixture");
  const origin = performance.now();
  const events: Array<{ stage: Stage; elapsedMs: number; count?: number; windowMs?: number }> = [];
  let dropped = 0, published = false;
  const timing = {
    record(stage: Stage, count?: number, windowMs?: number) {
      if (published) return;
      try {
        if (!stages.includes(stage) || events.length === 64) { dropped = Math.min(65_535, dropped + 1); return; }
        events.push({ stage, elapsedMs: Math.min(2_147_483_647, Math.max(0, Math.floor(performance.now() - origin))),
          ...(typeof count === "number" && Number.isFinite(count) ? { count: Math.min(65_535, Math.max(0, Math.floor(count))) } : {}),
          ...(typeof windowMs === "number" && Number.isFinite(windowMs) ? { windowMs: Math.min(2_147_483_647, Math.max(0, Math.floor(windowMs))) } : {}) });
      } catch { dropped = Math.min(65_535, dropped + 1); }
    },
    publish(outcome: "primary-failed" | "cleanup-failed" | "incomplete-at-cleanup", write?: (line: string) => void) {
      if (published || !["primary-failed", "cleanup-failed", "incomplete-at-cleanup"].includes(outcome)) return;
      published = true;
      try { (write ?? console.error)(JSON.stringify({ schema: 1, fixture, outcome, events, dropped })); } catch { /* Diagnostics cannot replace the primary error. */ }
    },
  };
  return timing;
}
