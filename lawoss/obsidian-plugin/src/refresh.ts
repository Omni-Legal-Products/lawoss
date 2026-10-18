export type ReadState<T> = { data?: T; updatedAt?: number; error?: string; loading: boolean; duration: number };
/** Each invalidation owns a generation; async work cannot resurrect stale data after unload. */
export class RefreshController<T> {
  state: ReadState<T> = { loading: false, duration: 0 };
  private generation = 0;
  private disposed = false;
  private listeners = new Set<() => void>();
  constructor(private read: () => Promise<T>, private now: () => number = Date.now, private same: (a: T, b: T) => boolean = Object.is) {}
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { for (const listener of this.listeners) listener(); }
  invalidate() { this.generation++; }
  reset() { this.generation++; this.state = { loading: false, duration: 0 }; this.emit(); }
  async refresh(): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    const started = this.now();
    this.state = { ...this.state, loading: true };
    this.emit();
    try {
      const data = await this.read();
      if (this.disposed || generation !== this.generation) return;
      const stable = this.state.data !== undefined && this.same(this.state.data, data) ? this.state.data : data;
      this.state = { data: stable, updatedAt: this.now(), loading: false, duration: this.now() - started };
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      this.state = { ...this.state, error: error instanceof Error ? error.message : String(error), loading: false, duration: this.now() - started };
    }
    if (!this.disposed && generation === this.generation) this.emit();
  }
  dispose() { this.disposed = true; this.generation++; this.listeners.clear(); }
}
