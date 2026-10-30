import { afterEach, expect, test } from "bun:test";
import { act, StrictMode, useState } from "react";
import { MemoryRouter, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { usePageNavigation } from "../src/lawoss/shell/use-page-navigation";

const windowBefore = Object.getOwnPropertyDescriptor(globalThis, "window");
const actBefore = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
afterEach(() => {
  for (const [name, descriptor] of [["window", windowBefore], ["IS_REACT_ACT_ENVIRONMENT", actBefore]] as const) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

async function mount(run: (control: { complete: (to: string) => void; refresh: () => void; move: (to: string) => void; back: () => void; path: () => string; unmount: () => void }) => Promise<void>) {
  Object.defineProperty(globalThis, "window", { configurable: true, value: { event: undefined, HTMLIFrameElement: class {} } });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true, writable: true });
  const { createRoot } = await import("react-dom/client");
  const noop = () => undefined;
  const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", addEventListener: noop, removeEventListener: noop, ownerDocument: { addEventListener: noop, removeEventListener: noop } };
  const root = createRoot(container as unknown as Element);
  let complete: (to: string) => void = noop;
  let refresh = noop;
  let move: NavigateFunction = noop;
  let path = "";
  function Body({ navigate }: { navigate: (to: string) => void }) { complete = navigate; return null; }
  function Page() {
    const navigate = usePageNavigation();
    const [loaded, setLoaded] = useState(true);
    refresh = () => setLoaded(value => !value);
    return loaded ? <Body navigate={navigate} /> : null;
  }
  function RouterProbe() {
    const location = useLocation();
    path = location.pathname;
    move = useNavigate();
    return path.startsWith("/case/") ? <Page /> : null;
  }
  let mounted = true;
  const unmount = () => { if (mounted) { mounted = false; root.unmount(); } };
  try {
    await act(async () => root.render(<StrictMode><MemoryRouter initialEntries={["/case/a"]}><RouterProbe /></MemoryRouter></StrictMode>));
    // Keep the original async completion, as a click handler does before awaiting activation.
    const pending = complete;
    await run({ complete: pending, refresh: () => refresh(), move: to => move(to), back: () => move(-1), path: () => path, unmount });
  } finally { await act(async () => unmount()); }
}

test("a pending chat navigation survives the data panel unmounting during connection refresh", async () => {
  await mount(async control => {
    await act(async () => control.refresh());
    await act(async () => control.complete("/workspace/client/session/new-chat"));
    expect(control.path()).toBe("/workspace/client/session/new-chat");
  });
});

test("a late result cannot redirect from a different case", async () => {
  await mount(async control => {
    await act(async () => control.move("/case/b"));
    await act(async () => control.complete("/workspace/client/session/old-chat"));
    expect(control.path()).toBe("/case/b");
  });
});

test("leaving and returning to the same case does not revive an old request", async () => {
  await mount(async control => {
    await act(async () => control.move("/case/b"));
    await act(async () => control.move("/case/a"));
    await act(async () => control.complete("/workspace/client/session/old-chat"));
    expect(control.path()).toBe("/case/a");
  });
});

test("an unmounted page discards its pending navigation", async () => {
  await mount(async control => {
    await act(async () => control.unmount());
    expect(() => control.complete("/workspace/client/session/old-chat")).not.toThrow();
    expect(control.path()).toBe("/case/a");
  });
});

test("browser Back does not revive a request from an earlier visit with the same history key", async () => {
  await mount(async control => {
    await act(async () => control.move("/case/b"));
    await act(async () => control.back());
    await act(async () => control.complete("/workspace/client/session/old-chat"));
    expect(control.path()).toBe("/case/a");
  });
});

test("leaving the page while a request runs keeps the newly selected screen", async () => {
  await mount(async control => {
    await act(async () => control.move("/clients"));
    await act(async () => control.complete("/workspace/client/session/old-chat"));
    expect(control.path()).toBe("/clients");
  });
});
