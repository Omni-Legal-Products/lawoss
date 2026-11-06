import { describe, expect, test } from "bun:test";

import { createConcurrencyLimiter } from "./concurrency-limiter.js";

function deferred() {
  let resolve = () => {}, reject = (_error: Error) => {};
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe("createConcurrencyLimiter", () => {
  test("runs at most the limit at once and starts waiting work in arrival order", async () => {
    const limited = createConcurrencyLimiter(2);
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const started: number[] = [];
    const runs = gates.map((gate, index) => limited(async () => { started.push(index); await gate.promise; return index; }));
    await tick();
    expect(started).toEqual([0, 1]);
    gates[1].resolve();
    await tick();
    expect(started).toEqual([0, 1, 2]);
    gates[0].resolve();
    await tick();
    expect(started).toEqual([0, 1, 2, 3]);
    gates[2].resolve();
    gates[3].resolve();
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3]);
  });

  test("failed work keeps its error and releases its slot", async () => {
    const limited = createConcurrencyLimiter(1);
    const gate = deferred();
    const failure = new Error("Synthetic failure");
    const failing = limited(async () => { await gate.promise; });
    const next = limited(async () => "next");
    gate.reject(failure);
    await expect(failing).rejects.toBe(failure);
    expect(await next).toBe("next");
    // Po vyprázdnení fronty sa miesto vráti a ďalšia úloha nečaká.
    expect(await limited(async () => "free")).toBe("free");
  });
});
