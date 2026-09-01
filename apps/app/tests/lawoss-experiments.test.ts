import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// Minimal localStorage stub — same shape the other store tests use under bun.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => storage.clear(),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size;
    },
  },
  configurable: true,
});

const { EXPERIMENTS, EXPERIMENT_FLAGS, EXPERIMENT_VIEWS } = await import("../src/lawoss/experiments/registry");
const { LAWOSS_ROUTES } = await import("../src/lawoss/shell/routes");
const { EXPERIMENTY_PATH, visibleNavItems } = await import("../src/lawoss/shell/layout");
const { isExperimentOn, reloadExperimentsFromStorage, resetExperiments, setExperiment } = await import(
  "../src/lawoss/experiments/store"
);

const STORAGE_KEY = "lawoss.experiments";
const FLAG = "sidebar-registrove-zalozky";

beforeEach(() => {
  storage.clear();
  reloadExperimentsFromStorage();
});

afterEach(() => {
  resetExperiments();
  storage.clear();
});

describe("registry", () => {
  test("ids are unique", () => {
    const ids = EXPERIMENTS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every view points at a route that actually exists", () => {
    const routes = new Set(LAWOSS_ROUTES.map((route) => route.path));
    for (const view of EXPERIMENT_VIEWS) {
      expect(routes.has(view.to)).toBe(true);
    }
  });

  test("flags and views together cover the whole registry", () => {
    expect(EXPERIMENT_FLAGS.length + EXPERIMENT_VIEWS.length).toBe(EXPERIMENTS.length);
  });
});

describe("store", () => {
  test("a flag is off until someone turns it on", () => {
    expect(isExperimentOn(FLAG)).toBe(false);
  });

  test("toggling holds and survives a reboot", () => {
    setExperiment(FLAG, true);
    expect(isExperimentOn(FLAG)).toBe(true);

    reloadExperimentsFromStorage();
    expect(isExperimentOn(FLAG)).toBe(true);
  });

  test("turning it back off persists too", () => {
    setExperiment(FLAG, true);
    setExperiment(FLAG, false);
    reloadExperimentsFromStorage();
    expect(isExperimentOn(FLAG)).toBe(false);
  });

  test("unknown ids stay false and are not writable", () => {
    setExperiment("nikdy-neexistoval", true);
    expect(isExperimentOn("nikdy-neexistoval")).toBe(false);
  });

  test("a deleted experiment cannot be revived from an old profile", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ "zmazany-experiment": true }));
    reloadExperimentsFromStorage();
    expect(isExperimentOn("zmazany-experiment")).toBe(false);
  });

  test("corrupted storage falls back to all-off instead of throwing", () => {
    localStorage.setItem(STORAGE_KEY, "{ toto nie je json");
    expect(() => reloadExperimentsFromStorage()).not.toThrow();
    expect(isExperimentOn(FLAG)).toBe(false);
  });

  test("non-boolean values are ignored", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ [FLAG]: "ano" }));
    reloadExperimentsFromStorage();
    expect(isExperimentOn(FLAG)).toBe(false);
  });

  test("reset clears everything", () => {
    setExperiment(FLAG, true);
    resetExperiments();
    expect(isExperimentOn(FLAG)).toBe(false);
  });
});

describe("sidebar asistenta", () => {
  test("switch off leaves the upstream sidebar vanilla apart from the Experimenty door", () => {
    const items = visibleNavItems(false);
    expect(items.map((item) => item.to)).toEqual([EXPERIMENTY_PATH]);
  });

  test("switch on brings the register tabs back", () => {
    const paths = visibleNavItems(true).map((item) => item.to);
    expect(paths).toContain("/prehlad");
    expect(paths).toContain("/lehoty");
    expect(paths).toContain("/konektory");
    expect(paths).toContain("/marketplace");
    expect(paths).toContain(EXPERIMENTY_PATH);
  });

  test("external entries never leak into the session sidebar", () => {
    for (const on of [false, true]) {
      expect(visibleNavItems(on).some((item) => item.external)).toBe(false);
    }
  });

  test("the Experimenty entry is always marked", () => {
    const door = visibleNavItems(false)[0];
    expect(door.badge).toBeTruthy();
  });
});
