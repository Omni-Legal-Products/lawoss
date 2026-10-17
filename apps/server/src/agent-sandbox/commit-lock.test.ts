import { expect, test } from "bun:test";
import { resolve, join } from "node:path";
import { withCommitPaths } from "./commit-lock.js";
const signal = new AbortController().signal;
function gate() {
  let release = () => {};
  const promise = new Promise<void>(done => { release = done; });
  return { promise, release };
}

test("empty and unrelated publications finish while a large publication is blocked", async () => {
  const hold = gate(), started = gate();
  const path = resolve("first");
  const first = withCommitPaths([path], signal, async () => { started.release(); await hold.promise; });
  await started.promise;
  try {
    await withCommitPaths([], signal, async () => { throw new Error("An unchanged filesystem must not publish"); });
    let ran = false;
    await withCommitPaths([resolve("second")], signal, async () => { ran = true; });
    expect(ran).toBe(true);
  } finally { hold.release(); await first; }
});

test("same destinations and ancestor changes wait for the whole transaction", async () => {
  for (const child of [false, true]) {
    const hold = gate(), started = gate();
    const path = resolve("overlap");
    const order: number[] = [];
    const first = withCommitPaths([path], signal, async () => { started.release(); await hold.promise; order.push(1); });
    await started.promise;
    const second = withCommitPaths([child ? join(path, "child") : path], signal, async () => { order.push(2); });
    await Promise.resolve();
    expect(order).toEqual([]);
    hold.release(); await Promise.all([first, second]);
    expect(order).toEqual([1, 2]);
  }
});

test("cancelling a waiter releases its queue entry without publishing", async () => {
  const hold = gate(), started = gate(), controller = new AbortController();
  const path = resolve("cancel");
  const first = withCommitPaths([path], signal, async () => { started.release(); await hold.promise; });
  await started.promise;
  const second = withCommitPaths([path], controller.signal, async () => { throw new Error("published after cancellation"); });
  controller.abort(new Error("revoked"));
  await expect(second).rejects.toThrow("revoked");
  hold.release(); await first;
  await expect(withCommitPaths([path], signal, async () => { throw new Error("disk failure"); })).rejects.toThrow("disk failure");
  await withCommitPaths([path], signal, async () => {});
});
