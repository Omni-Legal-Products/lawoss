/**
 * Beh hľadania palety (#474): prvé kolo pýta každý zdroj (priestor × druh), potom sa s rastúcim odstupom
 * a stropom znova pýtajú len zdroje, ktoré hlásia nepripravené súbory. Počet pripravovaných súborov je
 * posledný stav každého zdroja; server súbory pripravuje na pozadí aj bez ďalších dopytov.
 */
import type { ContentSearchResponse } from "@legalwork/types/search";

/** Odstupy medzi kolami (spolu ≈ 72 s); po poslednom sa už nepýta a paleta ukáže výsledok s počtom. */
export const PREPARING_POLL_DELAYS = [1500, 3000, 6000, 12_000, 20_000, 30_000] as const;

export type ContentSearchProgress = { pending: number; preparing: number; polling: boolean };

const sleepFor = (ms: number, signal: AbortSignal) => new Promise<void>(resolve => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

export async function runContentSearch<J extends { key: string; kind: "sessions" | "tasks" | "files" }>(options: {
  jobs: readonly J[];
  search: (job: J) => Promise<ContentSearchResponse>;
  onResponse: (job: J, response: ContentSearchResponse) => void;
  onProgress: (progress: ContentSearchProgress) => void;
  signal: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const { signal } = options;
  const sleep = options.sleep ?? sleepFor;
  const preparing = new Map<string, number>();
  let pending = options.jobs.length;
  let polling = false;
  const report = () => {
    if (signal.aborted) return;
    options.onProgress({ pending, preparing: [...preparing.values()].reduce((sum, count) => sum + count, 0), polling });
  };
  const run = async (job: J) => {
    try {
      const response = await options.search(job);
      if (signal.aborted) return;
      options.onResponse(job, response);
      preparing.set(job.key, response.preparing ?? 0);
    } catch {
      // Keep showing matches from the other search sources.
    }
  };
  // File extraction must never queue ahead of transcript search. Keep disk work modest.
  const round = async (jobs: readonly J[], done: () => void) => {
    const take = (queue: J[]) => async () => { while (queue.length && !signal.aborted) { const job = queue.shift(); if (job) { await run(job); done(); } } };
    const files = take(jobs.filter(job => job.kind === "files"));
    const records = take(jobs.filter(job => job.kind !== "files"));
    await Promise.all([records(), records(), records(), records(), files(), files()]);
  };
  report();
  await round(options.jobs, () => { pending = Math.max(0, pending - 1); report(); });
  for (const delay of PREPARING_POLL_DELAYS) {
    const again = options.jobs.filter(job => (preparing.get(job.key) ?? 0) > 0);
    if (!again.length || signal.aborted) break;
    polling = true;
    report();
    await sleep(delay, signal);
    if (signal.aborted) return;
    await round(again, report);
  }
  polling = false;
  report();
}
