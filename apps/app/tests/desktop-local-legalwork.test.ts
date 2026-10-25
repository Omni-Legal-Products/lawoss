import { afterEach, expect, test } from "bun:test";
import { ensureDesktopLocalLegalworkConnection } from "../src/react-app/shell/desktop-local-legalwork";
import { readLegalworkServerSettings, writeLegalworkServerSettings } from "../src/app/lib/legalwork-server";

const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

function fixture(running = true) {
  const storage = new Map<string, string>();
  const target = new EventTarget();
  const info = { baseUrl: "http://127.0.0.1:43210", port: 43210, ownerToken: "synthetic-owner", hostToken: "synthetic-host", remoteAccessEnabled: false };
  let changes = 0;
  let starts = 0;
  target.addEventListener("legalwork-server-settings-changed", () => { changes++; });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); }, removeItem: (key: string) => { storage.delete(key); } },
    dispatchEvent: target.dispatchEvent.bind(target),
    __LEGALWORK_ELECTRON__: { invokeDesktop: async (command: string) => {
      if (command === "engineInfo") return { running, baseUrl: running ? info.baseUrl : null };
      if (command === "engineStart") { starts++; running = true; return { running, baseUrl: info.baseUrl }; }
      if (command === "legalworkServerInfo") return info;
      throw new Error(`Unexpected native command: ${command}`);
    } },
  } });
  const workspace = { id: "client", path: "/synthetic/client", workspaceType: "local" };
  const ensure = () => ensureDesktopLocalLegalworkConnection({ route: "session", workspace, allWorkspaces: [workspace] });
  const settings = { urlOverride: info.baseUrl, portOverride: info.port, token: info.ownerToken, hostToken: info.hostToken, remoteAccessEnabled: false };
  return { info, ensure, settings, changes: () => changes, starts: () => starts };
}

test("opening another panel on the same running connection does not reset its subscribers", async () => {
  const f = fixture();
  writeLegalworkServerSettings(f.settings);
  await f.ensure();
  await f.ensure();
  expect(f.changes()).toBe(0);
  expect(f.starts()).toBe(0);
});

test("first connection and each credential, address, port or access change still notify subscribers", async () => {
  const f = fixture();
  await f.ensure();
  expect(f.changes()).toBe(1);
  for (const change of [
    { ownerToken: "rotated-owner" }, { hostToken: "rotated-host" },
    { baseUrl: "http://127.0.0.1:43211" }, { port: 43211 }, { remoteAccessEnabled: true },
  ]) {
    const before = f.changes();
    Object.assign(f.info, change);
    await f.ensure();
    expect(f.changes()).toBe(before + 1);
  }
  expect(readLegalworkServerSettings().token).toBe("rotated-owner");
});

test("restarting the engine refreshes subscribers even when its connection settings stay the same", async () => {
  const f = fixture(false);
  writeLegalworkServerSettings(f.settings);
  await f.ensure();
  expect(f.starts()).toBe(1);
  expect(f.changes()).toBe(1);
});
