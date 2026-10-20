import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { toast as sonnerToast } from "sonner";

import { toast } from "../src/components/ui/sonner";

describe("sonner toast wrapper", () => {
  // Dismiss notifies real subscribers asynchronously even though these tests
  // inspect synchronous Observer state. Own only our missing-runtime adapter;
  // leaking it makes later SSR imports initialize browser animation lifecycles.
  let previousFrame: PropertyDescriptor | undefined;
  const frames = new Set<Promise<void>>();
  beforeEach(() => {
    previousFrame = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
    if (typeof globalThis.requestAnimationFrame !== "undefined") return;
    Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback) => {
      let complete!: () => void;
      const frame = new Promise<void>(resolve => { complete = resolve; });
      frames.add(frame);
      return setTimeout(() => {
        try { callback(performance.now()); }
        finally { frames.delete(frame); complete(); }
      }, 0) as unknown as number;
    } });
  });
  afterEach(async () => {
    try { while (frames.size) await Promise.all([...frames]); }
    finally {
      if (previousFrame) Object.defineProperty(globalThis, "requestAnimationFrame", previousFrame);
      else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    }
  });

  test("app errors target only the app host, excluding embedded editors' default hosts", () => {
    const id = toast.error("Cannot move the open file");
    const entry = sonnerToast.getToasts().find(entry => entry.id === id);
    expect(entry?.toasterId).toBe("legalwork-app");
    // Sonner default hosts render only notifications without a toasterId.
    expect(sonnerToast.getToasts().filter(entry => entry.id === id && !entry.toasterId)).toHaveLength(0);
    sonnerToast.dismiss(id);
  });
  test("the stored toast carries the id the wrapper returns (X button can dismiss it)", () => {
    // Regression: passing a literal `id: undefined` through to sonner's
    // custom() clobbered the generated id (`{jsx: jsx(id), id, ...data}`), so
    // the stored toast got a different id than the one the ToastCard's X
    // button dismisses. Error toasts with duration: Infinity then could never
    // be closed (issue #62, "clicking the X icon does nothing").
    const returned = toast.error("OpenCode unavailable", {
      description: "engine down",
      action: { label: "Retry", onClick: () => {} },
      duration: Infinity,
    });

    const active = sonnerToast.getToasts();
    expect(active.some((entry) => entry.id === returned)).toBe(true);

    sonnerToast.dismiss(returned);
    expect(sonnerToast.getToasts().some((entry) => entry.id === returned)).toBe(false);
  });

  test("an explicit toast id is preserved", () => {
    const returned = toast("summary", { id: "legalwork-notification-alert" });
    expect(returned).toBe("legalwork-notification-alert");
    expect(sonnerToast.getToasts().some((entry) => entry.id === returned)).toBe(true);
    sonnerToast.dismiss(returned);
    expect(sonnerToast.getToasts().some((entry) => entry.id === returned)).toBe(false);
  });
});
