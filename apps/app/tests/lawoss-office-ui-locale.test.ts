import { afterEach, expect, test } from "bun:test";
import { currentLanguagePreference, currentLocale, LANGUAGE_PREF_KEY, setLanguagePreference, setLocale } from "../src/i18n";
import { applyOfficeUiLocale, clearOfficeUiLocale, prepareOfficeUiLocale } from "../src/word-addin/ui-locale";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const preference = currentLanguagePreference();
const locale = currentLocale();
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  setLanguagePreference(preference);
  // „system“ sa v Bune bez navigatora rozvinie na „sk“ a ďalší súbor (review-card) by sa vykreslil po slovensky.
  // Pôvodnú dvojicu („system“, „en“ pred initLocale) verejné API nevie obnoviť, preto vrátime aspoň viditeľný jazyk.
  if (currentLocale() !== locale) setLocale(locale);
});

test("Office follows live host locale; pairing changes invalidate only presentation cache, never cache capability bytes", async () => {
  const values = new Map<string, string>();
  const localStorage: Storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); }, clear: () => values.clear(), key: index => [...values.keys()][index] ?? null, get length() { return values.size; } };
  Object.defineProperty(globalThis, "window", { configurable: true, value: Object.assign(new EventTarget(), { localStorage }) });
  await prepareOfficeUiLocale("a".repeat(64));
  applyOfficeUiLocale("cs");
  expect(currentLocale()).toBe("cs");
  await prepareOfficeUiLocale("a".repeat(64));
  expect(currentLocale()).toBe("cs");
  applyOfficeUiLocale("sk"); expect(currentLocale()).toBe("sk");
  applyOfficeUiLocale("cs"); expect(currentLocale()).toBe("cs");
  applyOfficeUiLocale("unknown"); expect(currentLocale()).toBe("cs");
  await prepareOfficeUiLocale("b".repeat(64));
  expect(values.has(LANGUAGE_PREF_KEY)).toBe(false);
  expect([...values.values()]).not.toContain("a".repeat(64));
  expect([...values.values()]).not.toContain("b".repeat(64));
  applyOfficeUiLocale("cs"); clearOfficeUiLocale();
  expect(currentLanguagePreference()).toBe("system");
  expect(values.has("legalwork.officeLocaleScope")).toBe(false);
});
