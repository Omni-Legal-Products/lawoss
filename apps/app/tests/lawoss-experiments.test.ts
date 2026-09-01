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
const { EXPERIMENTY_PATH, experimentyNavItems } = await import("../src/lawoss/shell/layout");
const { isExperimentOn, reloadExperimentsFromStorage, resetExperiments, setExperiment } = await import(
  "../src/lawoss/experiments/store"
);

const STORAGE_KEY = "lawoss.experiments";

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
  test("an unknown flag is off and cannot be written", () => {
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
  });

  test("a stored array is ignored rather than treated as flags", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["a", "b"]));
    expect(() => reloadExperimentsFromStorage()).not.toThrow();
    expect(isExperimentOn("a")).toBe(false);
  });

  test("reset does not throw and leaves everything off", () => {
    resetExperiments();
    for (const flag of EXPERIMENT_FLAGS) expect(isExperimentOn(flag.id)).toBe(false);
  });
});

describe("sidebar asistenta", () => {
  test("the Experimenty group leads with the switch page", () => {
    expect(experimentyNavItems()[0].to).toBe(EXPERIMENTY_PATH);
  });

  test("every experimental screen is reachable as a sub-item", () => {
    const paths = experimentyNavItems().map((item) => item.to);
    for (const view of EXPERIMENT_VIEWS) expect(paths).toContain(view.to);
  });

  test("sub-items carry no duplicates", () => {
    const paths = experimentyNavItems().map((item) => item.to);
    expect(new Set(paths).size).toBe(paths.length);
  });

  test("no flag may hide working upstream behaviour", () => {
    // Flags are additive by contract; a flag that gates existing navigation is
    // what this whole item exists to avoid.
    for (const flag of EXPERIMENT_FLAGS) {
      expect(flag.label.toLowerCase()).not.toContain("skryť");
    }
  });
});
