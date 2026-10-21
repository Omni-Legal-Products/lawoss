import { expect, test } from "bun:test";
import { currentLanguagePreference, setLanguagePreference, setLocale } from "../src/i18n";
import { pickOnboardingDirectory } from "../src/lawoss/domains/onboarding/folder-picker";

test("the native picker uses the selected language on each opening and keeps canonical paths", async () => {
  const preference = currentLanguagePreference();
  try {
    for (const [language, title] of [["cs", "Vybrat složku"], ["sk", "Vybrať priečinok"], ["en", "Select a folder"]] as const) {
      setLocale(language);
      const result = await pickOnboardingDirectory(async (options) => {
        expect(options).toEqual({ title, canonical: true });
        return "\\\\server\\Klienti\\Syntetický klient";
      });
      expect(result).toBe("\\\\server\\Klienti\\Syntetický klient");
    }
  } finally { setLanguagePreference(preference); }
});

test("cancelling or receiving a non-string does not select a folder", async () => {
  for (const result of [null, undefined, []]) {
    expect(await pickOnboardingDirectory(async () => result)).toBeNull();
  }
});

test("native picker failures remain visible to its caller", async () => {
  const error = new Error("Synthetic native picker unavailable");
  await expect(pickOnboardingDirectory(async () => { throw error; })).rejects.toBe(error);
});
