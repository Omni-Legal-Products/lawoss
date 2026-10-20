import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { onboardingErrorMessage } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import { incompleteInspectionMessage } from "../../../lawoss/okf/src/onboarding/messages";

// Chyby onboardingu zapisujú surovú správu do konzoly; v teste je to len šum (review 6c).
let quiet: ReturnType<typeof spyOn>;
beforeEach(() => { quiet = spyOn(console, "warn").mockImplementation(() => undefined); });
afterEach(() => { quiet.mockRestore(); });

// Windows: dokument otvorený vo Worde či Outlooku zastaví náhľad onboardingu; advokát má vedieť, ktorý súbor zavrieť.
test("a locked file from an incomplete inspection is explained in the UI language with its paths", () => {
  const locked = new Error(incompleteInspectionMessage("Source client could not be inspected completely.", [
    { path: "Spisy/2026-10 Zmluva/zmluva; dodatok.docx", code: "locked_file" },
    { path: "pošta.pst", code: "locked_file" },
    { path: "", code: "changed_during_read" },
  ]));
  expect(onboardingErrorMessage(locked, "sk")).toBe("Súbory sú otvorené v inej aplikácii (napríklad vo Worde) alebo k nim nie je prístup: Spisy/2026-10 Zmluva/zmluva; dodatok.docx, pošta.pst. Zatvorte ich a skúste to znova.");
  expect(onboardingErrorMessage(locked, "cs")).toContain("otevřené v jiné aplikaci (například ve Wordu)");
  expect(onboardingErrorMessage(locked, "cs")).toContain("pošta.pst");
  expect(onboardingErrorMessage(locked, "en")).toContain("open in another application (for example Word)");
  expect(onboardingErrorMessage(locked, "de")).toContain("in einer anderen Anwendung geöffnet (zum Beispiel in Word)");
  // Jeden súbor v jednotnom čísle, viac v množnom.
  const one = new Error(incompleteInspectionMessage("x", [{ path: "zmluva.docx", code: "locked_file" }, { path: "a.pdf", code: "EIO" }]));
  expect(onboardingErrorMessage(one, "sk")).toBe("Súbor je otvorený v inej aplikácii (napríklad vo Worde) alebo k nemu nie je prístup: zmluva.docx. Zatvorte ho a skúste to znova.");
  expect(onboardingErrorMessage(one, "cs")).toBe("Soubor je otevřený v jiné aplikaci (například ve Wordu) nebo k němu není přístup: zmluva.docx. Zavřete ho a zkuste to znovu.");
  expect(onboardingErrorMessage(one, "en")).toBe("A file is open in another application (for example Word) or cannot be accessed: zmluva.docx. Close it and try again.");
  const many = new Error(incompleteInspectionMessage("x", ["a", "b", "c", "d", "e", "f"].map((path) => ({ path, code: "locked_file" }))));
  expect(onboardingErrorMessage(many, "en")).toBe("Files are open in another application (for example Word) or cannot be accessed: a, b, c, d, e. Close them and try again.");
  expect(onboardingErrorMessage(many, "de")).toStartWith("Dateien sind in einer anderen Anwendung geöffnet");
  // Bez zamknutého súboru advokát dostane všeobecnú vetu, zoznam problémov ide do konzoly.
  const warn = quiet;
  warn.mockClear();
  const other = new Error(incompleteInspectionMessage("Source client could not be inspected completely.", [{ path: "a.pdf", code: "EIO" }]));
  expect(onboardingErrorMessage(other, "sk")).toBe("Niečo sa nepodarilo. Skúste to znova, alebo vyberte iný priečinok.");
  expect(onboardingErrorMessage(other, "en")).toBe("Something went wrong. Try again, or choose a different folder.");
  expect(warn).toHaveBeenCalledTimes(2);
});
