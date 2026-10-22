import { afterEach, beforeEach, expect, test } from "bun:test";
import { bootstrapLawoss } from "../../../lawoss/theme/bootstrap";
import { currentLanguagePreference, currentLocale, detectSystemLanguage, initLocale, LANGUAGE_PREF_KEY, setFirmLanguage, setLanguagePreference, setLocale, subscribeLocale } from "../src/i18n";
import { EXPERIMENT_VIEWS } from "../src/lawoss/experiments/registry";

const originalDescriptors = new Map(["window", "document", "navigator", "__LEGALWORK_ELECTRON__"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let storage: Map<string, string>;
let browser: EventTarget & { localStorage: Storage };
let languages: string[];
let htmlLanguage: string;
let writes: number;

beforeEach(() => {
  storage = new Map(); languages = ["cs-CZ", "en"]; htmlLanguage = ""; writes = 0;
  const localStorage: Storage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { writes++; storage.set(key, value); },
    removeItem: key => { storage.delete(key); },
    clear: () => storage.clear(),
    key: index => [...storage.keys()][index] ?? null,
    get length() { return storage.size; },
  };
  browser = Object.assign(new EventTarget(), { localStorage });
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { get languages() { return languages; }, get language() { return languages[0]; } } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: { setAttribute: (key: string, value: string) => { if (key === "lang") htmlLanguage = value; } } } });
  initLocale();
});

