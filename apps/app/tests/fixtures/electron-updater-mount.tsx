import { strict as assert } from "node:assert";
import { act } from "react";

const scenario = process.argv[2];
const native = scenario?.startsWith("native") ?? false;
const values = new Map<string, string>();
const storage: Storage = {
  get length() { return values.size; },
  key: (index) => [...values.keys()][index] ?? null,
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, value); },
  removeItem: (key) => { values.delete(key); },
  clear: () => { values.clear(); },
};
const descriptors = new Map(["window", "localStorage", "IS_REACT_ACT_ENVIRONMENT", "fetch"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const channels: Array<string | undefined> = [];
const errors: Array<string | null> = [];
let networkCalls = 0;
const channel = { channel: "stable", feedUrl: "https://synthetic.invalid", currentVersion: "0.3.5" };
const updater = {
  getChannel: async () => channel,
  check: scenario === "native-missing-check" ? undefined : async (selected?: string) => {
    channels.push(selected);
    return { available: false, currentVersion: channel.currentVersion, channel: channel.channel };
  },
};

try {
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: storage, event: undefined, HTMLIFrameElement: class {},
    __LEGALWORK_ELECTRON__: native ? { updater } : undefined,
  } });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: async () => { networkCalls++; throw new Error("fixture_network_denied"); } });
  // Production imports happen only after this isolated process owns complete storage and window.
  const { createRoot } = await import("react-dom/client");
  const { useElectronUpdaterState } = await import("../../src/react-app/domains/settings/state/electron-updater-state");
  const { useUpdateStatusStore } = await import("../../src/react-app/domains/settings/state/update-status-store");
  const { useUpdateCheckRequestStore } = await import("../../src/react-app/domains/settings/state/update-check-request");
  const originalStatus = useUpdateStatusStore.getState().status;
  const originalRequest = useUpdateCheckRequestStore.getState().requestedAt;
  if (scenario === "native-menu") useUpdateCheckRequestStore.getState().requestUpdateCheck();
  const retained = scenario === "native-ready" ? { state: "ready", version: "0.3.6" } satisfies NonNullable<typeof originalStatus>
    : scenario === "native-downloading" ? { state: "downloading", downloadedBytes: 12 } satisfies NonNullable<typeof originalStatus>
    : scenario === "native-available" ? { state: "available", version: "0.3.6" } satisfies NonNullable<typeof originalStatus> : null;
  useUpdateStatusStore.getState().setStatus(retained);
  const latest: { current: ReturnType<typeof useElectronUpdaterState> | null } = { current: null };
  const options: Parameters<typeof useElectronUpdaterState>[0] = {
    releaseChannel: "stable", onReleaseChannelChange: () => undefined,
    updateAutoCheck: scenario !== "native-disabled" && scenario !== "native-menu" && scenario !== "manual-web",
    updateAutoDownload: false, setError: (message) => { errors.push(message); },
  };
  function Probe() { latest.current = useElectronUpdaterState(options); return null; }
  const noop = () => undefined;
  // Null-rendering probes need only React DOM's root/event boundary, not a simulated document tree.
  const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", addEventListener: noop, removeEventListener: noop, ownerDocument: { addEventListener: noop, removeEventListener: noop } };
  const root = createRoot(container as unknown as Element);
  try {
    await act(async () => { root.render(<Probe />); });
    assert.deepEqual(errors, [], "mount must not report an unsupported updater operation");
    const current = latest.current;
    assert(current, "hook mounted");
    if (scenario === "manual-web") {
      await act(async () => { await current.checkForUpdates(); });
      assert.deepEqual(errors, ["Electron update checks are available only in the Electron desktop app."]);
      assert.equal(useUpdateStatusStore.getState().status?.state, "error");
    } else if (scenario === "native" || scenario === "native-menu") {
      assert(channels.length > 0, "native automatic check must run");
      assert(channels.every((value) => value === "stable"));
      assert.equal(useUpdateStatusStore.getState().status?.state, "idle");
      assert.equal(useUpdateCheckRequestStore.getState().requestedAt, null);
    } else {
      assert.equal(channels.length, 0, "unsupported, disabled or retained states must not check");
      assert.deepEqual(useUpdateStatusStore.getState().status, retained);
    }
    assert.equal(networkCalls, 0);
  } finally {
    await act(async () => { root.unmount(); });
    useUpdateStatusStore.getState().setStatus(originalStatus);
    useUpdateCheckRequestStore.setState({ requestedAt: originalRequest });
  }
} finally {
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
  }
}
