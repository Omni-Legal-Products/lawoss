import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ALPHA_FORCED_THEME, bootstrapLawoss, enforceTheme } from "../../../lawoss/theme/bootstrap";

const THEME_PREF_KEY = "legalwork.react.settings.theme-mode";
const LEGACY_THEME_PREF_KEY = "legalwork.themePref";
const MIGRATION_KEY = "lawoss.theme-migrated-to-dark";

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  const storage: Storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
    clear: () => data.clear(),
    key: (index) => [...data.keys()][index] ?? null,
    get length() { return data.size; },
  };
  return { data, storage };
};

describe("alpha forces the dark theme", () => {
  test("the alpha build ships with the dark theme forced", () => {
    expect(ALPHA_FORCED_THEME).toBe("dark");
  });

  test("a stored light or system choice becomes dark, including the pre-paint key", () => {
    for (const stored of ["light", "system"]) {
      const { data, storage } = memoryStorage({ [THEME_PREF_KEY]: stored, [LEGACY_THEME_PREF_KEY]: stored });
      enforceTheme(storage, "dark");
      expect(data.get(THEME_PREF_KEY)).toBe("dark");
      expect(data.get(LEGACY_THEME_PREF_KEY)).toBe("dark");
    }
  });

  test("turning the switch off leaves the user's choice alone", () => {
    const { data, storage } = memoryStorage({ [THEME_PREF_KEY]: "light" });
    enforceTheme(storage, null);
    expect(data.get(THEME_PREF_KEY)).toBe("light");
    expect(data.has(LEGACY_THEME_PREF_KEY)).toBe(false);
  });

  test("no light choice is reachable: the upstream theme picker is not rendered anywhere", () => {
    const root = join(import.meta.dir, "../src");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name)) files.push(path);
      }
    };
    walk(root);
    const users = files.filter((file) => !file.endsWith("theme-section.tsx") && /\bThemeSection\b|theme-section/.test(readFileSync(file, "utf8")));
    expect(users).toEqual([]);
  });
});

describe("bootstrapLawoss applies the forced theme on every start", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  let data: Map<string, string>;

  beforeEach(() => {
    const memory = memoryStorage();
    data = memory.data;
    Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), { localStorage: memory.storage }) });
  });

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  });

  test("also after the one-time migration already ran", () => {
    data.set(MIGRATION_KEY, "1");
    data.set(THEME_PREF_KEY, "light");
    bootstrapLawoss();
    expect(data.get(THEME_PREF_KEY)).toBe("dark");
    expect(data.get(LEGACY_THEME_PREF_KEY)).toBe("dark");
  });

  test("a fresh profile starts dark", () => {
    bootstrapLawoss();
    expect(data.get(THEME_PREF_KEY)).toBe("dark");
    expect(data.get(MIGRATION_KEY)).toBe("1");
  });
});
