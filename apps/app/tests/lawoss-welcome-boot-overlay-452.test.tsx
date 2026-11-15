import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { act, useEffect } from "react";
import { BootStateProvider, useBootOverlayVisible, useBootState } from "../src/react-app/shell/boot-state";
import { useRouteReadyOnMount } from "../src/lawoss/shell/route-ready";

const saved = ["window", "IS_REACT_ACT_ENVIRONMENT"].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
afterEach(() => {
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

/** Boot finished (`markReady`) and only the given route is mounted, as after a reload on that route. */
async function overlayAfterReloadOn(Route: () => null): Promise<boolean> {
  const noop = () => undefined;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { event: undefined, HTMLIFrameElement: class {}, setTimeout, clearTimeout } });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true, writable: true });
  const { createRoot } = await import("react-dom/client");
  const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", addEventListener: noop, removeEventListener: noop, ownerDocument: { addEventListener: noop, removeEventListener: noop } };
  const root = createRoot(container as unknown as Element);
  let visible = true;
  function DesktopBootReady() {
    const { markReady } = useBootState();
    useEffect(() => markReady(), [markReady]);
    return null;
  }
  function OverlayProbe() {
    visible = useBootOverlayVisible();
    return null;
  }
  try {
    await act(async () => root.render(<BootStateProvider><DesktopBootReady /><OverlayProbe /><Route /></BootStateProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    return visible;
  } finally {
    await act(async () => root.unmount());
  }
}

test("a route that marks itself ready on mount lets the boot overlay hide after a reload", async () => {
  expect(await overlayAfterReloadOn(() => { useRouteReadyOnMount(); return null; })).toBe(false);
});

test("without the route marking itself ready the overlay stays up (the #452 symptom)", async () => {
  expect(await overlayAfterReloadOn(() => null)).toBe(true);
});

test("/welcome marks itself ready before any early return", () => {
  const source = readFileSync(new URL("../src/react-app/shell/welcome-route.tsx", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export function WelcomeRoute()"));
  const call = body.indexOf("useRouteReadyOnMount();");
  expect(call).toBeGreaterThan(0);
  expect(call).toBeLessThan(body.indexOf("if (error) return"));
});
