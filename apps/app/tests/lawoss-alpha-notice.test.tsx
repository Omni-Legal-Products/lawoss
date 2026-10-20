import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { t } from "@/i18n";
import { ALPHA_NOTICE } from "../src/lawoss/feature-flags";
import {
  ALPHA_NOTICE_STORAGE_KEY,
  AlphaNoticeView,
  dismissAlphaNotice,
  reloadAlphaNoticeFromStorage,
} from "../src/lawoss/alpha/alpha-notice";
import { LawossLayout } from "../src/lawoss/shell/layout";
import { FolderStep } from "../src/lawoss/domains/onboarding/folder-step";
import { foundText } from "../src/lawoss/domains/onboarding/found-text";

/** SSR vykreslí `useLocale` v angličtine, preto sa porovnáva s anglickým textom kľúča. */
const NOTICE = t("lawoss.alpha.notice", "en");
const DISMISS = t("lawoss.alpha.dismiss", "en");

const layoutHtml = () => renderToStaticMarkup(<MemoryRouter><LawossLayout><p>obsah</p></LawossLayout></MemoryRouter>);
const folderStepHtml = () => renderToStaticMarkup(
  <FolderStep
    api={{
      planOnboarding: async () => { throw new Error("nepoužité"); },
      applyOnboarding: async () => { throw new Error("nepoužité"); },
      updateOnboardingProfile: async () => { throw new Error("nepoužité"); },
      suggestOnboarding: async () => { throw new Error("nepoužité"); },
    }}
    identity={{ lawyerName: "Test", jurisdiction: "SK", language: "sk" }}
    text={foundText("sk")}
    pickDirectory={async () => null}
    onFound={() => undefined}
    onAcknowledge={async () => undefined}
    onFreshDone={() => undefined}
    onError={() => undefined}
  />,
);

/** Prvý prvok v strome, ktorý spĺňa podmienku; funkčné komponenty sa nevolajú. */
function findElement(node: ReactNode, match: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, match);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return null;
  return match(node) ? node : findElement(node.props.children as ReactNode, match);
}

type FakeStorage = Storage & { data: Map<string, string> };
function fakeStorage(): FakeStorage {
  const data = new Map<string, string>();
  return {
    data,
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, value); },
  };
}

const original = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
function installStorage(storage: Storage | "throws" | "absent") {
  if (storage === "absent") {
    Reflect.deleteProperty(globalThis, "sessionStorage");
  } else {
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get: () => {
        if (storage === "throws") throw new Error("úložisko je zablokované");
        return storage;
      },
    });
  }
  reloadAlphaNoticeFromStorage();
}

let storage: FakeStorage;
beforeEach(() => {
  storage = fakeStorage();
  installStorage(storage);
});
afterEach(() => {
  if (original) Object.defineProperty(globalThis, "sessionStorage", original);
  else Reflect.deleteProperty(globalThis, "sessionStorage");
  reloadAlphaNoticeFromStorage();
});

describe("upozornenie na alfa verziu", () => {
  test("prepínač je zapnutý a text je vo všetkých štyroch jazykoch", () => {
    expect(ALPHA_NOTICE).toBe(true);
    expect(t("lawoss.alpha.notice", "sk")).toBe("Toto je alfa verzia LAWOSS na testovanie. Skúšajte ju na syntetických dátach alebo na kópii priečinka. Vlastné spisy len na vlastné riziko.");
    expect(t("lawoss.alpha.dismiss", "sk")).toBe("Rozumiem");
    for (const language of ["cs", "en", "de"] as const) {
      expect(t("lawoss.alpha.notice", language)).not.toBe("lawoss.alpha.notice");
      expect(t("lawoss.alpha.dismiss", language)).not.toBe("lawoss.alpha.dismiss");
    }
    expect(t("lawoss.alpha.notice", "de")).not.toContain("—");
    expect(t("lawoss.alpha.dismiss", "de")).not.toContain("—");
  });

  test("layout aj krok Priečinok vykreslia text upozornenia", () => {
    expect(layoutHtml()).toContain(NOTICE);
    expect(layoutHtml()).toContain(DISMISS);
    expect(folderStepHtml()).toContain(NOTICE);
  });

  test("v kroku Priečinok sa upozornenie nedá skryť", () => {
    expect(folderStepHtml()).not.toContain(DISMISS);
  });

  test("tlačidlo Rozumiem v layoute skryje pruh a zapíše to do sessionStorage, krok Priečinok text ponechá", () => {
    const view = AlphaNoticeView({ locale: "en", onDismiss: dismissAlphaNotice });
    const button = findElement(view, (element) => typeof element.props.onClick === "function");
    expect(button).not.toBeNull();
    (button?.props.onClick as () => void)();

    expect(storage.data.get(ALPHA_NOTICE_STORAGE_KEY)).toBe("1");
    expect(layoutHtml()).not.toContain(NOTICE);
    expect(layoutHtml()).toContain("obsah");
    expect(folderStepHtml()).toContain(NOTICE);
  });

  test("po novom spustení (prázdne sessionStorage) sa pruh vráti", () => {
    dismissAlphaNotice();
    expect(layoutHtml()).not.toContain(NOTICE);
    installStorage(fakeStorage());
    expect(layoutHtml()).toContain(NOTICE);
  });

  test("skryté upozornenie sa po novom načítaní zo sessionStorage nezobrazí", () => {
    storage.setItem(ALPHA_NOTICE_STORAGE_KEY, "1");
    reloadAlphaNoticeFromStorage();
    expect(layoutHtml()).not.toContain(NOTICE);
  });

  test("nedostupné alebo zablokované úložisko pruh nerozbije", () => {
    for (const mode of ["throws", "absent"] as const) {
      installStorage(mode);
      expect(layoutHtml()).toContain(NOTICE);
      expect(() => dismissAlphaNotice()).not.toThrow();
      expect(layoutHtml()).not.toContain(NOTICE);
    }
  });
});
