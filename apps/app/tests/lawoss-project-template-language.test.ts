import { expect, test } from "bun:test";
import { defaultProjectTemplates, localizedProjectFields, localizedTemplateFields, projectTemplateName } from "@legalwork/types/workspace";
import { currentLanguagePreference, setLanguagePreference, setLocale } from "../src/i18n";
import { bundledPresentation } from "../src/lawoss/i18n/bundled-presentation";
import { currentTemplateLocale } from "../src/lawoss/i18n/template-locale";

test("Czech and Slovak template presentation follows UI selection without mutating custom names or saved values", () => {
  const preference = currentLanguagePreference();
  try {
    for (const [locale, name, clientLabel] of [["cs", "Právní případ", "Klient"], ["sk", "Právny prípad", "Klient"]] as const) {
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
      expect(localizedTemplateFields(original.fields, locale).find(field => field.id === "status")?.options).toEqual(statusOptions[locale]);
      expect(JSON.stringify(original)).toBe(before);
    }
  } finally { setLanguagePreference(preference); }
});

const statusOptions = {
  cs: ["Otevřený", "Probíhá", "Čekání", "Uzavřený"],
  sk: ["Otvorený", "Prebieha", "Čaká sa", "Uzavretý"],
} as const;

const matterLabels = {
  cs: { matter_number: "Číslo spisu", opposing_party: "Protistrana", subject: "Předmět případu", status: "Stav", opened_on: "Otevřeno dne", court: "Soud / úřad" },
  sk: { matter_number: "Číslo spisu", opposing_party: "Protistrana", subject: "Predmet prípadu", status: "Stav", opened_on: "Otvorený dňa", court: "Súd / úrad", external_reference: "Externá referencia" },
} as const;

test("Czech and Slovak matter template saves corrected labels and status options", () => {
  for (const locale of ["cs", "sk"] as const) {
    const matter = defaultProjectTemplates(locale)[0];
    const labels = Object.fromEntries(matter.fields.map(field => [field.id, field.label]));
    expect(labels).toMatchObject(matterLabels[locale]);
    expect(matter.fields.find(field => field.id === "status")?.options).toEqual([...statusOptions[locale]]);
    for (const template of defaultProjectTemplates(locale)) {
      for (const field of template.fields) expect(field.label).toMatch(/^\p{Lu}[^?.]*$/u);
      for (const option of template.fields.flatMap(field => field.options ?? [])) expect(option).not.toBe(option.toUpperCase());
    }
  }
});

test("saved status options re-translate only as a complete set of one language", () => {
  const status = defaultProjectTemplates("sk")[0].fields.filter(field => field.id === "status");
  expect(localizedTemplateFields(status, "cs")[0].options).toEqual([...statusOptions.cs]);
  expect(localizedTemplateFields(status, "en")[0].options).toEqual(["Open", "In progress", "Waiting", "Closed"]);
  const edited = [{ ...status[0], options: ["Otvorený", "Prebieha", "Čaká sa", "Archív"] }];
  expect(localizedTemplateFields(edited, "cs")[0].options).toEqual(["Otvorený", "Prebieha", "Čaká sa", "Archív"]);
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