afterEach(() => {
  setFirmLanguage(null);
  for (const [key, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  setLocale("en");
});

test("firm Czech survives reinitialization and other-window changes without overwriting the member preference", () => {
  setLocale("sk");
  setFirmLanguage("cs");
  expect(initLocale()).toBe("cs");
  expect(currentLocale()).toBe("cs");
  expect(storage.get(LANGUAGE_PREF_KEY)).toBe("sk");
  storage.set(LANGUAGE_PREF_KEY, "de");
  const before = writes;
  browser.dispatchEvent(Object.assign(new Event("storage"), { key: LANGUAGE_PREF_KEY, storageArea: browser.localStorage }));
  expect(currentLocale()).toBe("cs");
  expect(currentLanguagePreference()).toBe("de");
  expect(writes).toBe(before);
  setFirmLanguage(null);
  expect(currentLocale()).toBe("de");
});

test("system language changes respect firm override and resume after it is cleared", () => {
  setLanguagePreference("system");
  setFirmLanguage("cs");
  languages = ["sk-SK"];
  browser.dispatchEvent(new Event("languagechange"));
  expect(currentLocale()).toBe("cs");
  expect(htmlLanguage).toBe("cs");
  setFirmLanguage(null);
  expect(currentLocale()).toBe("sk");
  setLocale("de");
  languages = ["en-US"];
  browser.dispatchEvent(new Event("languagechange"));
  expect(currentLocale()).toBe("de");
});

test("first launch follows system Czech without persisting an explicit language or touching matter settings", () => {
  storage.set("matter.jurisdiction", "SK");
  bootstrapLawoss();
  expect(storage.has(LANGUAGE_PREF_KEY)).toBe(false);
  expect(initLocale()).toBe("cs");
  expect(currentLanguagePreference()).toBe("system");
  expect(htmlLanguage).toBe("cs");
  expect(storage.get("matter.jurisdiction")).toBe("SK");
});

test("Czech, Slovak and English selections notify, persist and restore despite a different system language", () => {
  const notifications: string[] = [];
  const unsubscribe = subscribeLocale(() => notifications.push(currentLocale()));
  try {
    for (const language of ["sk", "en", "cs"] as const) {
      setLanguagePreference(language);
      expect(currentLocale()).toBe(language);
      expect(storage.get(LANGUAGE_PREF_KEY)).toBe(language);
      expect(htmlLanguage).toBe(language);
      expect(initLocale()).toBe(language);
    }
    expect(notifications).toContain("sk");
    expect(notifications).toContain("en");
    expect(notifications).toContain("cs");
  } finally { unsubscribe(); }
});

test("system events follow ordered preferences only while System is selected", () => {
  languages = ["fr-FR", "sk-SK", "en"];
  browser.dispatchEvent(new Event("languagechange"));
  expect(currentLocale()).toBe("sk");
  setLanguagePreference("cs");
  languages = ["en-US"];
  browser.dispatchEvent(new Event("languagechange"));
  expect(currentLocale()).toBe("cs");
  setLanguagePreference("system");
  expect(currentLocale()).toBe("en");
});

test("another window's preference is applied without echo writes or changes to other stored data", () => {
  initLocale(); initLocale();
  storage.set("draft", "Klientský text — nemenit");
  storage.set(LANGUAGE_PREF_KEY, "sk");
  const before = writes;
  browser.dispatchEvent(Object.assign(new Event("storage"), { key: LANGUAGE_PREF_KEY, storageArea: browser.localStorage }));
  expect(currentLanguagePreference()).toBe("sk");
  expect(currentLocale()).toBe("sk");
  expect(storage.get("draft")).toBe("Klientský text — nemenit");
  expect(writes).toBe(before);
  storage.set(LANGUAGE_PREF_KEY, "en");
  browser.dispatchEvent(Object.assign(new Event("storage"), { key: "unrelated", storageArea: browser.localStorage }));
  expect(currentLocale()).toBe("sk");
});

test("invalid saved language falls back safely and registry labels are not frozen at import", () => {
  storage.set(LANGUAGE_PREF_KEY, "unsupported");
  expect(initLocale()).toBe("cs");
  const view = EXPERIMENT_VIEWS.find(item => item.id === "view-lehoty");
  const identity = view?.id;
  expect(view?.label).toBe("Lhůty");
  setLocale("sk"); expect(view?.label).toBe("Lehoty");
  setLocale("en"); expect(view?.label).toBe("Deadlines");
  expect(view?.id).toBe(identity);
  expect(view?.to).toBe("/lehoty");
});

test("unavailable preference storage does not prevent an immediate language change", () => {
  Object.defineProperty(browser, "localStorage", { configurable: true, get() { throw new Error("unavailable storage"); } });
  expect(() => setLocale("sk")).not.toThrow();
  expect(currentLocale()).toBe("sk");
  expect(htmlLanguage).toBe("sk");
});

// N-2 (akceptácia 22. 10. 2026): Mac s „en-US, sk-SK“ začínal po anglicky.
test("SK alebo CS kdekoľvek v zozname systému má prednosť, inak prvý podporovaný, bez podporovaného slovenčina", () => {
  for (const [list, expected] of [
    [["en-US", "sk-SK"], "sk"],
    [["en-US", "cs-CZ"], "cs"],
    [["de-DE", "en-US", "cs"], "cs"],
    [["de-DE"], "de"],
    [["en-US"], "en"],
    [["fr-FR"], "sk"],
    [["fr-FR", "en-GB"], "en"],
    [[], "sk"],
  ] as const) {
    languages = [...list];
    expect(detectSystemLanguage()).toBe(expected);
  }
});

test("čistý profil na systéme „en-US, sk-SK“ začne po slovensky; jazyk kancelárie a výslovná voľba majú prednosť (#201)", () => {
  languages = ["en-US", "sk-SK"];
  expect(initLocale()).toBe("sk");
  expect(currentLanguagePreference()).toBe("system");
  setFirmLanguage("en");
  expect(currentLocale()).toBe("en");
  setFirmLanguage(null);
  expect(currentLocale()).toBe("sk");
  setLanguagePreference("en");
  expect(initLocale()).toBe("en");
});

// Fix round 1 (R-1): v Electrone navigator.languages nesie len jazyk aplikácie; zoznam OS posiela hlavný proces.
test("desktopový most so zoznamom OS má prednosť pred navigator.languages; bez mosta alebo pri prázdnom zozname web", () => {
  languages = ["en-US"];
  Object.defineProperty(globalThis, "__LEGALWORK_ELECTRON__", { configurable: true, value: { systemLanguages: Object.freeze(["en-US", "sk-SK"]) } });
  expect(detectSystemLanguage()).toBe("sk");
  expect(initLocale()).toBe("sk");
  // Jazyk kancelárie a výslovná voľba majú naďalej prednosť pred systémom (#201).
  setFirmLanguage("cs");
  expect(currentLocale()).toBe("cs");
  setFirmLanguage(null);
  setLanguagePreference("de");
  expect(currentLocale()).toBe("de");
  setLanguagePreference("system");
  Object.defineProperty(globalThis, "__LEGALWORK_ELECTRON__", { configurable: true, value: { systemLanguages: [] } });
  expect(detectSystemLanguage()).toBe("en");
  Object.defineProperty(globalThis, "__LEGALWORK_ELECTRON__", { configurable: true, value: { invokeDesktop: () => undefined } });
  expect(detectSystemLanguage()).toBe("en");
});

test("bez navigatora aj mosta (SSR) je systémový jazyk slovenčina", () => {
  Reflect.deleteProperty(globalThis, "navigator");
  expect(detectSystemLanguage()).toBe("sk");
});
