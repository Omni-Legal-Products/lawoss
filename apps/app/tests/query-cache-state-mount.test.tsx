import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { useQueryCacheState } from "../src/react-app/infra/query-cache-state";

test("creating a query in a sibling render updates cache readers after render", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  const originalError = console.error;
  const warnings: string[] = [];
  const observed: string[] = [];
  const client = getReactQueryClient();
  const key = ["query-cache-state-mount-regression"];
  Object.defineProperty(globalThis, "window", { configurable: true, value: { event: undefined, HTMLIFrameElement: class {} } });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(" ")); };
  try {
    const { createRoot } = await import("react-dom/client");
    const noop = () => undefined;
    // This host implements only React's root/event boundary: both probes render no DOM nodes.
    const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", addEventListener: noop, removeEventListener: noop, ownerDocument: { addEventListener: noop, removeEventListener: noop } };
    const root = createRoot(container as unknown as Element);
    function Reader() {
      observed.push(useQueryCacheState(key, "missing"));
      return null;
    }
    function Creator() {
      useQuery({ queryKey: key, initialData: "ready", enabled: false });
      return null;
    }
    try {
      await act(async () => { root.render(<QueryClientProvider client={client}><Reader /></QueryClientProvider>); });
      await act(async () => {
        root.render(<QueryClientProvider client={client}><Reader /><Creator /></QueryClientProvider>);
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
      expect(observed[0]).toBe("missing");
      expect(observed.at(-1)).toBe("ready");
      expect(warnings.filter((warning) => warning.includes("Cannot update a component"))).toEqual([]);
    } finally {
      await act(async () => { root.unmount(); });
      client.removeQueries({ queryKey: key });
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    console.error = originalError;
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
    if (originalAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", originalAct); else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});

/** Skutočný koreň React DOM s čítačkou cache; probe nevykresľuje žiadne uzly DOM. */
async function withReader(initialKey: readonly unknown[] | null, run: (reader: { rerender: (key: readonly unknown[] | null) => Promise<void>; observed: string[] }) => Promise<void>) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalAct = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { event: undefined, HTMLIFrameElement: class {} } });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  try {
    const { createRoot } = await import("react-dom/client");
    const noop = () => undefined;
    const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", addEventListener: noop, removeEventListener: noop, ownerDocument: { addEventListener: noop, removeEventListener: noop } };
    const root = createRoot(container as unknown as Element);
    const observed: string[] = [];
    function Reader({ queryKey }: { queryKey: readonly unknown[] | null }) {
      observed.push(useQueryCacheState(queryKey, "missing"));
      return null;
    }
    try {
      await act(async () => { root.render(<Reader queryKey={initialKey} />); });
      await run({ observed, rerender: async (key) => { await act(async () => { root.render(<Reader queryKey={key} />); }); } });
    } finally {
      await act(async () => { root.unmount(); });
    }
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow); else Reflect.deleteProperty(globalThis, "window");
    if (originalAct) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", originalAct); else Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
}

/** Zmena v cache a odložené upozornenia `notifyManager`, kým React dobehne. */
const change = (key: readonly unknown[], value: string) => act(async () => {
  getReactQueryClient().setQueryData(key, value);
  await new Promise((resolve) => setTimeout(resolve, 5));
});

/** Prebudená čítačka si znova prečíta hodnotu; samotný počet renderov by to nezistil, React nezmenenú hodnotu preskočí. */
function countReads(key: readonly unknown[]) {
  const client = getReactQueryClient();
  const read = client.getQueryData.bind(client);
  const hash = JSON.stringify(key);
  let reads = 0;
  const spy = spyOn(client, "getQueryData").mockImplementation(((queryKey: readonly unknown[]) => {
    if (JSON.stringify(queryKey) === hash) reads += 1;
    return read(queryKey);
  }) as typeof client.getQueryData);
  return { reads: () => reads, restore: () => spy.mockRestore() };
}

describe("useQueryCacheState počúva len svoju query", () => {
  const mine = ["query-cache-state-mine"];
  const other = ["query-cache-state-other"];
  afterEach(() => { for (const key of [mine, other]) getReactQueryClient().removeQueries({ queryKey: key }); });

  test("zmena inej query čítačku neprebudí, zmena jej vlastnej áno", async () => {
    await withReader(mine, async ({ observed }) => {
      const counted = countReads(mine);
      try {
        await change(other, "cudzia hodnota");
        await change(other, "ďalšia cudzia hodnota");
        expect(counted.reads()).toBe(0);
        await change(mine, "moja hodnota");
        expect(counted.reads()).toBeGreaterThan(0);
        expect(observed.at(-1)).toBe("moja hodnota");
      } finally { counted.restore(); }
    });
  });

  test("odstránenie vlastnej query vráti záložnú hodnotu", async () => {
    await withReader(mine, async ({ observed }) => {
      await change(mine, "moja hodnota");
      await act(async () => {
        getReactQueryClient().removeQueries({ queryKey: mine });
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
      expect(observed.at(-1)).toBe("missing");
    });
  });

  test("ďalšie rendery sa neprihlasujú do cache znova", async () => {
    const subscribe = spyOn(getReactQueryClient().getQueryCache(), "subscribe");
    try {
      await withReader(mine, async ({ rerender }) => {
        // Rovnaká query v novom poli: kľúč sa volajúcim vytvára pri každom renderi.
        await rerender([...mine]);
        await rerender([...mine]);
        expect(subscribe).toHaveBeenCalledTimes(1);
      });
    } finally { subscribe.mockRestore(); }
  });

  test("po zmene kľúča počúva novú query a starú už nie", async () => {
    await withReader(mine, async ({ rerender, observed }) => {
      await rerender(other);
      await change(other, "nová query");
      expect(observed.at(-1)).toBe("nová query");
      const counted = countReads(other);
      try {
        await change(mine, "stará query");
        expect(counted.reads()).toBe(0);
        expect(observed.at(-1)).toBe("nová query");
      } finally { counted.restore(); }
    });
  });

  test("bez kľúča ostane záložná hodnota a do cache sa neprihlási", async () => {
    const subscribe = spyOn(getReactQueryClient().getQueryCache(), "subscribe");
    try {
      await withReader(null, async ({ observed }) => {
        await change(mine, "hodnota");
        expect(subscribe).not.toHaveBeenCalled();
        expect(observed.at(-1)).toBe("missing");
      });
    } finally { subscribe.mockRestore(); }
  });
});
