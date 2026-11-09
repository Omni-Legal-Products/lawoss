import { afterEach, expect, test } from "bun:test";
import { readLegalworkServerSettings, writeLegalworkServerSettings } from "../src/app/lib/legalwork-server";
import { captureOfficeLaunch, OFFICE_LAUNCH_KEY, officeServerSettings } from "../src/word-addin/office-launch";

// 🟡 LAWOSS (MČ 8. 11. 2026): Office installation key only in sessionStorage; the pane never holds a host token.
function memoryStorage(): Storage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); }, clear: () => values.clear(), key: index => [...values.keys()][index] ?? null, get length() { return values.size; } };
}

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

const launch = "L".repeat(64);

test("the installation key from the fragment goes to sessionStorage, never to localStorage", () => {
  const session = memoryStorage(), local = memoryStorage(), replaced: string[] = [];
  const location = { hash: `#office_launch=${launch}`, pathname: "/word-addin/app.html", search: "" };
  expect(captureOfficeLaunch({ location, history: { replaceState: (_s, _t, url) => { replaced.push(String(url)); } }, session: () => session, local: () => local })).toBe(launch);
  expect(session.values.get(OFFICE_LAUNCH_KEY)).toBe(launch);
  expect([...local.values.values()]).not.toContain(launch);
  expect(replaced).toEqual(["/word-addin/app.html"]);
  // A reload without the fragment reuses the session copy only.
  expect(captureOfficeLaunch({ location: { ...location, hash: "" }, history: { replaceState() {} }, session: () => session, local: () => local })).toBe(launch);
  expect(local.values.size).toBe(0);
});

test("a key an older shell left in localStorage is moved to the session and deleted", () => {
  const session = memoryStorage(), local = memoryStorage();
  local.setItem(OFFICE_LAUNCH_KEY, launch);
  expect(captureOfficeLaunch({ location: { hash: "", pathname: "/", search: "" }, history: { replaceState() {} }, session: () => session, local: () => local })).toBe(launch);
  expect(local.values.has(OFFICE_LAUNCH_KEY)).toBe(false);
  expect(session.values.get(OFFICE_LAUNCH_KEY)).toBe(launch);
});

test("storage failures never persist the key; an invalid fragment is ignored", () => {
  const local = memoryStorage();
  const blocked = () => { throw new Error("blocked"); };
  expect(captureOfficeLaunch({ location: { hash: `#office_launch=${launch}`, pathname: "/", search: "" }, history: { replaceState() {} }, session: blocked, local: () => local })).toBe(launch);
  expect(local.values.size).toBe(0);
  expect(captureOfficeLaunch({ location: { hash: "#office_launch=short", pathname: "/", search: "" }, history: { replaceState() {} }, session: () => memoryStorage(), local: () => local })).toBe("");
});

test("the pane stores only an office_ token and drops an earlier host token", () => {
  const localStorage = memoryStorage();
  Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), { localStorage }) });
  writeLegalworkServerSettings({ urlOverride: "https://localhost:45999", token: "owt_old_client", hostToken: "host_old_token" });
  expect(readLegalworkServerSettings().hostToken).toBe("host_old_token");
  writeLegalworkServerSettings(officeServerSettings("https://localhost:45999", "office_paired"));
  const stored = readLegalworkServerSettings();
  expect(stored.token).toBe("office_paired");
  expect(stored.hostToken).toBeUndefined();
  expect([...localStorage.values.values()]).not.toContain("host_old_token");
  expect(() => officeServerSettings("https://localhost:45999", "host_old_token")).toThrow();
});
