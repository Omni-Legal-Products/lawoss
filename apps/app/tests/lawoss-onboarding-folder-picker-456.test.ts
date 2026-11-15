import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { setLocale, type Language } from "../src/i18n";
import { onboardingFolderPicker } from "../src/lawoss/domains/onboarding/folder-picker";

test("the native folder dialog title follows the UI language (#456)", async () => {
  const expected: Record<Language, string> = {
    sk: "Vyberte priečinok pre LAWOSS",
    cs: "Vyberte složku pro LAWOSS",
    en: "Select LAWOSS folder",
    de: "Ordner für LAWOSS auswählen",
  };
  const titles: string[] = [];
  const pick = onboardingFolderPicker(async (options) => {
    expect(options.canonical).toBe(true);
    titles.push(options.title);
    return "/Prax";
  });
  for (const language of Object.keys(expected) as Language[]) {
    setLocale(language);
    expect(await pick()).toBe("/Prax");
  }
  expect(titles).toEqual(Object.values(expected));
});

test("a cancelled dialog returns null", async () => {
  expect(await onboardingFolderPicker(async () => null)()).toBeNull();
  expect(await onboardingFolderPicker(async () => ["/a", "/b"])()).toBeNull();
});

test("the onboarding route has no hard-coded dialog title", () => {
  const source = readFileSync(new URL("../src/react-app/shell/welcome-route.tsx", import.meta.url), "utf8");
  expect(source).not.toContain("Select LAWOSS folder");
  expect(source).toContain("onboardingFolderPicker(pickDirectory)");
});
