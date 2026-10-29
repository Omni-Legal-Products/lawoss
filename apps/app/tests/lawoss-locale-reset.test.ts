import { expect, test } from "bun:test";
import { currentLanguagePreference, currentLocale, setFirmLanguage, setLanguagePreference, setLocale } from "../src/i18n";

// Jazyk appky je globálny stav modulu a `bun test` spúšťa všetky súbory v jednom procese v poradí, ktoré sa
// líši podľa stroja. Test obnovujúci voľbu „Systém“ nechal slovenčinu a ďalší súbor čakal angličtinu
// (review-card, subagent-tool-rows, plugin-import-exclusions na CI). Preload `test-preload-lawoss.ts`
// vracia počiatočný stav pred a po každom teste; tieto dva testy idú v tomto poradí.
test("test môže nastaviť jazyk kancelárie, vlastnú voľbu aj systém", () => {
  setLocale("cs");
  setFirmLanguage("sk");
  expect(currentLocale()).toBe("sk");
  setLanguagePreference("system");
  setFirmLanguage(null);
  expect(currentLanguagePreference()).toBe("system");
});

test("ďalší test začína v angličtine, s voľbou Systém a bez jazyka kancelárie", () => {
  expect(currentLocale()).toBe("en");
  expect(currentLanguagePreference()).toBe("system");
  setLocale("de");
  expect(currentLocale()).toBe("de");
});
