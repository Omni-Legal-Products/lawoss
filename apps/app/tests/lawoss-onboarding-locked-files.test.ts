import { expect, test } from "bun:test";
import { onboardingErrorMessage } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import { incompleteInspectionMessage } from "../../../lawoss/okf/src/onboarding/messages";

// Windows: dokument otvorený vo Worde či Outlooku zastaví náhľad onboardingu; advokát má vedieť, ktorý súbor zavrieť.
test("a locked file from an incomplete inspection is explained in the UI language with its paths", () => {
  const locked = new Error(incompleteInspectionMessage("Source client could not be inspected completely.", [
    { path: "Spisy/2026-10 Zmluva/zmluva; dodatok.docx", code: "locked_file" },
    { path: "pošta.pst", code: "locked_file" },
    { path: "", code: "changed_during_read" },
  ]));
  expect(onboardingErrorMessage(locked, "sk")).toBe("Súbor je otvorený v inej aplikácii (napríklad vo Worde) alebo k nemu nie je prístup: Spisy/2026-10 Zmluva/zmluva; dodatok.docx, pošta.pst. Zatvorte ho a skúste to znova.");
  expect(onboardingErrorMessage(locked, "cs")).toContain("otevřený v jiné aplikaci (například ve Wordu)");
  expect(onboardingErrorMessage(locked, "cs")).toContain("pošta.pst");
  expect(onboardingErrorMessage(locked, "en")).toContain("open in another application (for example Word)");
  expect(onboardingErrorMessage(locked, "de")).toContain("in einer anderen Anwendung geöffnet (zum Beispiel in Word)");
  const many = new Error(incompleteInspectionMessage("x", ["a", "b", "c", "d", "e", "f"].map((path) => ({ path, code: "locked_file" }))));
  expect(onboardingErrorMessage(many, "en")).toContain(": a, b, c, d, e. Close it");
  // Bez zamknutého súboru ostáva správa servera so zoznamom problémov.
  const other = new Error(incompleteInspectionMessage("Source client could not be inspected completely.", [{ path: "a.pdf", code: "EIO" }]));
  expect(onboardingErrorMessage(other, "sk")).toBe("Source client could not be inspected completely: a.pdf: EIO");
});
