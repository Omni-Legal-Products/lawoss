/**
 * #465 (po teste balíka): hľadanie v súboroch a chatoch sa pýta pre každý priestor zvlášť; pri 25 klientoch
 * prišlo naraz desiatky požiadaviek a server neodpovedal iným trasám (Dnes zlyhal na časový limit). Najviac
 * `limit` hľadaní jedného druhu beží naraz; ďalšie čakajú v obmedzenom rade (FIFO), zrušená požiadavka
 * (nový dotaz, zatvorené okno) z radu odíde a nič nespustí. Plný rad odpovie chybou 503, nie čakaním.
 */
import { ApiError } from "../errors.js";

export const SEARCH_CONCURRENCY = 2;
export const SEARCH_QUEUE_LIMIT = 64;

type Waiter = { start: () => void; signal: AbortSignal; abort: () => void };
type Lane = { running: number; queue: Waiter[] };
const lanes = new Map<string, Lane>();

const laneOf = (kind: string): Lane => {
  let lane = lanes.get(kind);
  if (!lane) { lane = { running: 0, queue: [] }; lanes.set(kind, lane); }
  return lane;
};

async function acquire(kind: string, signal: AbortSignal, limit: number, queueLimit: number): Promise<() => void> {
  signal.throwIfAborted();
  const lane = laneOf(kind);
  if (lane.running >= limit) {
    if (lane.queue.length >= queueLimit) throw new ApiError(503, "search_busy", "Search is busy. Try again in a moment.");
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = {
        signal,
        start: () => { signal.removeEventListener("abort", waiter.abort); resolve(); },
        abort: () => { lane.queue = lane.queue.filter(entry => entry !== waiter); reject(signal.reason); },
      };
      signal.addEventListener("abort", waiter.abort, { once: true });
      lane.queue.push(waiter);
    });
  } else lane.running++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = lane.queue.shift();
    // Uvoľnené miesto prevezme ďalší v rade (počet bežiacich sa nemení), inak sa uvoľní.
    if (next) next.start(); else lane.running--;
  };
}

/** Spustí hľadanie druhu `kind` v obmedzenom počte naraz; uvoľní miesto aj pri chybe či zrušení. */
export async function withSearchSlot<T>(kind: string, signal: AbortSignal, run: () => Promise<T>, options: { limit?: number; queueLimit?: number } = {}): Promise<T> {
  const release = await acquire(kind, signal, options.limit ?? SEARCH_CONCURRENCY, options.queueLimit ?? SEARCH_QUEUE_LIMIT);
  try { return await run(); } finally { release(); }
}
