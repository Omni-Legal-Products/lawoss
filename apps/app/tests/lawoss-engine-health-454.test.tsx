import { expect, test } from "bun:test";
import { act } from "react";
import { engineHealthFromStatus, useEngineHealth, type EngineHealth } from "../src/lawoss/shell/engine-health";

type Status = "starting" | "migrating" | "ready" | "error";

test("#454: the server's engine status maps to what the status bar shows", () => {
  expect(engineHealthFromStatus(undefined)).toBe(null);
  expect(engineHealthFromStatus("ready")).toBe("ready");
  expect(engineHealthFromStatus("starting")).toBe("restarting");
  expect(engineHealthFromStatus("migrating")).toBe("restarting");
  expect(engineHealthFromStatus("error")).toBe("unavailable");
});

/** Mounts the hook in React DOM without a browser; globals are restored exactly afterwards. */
async function observe(statuses: Array<Status | Error>, waitMs: number, options: { retryAfterMs?: number; withRestart?: boolean } = {}) {
  const host = globalThis as { window?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
  const windowBefore = Object.getOwnPropertyDescriptor(globalThis, "window");
  const actBefore = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Object.defineProperty(globalThis, "window", { value: { event: undefined, HTMLIFrameElement: class {} }, configurable: true, writable: true });
  host.IS_REACT_ACT_ENVIRONMENT = true;
  const seen: Array<EngineHealth | null> = [];
  let calls = 0, restarts = 0;
  let retry: (() => Promise<void>) | undefined;
  const health = async () => {
    const next = statuses[Math.min(calls++, statuses.length - 1)];
    if (next instanceof Error) throw next;
    return { ok: true, version: "test", uptimeMs: 1, engine: { status: next } };
  };
  const client = options.withRestart || options.retryAfterMs !== undefined
    ? { health, restartEngine: async () => { restarts++; return { restarting: true, engine: { status: "starting" as const } }; } }
    : { health };
  try {
    const { createRoot } = await import("react-dom/client");
    const noop = () => undefined;
    const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", addEventListener: noop, removeEventListener: noop, ownerDocument: { addEventListener: noop, removeEventListener: noop } };
    function Probe() {
      const engine = useEngineHealth(client);
      retry = engine.retry;
      if (seen.at(-1) !== engine.health) seen.push(engine.health);
      return null;
    }
    const root = createRoot(container as unknown as Element);
    await act(async () => { root.render(<Probe />); });
    if (options.retryAfterMs !== undefined) {
      await act(async () => { await Bun.sleep(options.retryAfterMs!); });
      await act(async () => { await retry?.(); });
    }
    await act(async () => { await Bun.sleep(waitMs); });
    await act(async () => { root.unmount(); });
  } finally {
    if (windowBefore) Object.defineProperty(globalThis, "window", windowBefore); else delete host.window;
    if (actBefore) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", actBefore); else delete host.IS_REACT_ACT_ENVIRONMENT;
  }
  return { seen, calls, restarts, canRetry: retry !== undefined };
}

test("#454: while the engine restarts, the status bar polls quickly and returns to ready", async () => {
  const { seen, calls } = await observe(["starting", "ready"], 2_300);
  expect(seen).toEqual([null, "restarting", "ready"]);
  expect(calls).toBe(2);
}, 10_000);

test("#454: an engine that could not be restarted shows as unavailable", async () => {
  const { seen } = await observe(["error"], 50);
  expect(seen).toEqual([null, "unavailable"]);
});

test("#454: an unreachable /health leaves the server indicator in charge", async () => {
  const { seen } = await observe([new Error("offline")], 50);
  expect(seen).toEqual([null]);
});

test("#454: Try again asks the server for a new restart round and polls at the outage pace", async () => {
  // error → user clicks Try again → server restarts → ready, without waiting for the 10 s ready-pace poll.
  const { seen, calls, restarts } = await observe(["error", "starting", "ready"], 2_300, { retryAfterMs: 50 });
  expect(restarts).toBe(1);
  expect(seen).toEqual([null, "unavailable", "restarting", "ready"]);
  expect(calls).toBe(3);
}, 10_000);

test("#454: a client without the restart call offers no Try again", async () => {
  expect((await observe(["error"], 50)).canRetry).toBe(false);
  expect((await observe(["error"], 50, { withRestart: true })).canRetry).toBe(true);
});
