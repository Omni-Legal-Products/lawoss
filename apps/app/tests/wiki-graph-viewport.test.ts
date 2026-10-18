import { expect, test } from "bun:test";
import { observeGraphViewport } from "../src/react-app/domains/wiki/wiki-graph-viewport";

test("hidden graph tabs initialize only with a viewport and refresh on repeated reveals", () => {
  const original = globalThis.ResizeObserver;
  let notify = () => {};
  let disconnected = false;
  globalThis.ResizeObserver = class implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) { notify = () => callback([], this); }
    observe() {}
    unobserve() {}
    disconnect() { disconnected = true; }
  };
  try {
    const element = Object.assign(Object.create(null), { clientWidth: 0, clientHeight: 0 });
    let updates = 0;
    const stop = observeGraphViewport(element, () => updates++);
    expect(updates).toBe(0);
    element.clientWidth = 900; notify();
    expect(updates).toBe(0);
    element.clientHeight = 700; notify();
    expect(updates).toBe(1);
    element.clientWidth = 0; element.clientHeight = 0; notify();
    expect(updates).toBe(1);
    element.clientWidth = 900; element.clientHeight = 700; notify();
    expect(updates).toBe(2);
    stop(); expect(disconnected).toBe(true);
  } finally { globalThis.ResizeObserver = original; }
});
