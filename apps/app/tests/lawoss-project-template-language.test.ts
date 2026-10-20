import { expect, test } from "bun:test";
import { defaultProjectTemplates, localizedProjectFields, localizedTemplateFields, projectTemplateName } from "@legalwork/types/workspace";
import { currentLanguagePreference, setLanguagePreference, setLocale } from "../src/i18n";
import { bundledPresentation } from "../src/lawoss/i18n/bundled-presentation";
import { currentTemplateLocale } from "../src/lawoss/i18n/template-locale";

test("Czech and Slovak template presentation follows UI selection without mutating custom names or saved values", () => {
  const preference = currentLanguagePreference();
  try {
    for (const [locale, name, clientLabel] of [["cs", "Právní spis", "Klient"], ["sk", "Právny spis", "Klient"]] as const) {
      setLocale(locale);
      expect(currentTemplateLocale()).toBe(locale);
      const original = defaultProjectTemplates("en")[0];
      const before = JSON.stringify(original);
      expect(projectTemplateName(original, locale)).toBe(name);
      const values = original.fields.map(field => ({ ...field, value: field.id === "client" ? "Pôvodný klient" : null }));
      const localized = localizedProjectFields(values, locale);
      expect(localized.find(field => field.id === "client")).toMatchObject({ label: clientLabel, value: "Pôvodný klient" });
      expect(projectTemplateName({ ...original, name: "Pôvodný názov", nameSource: "custom" }, locale)).toBe("Pôvodný názov");
      expect(localizedProjectFields([{ ...values[0], label: "Vlastní štítek", labelSource: "custom" }], locale)[0].label).toBe("Vlastní štítek");
      expect(localizedTemplateFields(original.fields, locale).find(field => field.id === "status")?.options?.[0]).toBe(locale === "cs" ? "OTEVŘENO" : "OTVORENÉ.");
      expect(JSON.stringify(original)).toBe(before);
    }
  } finally { setLanguagePreference(preference); }
});

test("bundled presentation requires verified unchanged content and never changes source metadata", () => {
  const original = { name: "workflow-assistant-due-diligence", description: "Original agent-facing description", bundledDisplayId: "workflow-assistant-due-diligence" };
  expect(bundledPresentation(original, "cs")?.name).toBe("Právní prověrka");
  expect(bundledPresentation(original, "sk")?.name).toBe("Právna previerka");
  expect(bundledPresentation({ ...original, bundledDisplayId: undefined }, "cs")).toBeNull();
  expect(bundledPresentation({ ...original, firm: "automatic" }, "cs")).toBeNull();
  expect(bundledPresentation({ ...original, name: "custom-name" }, "cs")).toBeNull();
  expect(original.description).toBe("Original agent-facing description");
});
