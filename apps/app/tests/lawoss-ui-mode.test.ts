import { afterEach, beforeEach, describe, expect, test } from "bun:test";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => { storage.set(k, v); },
    removeItem: (k: string) => { storage.delete(k); },
    clear: () => storage.clear(),
    key: (i: number) => [...storage.keys()][i] ?? null,
    get length() { return storage.size; },
  },
  configurable: true,
});

const mode = await import("../src/lawoss/lite/ui-mode");
const ACTIVE_WORKSPACE_KEY = "legalwork.react.activeWorkspace";

beforeEach(() => { storage.clear(); mode.reloadUiModeFromStorage(); });
afterEach(() => storage.clear());

describe("režim zobrazení lite/pro", () => {
  test("čistá instalace začíná v lite a volbu uloží", () => {
    expect(mode.currentUiMode()).toBe("lite");
    expect(storage.get(mode.UI_MODE_STORAGE_KEY)).toBe("lite");
  });

  test("existující instalace (aktivní workspace, bez volby) zůstane v pro", () => {
    // beforeEach výše už jednou zavolal reloadUiModeFromStorage() nad prázdným
    // úložištěm, což podle pravidla „uložená volba má přednost“ (viz test níže)
    // samo vloží výchozí "lite" do úložiště. Bez smazání by test už neověřoval
    // deklarovaný scénář „bez volby“, ale nerozeznatelný duplikát testu níže.
    storage.delete(mode.UI_MODE_STORAGE_KEY);
    storage.set(ACTIVE_WORKSPACE_KEY, "ws_1");
    mode.reloadUiModeFromStorage();
    expect(mode.currentUiMode()).toBe("pro");
    expect(storage.get(mode.UI_MODE_STORAGE_KEY)).toBe("pro");
  });

  test("uložená volba má přednost", () => {
    storage.set(ACTIVE_WORKSPACE_KEY, "ws_1");
    storage.set(mode.UI_MODE_STORAGE_KEY, "lite");
    mode.reloadUiModeFromStorage();
    expect(mode.currentUiMode()).toBe("lite");
  });

  test("neznámá hodnota spadne na odvozenou výchozí", () => {
    for (const bad of ["LITE", "xyz", "{\"a\":1}", ""]) {
      storage.clear();
      storage.set(mode.UI_MODE_STORAGE_KEY, bad);
      mode.reloadUiModeFromStorage();
      expect(mode.currentUiMode()).toBe("lite");
    }
  });

  test("přepnutí uloží hodnotu a upozorní odběratele jen při změně", () => {
    let calls = 0;
    const off = mode.subscribeUiMode(() => { calls++; });
    mode.setUiMode("pro");
    mode.setUiMode("pro");
    expect(calls).toBe(1);
    expect(storage.get(mode.UI_MODE_STORAGE_KEY)).toBe("pro");
    expect(mode.isLite()).toBe(false);
    off();
  });
});
