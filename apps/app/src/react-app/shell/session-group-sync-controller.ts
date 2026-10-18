type Target = { key: string };
type Entry = { initialized: boolean; cursor?: number; failures: number; nextAttemptAt: number; paused: boolean; inFlight: boolean; retryRequested?: boolean };

/** One lifetime owns initial sync, event cursors and backoff across metadata renders. */
export class SessionGroupSyncController<T extends Target> {
  private readonly entries = new Map<string, Entry>();
  private disposed = false;
  constructor(private readonly input: {
    targets: () => T[];
    sync: (target: T, migrate: boolean, isCurrent: () => boolean) => Promise<void>;
    events: (target: T, since: number | undefined) => Promise<{ cursor?: number; items?: Array<{ seq: number }> }>;
    isUnavailable: (error: unknown) => boolean;
    onError: (target: T, error: unknown) => void;
    now?: () => number;
  }) {}

  async refresh(): Promise<void> {
    if (this.disposed) return;
    const targets = this.input.targets();
    const liveKeys = new Set(targets.map(target => target.key));
    for (const key of this.entries.keys()) if (!liveKeys.has(key)) this.entries.delete(key);
    await Promise.all(targets.map(target => this.refreshTarget(target)));
  }

  async reconnect(): Promise<void> {
    // Keep in-flight ownership: resetting admission must not overlap a live request.
    for (const entry of this.entries.values()) {
      if (entry.inFlight) entry.retryRequested = true;
      else { entry.paused = false; entry.nextAttemptAt = 0; entry.failures = 0; }
    }
    await this.refresh();
  }

  dispose(): void { this.disposed = true; this.entries.clear(); }

  private async refreshTarget(target: T): Promise<void> {
    let entry = this.entries.get(target.key);
    if (!entry) {
      entry = { initialized: false, failures: 0, nextAttemptAt: 0, paused: false, inFlight: false };
      this.entries.set(target.key, entry);
    }
    if (entry.inFlight || entry.paused || (this.input.now?.() ?? Date.now()) < entry.nextAttemptAt) return;
    const owned = entry;
    const isCurrent = () => !this.disposed && this.entries.get(target.key) === owned && this.input.targets().some(value => value.key === target.key);
    owned.inFlight = true;
    try {
      if (!owned.initialized) {
        await this.input.sync(target, true, isCurrent);
        if (!isCurrent()) return;
        owned.initialized = true;
      } else {
        const response = await this.input.events(target, owned.cursor);
        if (!isCurrent()) return;
        if ((response.items?.length ?? 0) > 0) await this.input.sync(target, false, isCurrent);
        if (!isCurrent()) return;
        // Advance only after state synchronization succeeds; a failed state read
        // must not consume the event that would make the retry refresh it.
        owned.cursor = typeof response.cursor === "number" ? response.cursor : Math.max(owned.cursor ?? 0, ...(response.items ?? []).map(item => Number(item.seq) || 0));
      }
      owned.failures = 0; owned.nextAttemptAt = 0;
    } catch (error) {
      if (!isCurrent()) return;
      owned.failures++;
      owned.paused = this.input.isUnavailable(error);
      owned.nextAttemptAt = (this.input.now?.() ?? Date.now()) + Math.min(48_000, 3_000 * 2 ** Math.min(owned.failures, 4));
      if (owned.failures === 1) this.input.onError(target, error);
    } finally {
      owned.inFlight = false;
      if (owned.retryRequested && isCurrent()) {
        owned.retryRequested = false; owned.paused = false; owned.nextAttemptAt = 0; owned.failures = 0;
        void this.refreshTarget(target);
      }
    }
  }
}
