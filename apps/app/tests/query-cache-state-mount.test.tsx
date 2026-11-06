import { expect, test } from "bun:test";
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
