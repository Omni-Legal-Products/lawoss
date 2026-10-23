import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { onboardingErrorMessage } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import { INSIDE_OFFICE_MESSAGE_PREFIX, OFFICE_EXISTS_MESSAGE } from "../../../lawoss/okf/src/onboarding/messages";

// Chyby onboardingu zapisujú surovú správu do konzoly; v teste je to len šum (review 6c).
let quiet: ReturnType<typeof spyOn>;
beforeEach(() => { quiet = spyOn(console, "warn").mockImplementation(() => undefined); });
afterEach(() => { quiet.mockRestore(); });

// Tvar chyby z planShallowClientConversion (C1, review VŘ k #137, bod 2).
const nested = new Error("The directory could not be inspected completely and unambiguously: Prax/Office/okf.config: conflicting_identity; Archiv/_kancelaria/okf.config: conflicting_identity");
const TOO_LARGE_SK = "Priečinok je príliš veľký alebo má priveľa podpriečinkov. Vyberte priečinok konkrétneho klienta alebo kancelárie, nie celý domovský priečinok.";
const incomplete = new Error("The directory could not be inspected completely and unambiguously: .: office_search_incomplete");

describe("chyby identity pri pripojení priečinka", () => {
  // N-14 (22. 10. 2026): „už kanceláriu má“ bolo „Niečo sa nepodarilo“; teraz veta s ďalším krokom.
  test("prax s kanceláriou, ktorá sa nedá doplniť, a časť kancelárie dostanú preloženú vetu s ďalším krokom", () => {
    const exists = new Error(OFFICE_EXISTS_MESSAGE);
    const inside = new Error(`${INSIDE_OFFICE_MESSAGE_PREFIX} (/x/Kancelaria/Office). Pripojte celú kanceláriu, nie jej časť.`);
    for (const [locale, button] of [["sk", "Vybrať iný priečinok"], ["cs", "Vybrat jinou složku"], ["en", "Choose another folder"], ["de", "Anderen Ordner wählen"]] as const) {
      expect(onboardingErrorMessage(exists, locale)).toContain(button);
      expect(onboardingErrorMessage(inside, locale)).toContain(button);
      expect(onboardingErrorMessage(inside, locale)).not.toContain("/x/Kancelaria");
    }
    expect(onboardingErrorMessage(exists, "sk")).not.toBe(onboardingErrorMessage(new Error("x"), "sk"));
  });
  test("vnorená kancelária sa vysvetlí s cestami vo všetkých jazykoch", () => {
    expect(onboardingErrorMessage(nested, "sk")).toContain("Prax/Office/okf.config, Archiv/_kancelaria/okf.config");
    expect(onboardingErrorMessage(nested, "sk")).toContain("iná kancelária");
    expect(onboardingErrorMessage(nested, "cs")).toContain("jiná kancelář");
    expect(onboardingErrorMessage(nested, "en")).toContain("another office");
    expect(onboardingErrorMessage(nested, "de")).toContain("andere Kanzlei");
    expect(onboardingErrorMessage(nested, "sk")).not.toContain("conflicting_identity");
  });
  test("neúplné hľadanie kancelárie odporučí priečinok klienta alebo kancelárie", () => {
    expect(onboardingErrorMessage(incomplete, "sk")).toBe(TOO_LARGE_SK);
    expect(onboardingErrorMessage(incomplete, "cs")).toBe("Složka je příliš velká nebo má příliš mnoho podsložek. Vyberte složku konkrétního klienta nebo kanceláře, ne celou domovskou složku.");
    expect(onboardingErrorMessage(incomplete, "en")).toBe("The folder is too large or has too many subfolders. Choose the folder of a specific client or office, not your whole home folder.");
    expect(onboardingErrorMessage(incomplete, "de")).toBe("Der Ordner ist zu groß oder hat zu viele Unterordner. Wählen Sie den Ordner eines bestimmten Mandanten oder der Kanzlei, nicht Ihren ganzen Benutzerordner.");
  });
  test("limity prehliadky (počet položiek, veľkosť, hĺbka) dostanú rovnakú vetu", () => {
    for (const message of [
      "The directory could not be inspected completely and unambiguously: Library/Caches: entry_limit",
      "Parent could not be inspected completely: Documents/archiv.zip: byte_limit",
      "Source client could not be inspected completely: Spisy/A/B/C/D/E/F/G/H/I: depth_limit; Spisy/x.pdf: changed_during_read (+3 more)",
    ]) {
      expect(onboardingErrorMessage(new Error(message), "sk")).toBe(TOO_LARGE_SK);
      expect(onboardingErrorMessage(new Error(message), "sk")).not.toContain("_limit");
    }
  });
  test("aj známa chyba zapíše surovú správu do konzoly", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    onboardingErrorMessage(incomplete, "sk");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[1])).toContain("office_search_incomplete");
    warn.mockRestore();
  });
  test("iné chyby sa zmenia na všeobecnú vetu a surová správa ide do konzoly", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    expect(onboardingErrorMessage(new Error("The client root changed."), "sk")).toBe("Niečo sa nepodarilo. Skúste to znova, alebo vyberte iný priečinok.");
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

test("neprázdny priečinok pri Začať nanovo dostane vlastnú vetu, nie všeobecnú (review 6c)", async () => {
  const { FRESH_NOT_EMPTY } = await import("../src/lawoss/domains/onboarding/onboarding-errors");
  const warn = spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    expect(onboardingErrorMessage(new Error(FRESH_NOT_EMPTY), "sk")).toBe("Vyberte prázdny priečinok. V okne výberu môžete vytvoriť nový.");
    expect(onboardingErrorMessage(new Error(FRESH_NOT_EMPTY), "de")).toBe("Wählen Sie einen leeren Ordner. Im Auswahlfenster können Sie einen neuen anlegen.");
  } finally { warn.mockRestore(); }
});
