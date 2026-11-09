import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUpdaterPreferences, UPDATER_PREFERENCES_FILENAME } from "../../desktop/electron/updater-preferences.mjs";
import { loadUpdatePreferences, saveUpdatePreferences } from "../src/react-app/domains/settings/state/update-preferences";
import { checkForUpdatesInBackground } from "../src/react-app/domains/settings/state/electron-updater-state";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const roots: string[] = [];
afterEach(async () => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "legalwork-updater-renderer-"));
  roots.push(root);
  await mkdir(join(root, "Local Storage"));
  const app = { getPath: () => root };
  let native = createUpdaterPreferences(app);
  const localStorage = new Map<string, string>();
  let blockedStorage = false;
  let checks = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: {
      getItem: (key: string) => { if (blockedStorage) throw new Error("Storage unavailable"); return localStorage.get(key) ?? null; },
      setItem: (key: string, value: string) => { if (blockedStorage) throw new Error("Storage unavailable"); localStorage.set(key, value); },
    },
    __LEGALWORK_ELECTRON__: { updater: {
      getPreferences: (legacy: { autoCheck?: boolean; autoDownload?: boolean }) => native.read(legacy),
      setPreferences: (patch: { autoCheck?: boolean; autoDownload?: boolean }) => native.write(patch),
      check: async () => { checks += 1; return { available: false }; },
    } },
  } });
  return { root, localStorage, restart: () => { native = createUpdaterPreferences(app); }, blockStorage: () => { blockedStorage = true; }, checks: () => checks };
}

test("startup makes no updater request after disabled preferences survive browser storage deletion", async () => {
  const f = await fixture();
  f.localStorage.set("legalwork.react.settings.update-auto-check", "0");
  expect(await loadUpdatePreferences()).toEqual({ autoCheck: false, autoDownload: false });
  f.localStorage.clear();
  f.restart();
  await checkForUpdatesInBackground();
  expect(f.checks()).toBe(0);
  expect(await loadUpdatePreferences()).toEqual({ autoCheck: false, autoDownload: false });
});

test("explicit updater changes persist independently of inaccessible localStorage", async () => {
  const f = await fixture();
  f.blockStorage();
  expect(await loadUpdatePreferences()).toEqual({ autoCheck: false, autoDownload: false });
  expect(await saveUpdatePreferences({ autoCheck: true })).toEqual({ autoCheck: true, autoDownload: false });
  f.restart();
  expect(await loadUpdatePreferences()).toEqual({ autoCheck: true, autoDownload: false });
});

test("corrupt native settings override stale enabled browser flags without overwriting them on load", async () => {
  const f = await fixture();
  f.localStorage.set("legalwork.react.settings.update-auto-check", "1");
  await writeFile(join(f.root, UPDATER_PREFERENCES_FILENAME), "{");
  expect(await loadUpdatePreferences()).toEqual({ autoCheck: false, autoDownload: false });
  expect(f.localStorage.get("legalwork.react.settings.update-auto-check")).toBe("1");
});
