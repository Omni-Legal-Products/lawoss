import { describe, expect, test } from "bun:test";
import { onboardingErrorMessage } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";

// Tvar chyby z planShallowClientConversion (C1, review VŘ k #137, bod 2).
const nested = new Error("The directory could not be inspected completely and unambiguously: Prax/Office/okf.config: conflicting_identity; Archiv/_kancelaria/okf.config: conflicting_identity");
const incomplete = new Error("The directory could not be inspected completely and unambiguously: .: office_search_incomplete");

describe("chyby identity pri pripojení priečinka", () => {
  test("vnorená kancelária sa vysvetlí s cestami vo všetkých jazykoch", () => {
    expect(onboardingErrorMessage(nested, "sk")).toContain("Prax/Office/okf.config, Archiv/_kancelaria/okf.config");
    expect(onboardingErrorMessage(nested, "sk")).toContain("iná kancelária");
    expect(onboardingErrorMessage(nested, "cs")).toContain("jiná kancelář");
    expect(onboardingErrorMessage(nested, "en")).toContain("another office");
    expect(onboardingErrorMessage(nested, "de")).toContain("andere Kanzlei");
    expect(onboardingErrorMessage(nested, "sk")).not.toContain("conflicting_identity");
  });
  test("neúplné hľadanie kancelárie odporučí menší priečinok", () => {
    expect(onboardingErrorMessage(incomplete, "sk")).toContain("menší priečinok");
    expect(onboardingErrorMessage(incomplete, "cs")).toContain("menší složku");
    expect(onboardingErrorMessage(incomplete, "en")).toContain("smaller folder");
    expect(onboardingErrorMessage(incomplete, "de")).toContain("kleineren Ordner");
  });
  test("iné chyby ostávajú bez zmeny", () => {
    expect(onboardingErrorMessage(new Error("The client root changed."), "sk")).toBe("The client root changed.");
  });
});
