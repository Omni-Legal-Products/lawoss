import { expect, test } from "bun:test";
import { act } from "react";
import { reportEngineHealth, useEngineHealth, useEngineHealthPolling } from "../src/lawoss/shell/engine-status";

type Status = "starting" | "ready" | "error";

/** Mounts the poller with a fake server client in React DOM without a browser; globals are restored afterwards. */
async function poll(statuses: Status[], waitMs: number) {
  const host = globalThis as { window?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
  const windowBefore = Object.getOwnPropertyDescriptor(globalThis, "window");
  const actBefore = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Object.defineProperty(globalThis, "window", { value: { event: undefined, HTMLIFrameElement: class {} }, configurable: true, writable: true });
  host.IS_REACT_ACT_ENVIRONMENT = true;
  const seen: Array<string | null> = [];
  let calls = 0;
  const client = {
    health: async () => ({ ok: true, version: "test", uptimeMs: 1, engine: { status: statuses[Math.min(calls++, statuses.length - 1)]! } }),
    restartEngine: async () => ({ restarting: true, engine: { status: "starting" as const } }),
  };
  try {
    const { createRoot } = await import("react-dom/client");
    const noop = () => undefined;
    const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", addEventListener: noop, removeEventListener: noop, ownerDocument: { addEventListener: noop, removeEventListener: noop } };
    function Probe() {
      useEngineHealthPolling(client);
      const health = useEngineHealth();
      if (seen.at(-1) !== health) seen.push(health);
      return null;
    }
    const root = createRoot(container as unknown as Element);
    await act(async () => { root.render(<Probe />); });
    await act(async () => { await Bun.sleep(waitMs); });
    await act(async () => { root.unmount(); });
  } finally {
    reportEngineHealth(null);
    if (windowBefore) Object.defineProperty(globalThis, "window", windowBefore); else delete host.window;
    if (actBefore) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", actBefore); else delete host.IS_REACT_ACT_ENVIRONMENT;
  }
  return { seen, calls };
}

// The server store polls /health only while Settings is mounted; the chat's status bar must not depend on it.
test("#477: the status bar polls the engine itself and sees a recovery within seconds", async () => {
  const { seen, calls } = await poll(["error", "ready"], 5_400);
  expect(seen).toEqual([null, "error", "ready"]);
  expect(calls).toBe(2);
}, 15_000);

test("#477: while the engine starts the status bar asks every 2 s", async () => {
  const { seen, calls } = await poll(["starting", "starting", "ready"], 4_400);
  expect(seen).toEqual([null, "starting", "ready"]);
  expect(calls).toBe(3);
}, 15_000);
