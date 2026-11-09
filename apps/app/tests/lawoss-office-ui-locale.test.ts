import { afterEach, expect, test } from "bun:test";
import { currentLanguagePreference, currentLocale, LANGUAGE_PREF_KEY, setLanguagePreference } from "../src/i18n";
import { applyOfficeUiLocale, bindOfficeUiLocale, clearOfficeUiLocale } from "../src/word-addin/ui-locale";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const preference = currentLanguagePreference();
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  setLanguagePreference(preference);
});

test("Office follows live host locale; another office_ token invalidates only presentation cache, never caches the token", async () => {
  const values = new Map<string, string>();
  const localStorage: Storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); }, clear: () => values.clear(), key: index => [...values.keys()][index] ?? null, get length() { return values.size; } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), { localStorage }) });
  await bindOfficeUiLocale("office_" + "a".repeat(43));
  applyOfficeUiLocale("cs");
  expect(currentLocale()).toBe("cs");
  await bindOfficeUiLocale("office_" + "a".repeat(43));
  expect(currentLocale()).toBe("cs");
  applyOfficeUiLocale("sk"); expect(currentLocale()).toBe("sk");
  applyOfficeUiLocale("cs"); expect(currentLocale()).toBe("cs");
  applyOfficeUiLocale("unknown"); expect(currentLocale()).toBe("cs");
  await bindOfficeUiLocale("office_" + "b".repeat(43));
  expect(values.has(LANGUAGE_PREF_KEY)).toBe(false);
  expect([...values.values()]).not.toContain("office_" + "a".repeat(43));
  expect([...values.values()]).not.toContain("office_" + "b".repeat(43));
  applyOfficeUiLocale("cs"); clearOfficeUiLocale();
  expect(currentLanguagePreference()).toBe("system");
  expect(values.has("legalwork.officeLocaleScope")).toBe(false);
});
