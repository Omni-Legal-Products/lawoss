import { expect, test } from "bun:test";
import { currentLanguagePreference, setLanguagePreference, setLocale } from "../src/i18n";
import { confirmDiscardDocuments, registerUnsavedDocument } from "../src/react-app/domains/session/artifacts/docx-document-state";

test("closing a dirty document uses the current language and preserves its literal filename", () => {
  const preference = currentLanguagePreference();
  const filename = "Evidence-$&-{names}-český.md";
  let discarded = 0;
  const unregister = registerUnsavedDocument("language-close", filename, () => true, () => { discarded++; });
  try {
    for (const [locale, marker] of [["cs", "neuložené změny"], ["sk", "neuložené zmeny"], ["en", "unsaved changes"], ["de", "Nicht gespeicherte Änderungen"]] as const) {
      setLocale(locale);
      let message = "";
      expect(confirmDiscardDocuments("language-close", text => { message = text; return false; })).toBe(false);
      expect(message).toContain(marker);
      expect(message).toContain(filename);
      expect(discarded).toBe(0);
    }
    expect(confirmDiscardDocuments("language-close", () => true)).toBe(true);
    expect(discarded).toBe(1);
  } finally {
    unregister();
    setLanguagePreference(preference);
  }
});

test("clean documents never ask to discard or run discard callbacks", () => {
  const unregister = registerUnsavedDocument("clean-close", "Evidence.md", () => false, () => { throw new Error("Clean document cannot be discarded"); });
  try {
    expect(confirmDiscardDocuments("clean-close", () => { throw new Error("Clean document cannot prompt"); })).toBe(true);
  } finally { unregister(); }
});
