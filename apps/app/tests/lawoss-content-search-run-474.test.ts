// LAWOSS #474: kým server pripravuje súbory, hľadanie znova pýta len zdroje, ktoré hlásia `preparing`,
// s rastúcim odstupom a stropom, nie celé hľadanie vo všetkých priestoroch každých 1,5 s.
import { expect, test } from "bun:test";
import type { ContentSearchResponse } from "@legalwork/types/search";
import { PREPARING_POLL_DELAYS, runContentSearch, type ContentSearchProgress } from "../src/lawoss/shell/content-search-run";

type Job = { key: string; kind: "sessions" | "tasks" | "files" };
const office = (clients: number): Job[] => Array.from({ length: clients }, (_, i) => [
  { key: `k${i}:sessions`, kind: "sessions" as const }, { key: `k${i}:files`, kind: "files" as const },
]).flat();

function server(preparing: (job: Job, call: number) => number) {
  const calls: string[] = [];
  const count = new Map<string, number>();
  const search = async (job: Job): Promise<ContentSearchResponse> => {
    calls.push(job.key);
    const call = count.get(job.key) ?? 0; count.set(job.key, call + 1);
    return { items: [], limited: false, ...(job.kind === "files" ? { preparing: preparing(job, call) } : {}) };
  };
  return { calls, search };
}

async function run(jobs: Job[], search: (job: Job) => Promise<ContentSearchResponse>, signal = new AbortController().signal) {
  const delays: number[] = [];
  const progress: ContentSearchProgress[] = [];
  await runContentSearch({ jobs, search, signal, onResponse: () => {}, onProgress: state => progress.push(state), sleep: async ms => { delays.push(ms); } });
  return { delays, progress, last: progress.at(-1)! };
}

test("znova sa pýtajú len zdroje, ktoré hlásia prípravu, s rastúcim odstupom", async () => {
  // 24 klientov, súbory pripravuje len klient k3 (5 → 2 → 0).
  const { calls, search } = server((job, call) => job.key === "k3:files" ? [5, 2, 0][call] ?? 0 : 0);
  const { delays, last } = await run(office(24), search);
  expect(calls).toHaveLength(48 + 2);
  expect(calls.slice(48)).toEqual(["k3:files", "k3:files"]);
  expect(delays).toEqual(PREPARING_POLL_DELAYS.slice(0, 2));
  expect(delays[1]).toBeGreaterThan(delays[0]!);
  expect(last).toEqual({ pending: 0, preparing: 0, polling: false });
});

test("príprava, ktorá neskončí, sa po strope prestane pýtať a ostane viditeľný počet", async () => {
  const { calls, search } = server(() => 7);
  const { delays, last } = await run(office(24), search);
  // 48 prvých dopytov + 24 súborových za každé kolo; predtým ~432 za 22 s a bez konca.
  expect(calls).toHaveLength(48 + 24 * PREPARING_POLL_DELAYS.length);
  expect(delays).toEqual([...PREPARING_POLL_DELAYS]);
  expect(last).toEqual({ pending: 0, preparing: 24 * 7, polling: false });
});

test("počet pripravovaných súborov je posledný stav každého zdroja, nie súčet všetkých odpovedí", async () => {
  const { search } = server((job, call) => [4, 3, 0][call] ?? 0);
  const { progress } = await run(office(2), search);
  const counts = progress.map(state => state.preparing);
  // Súčet všetkých odpovedí by bol 4 + 4 + 3 + 3 = 14 („skáče“); posledný stav zdrojov je 8 → 6 → 0.
  expect([Math.max(...counts), counts.includes(6), counts.at(-1)]).toEqual([8, true, 0]);
});

test("zmenený dopyt (abort) zastaví ďalšie pýtanie", async () => {
  const controller = new AbortController();
  const { calls, search } = server(() => 3);
  await runContentSearch({ jobs: office(3), search, signal: controller.signal, onResponse: () => {}, onProgress: () => {}, sleep: async () => { controller.abort(); } });
  expect(calls).toHaveLength(6);
});
