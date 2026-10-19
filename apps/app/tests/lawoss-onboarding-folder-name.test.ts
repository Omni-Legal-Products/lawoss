import { expect, spyOn, test } from "bun:test";
import { onboardingErrorMessage } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import { UNSAFE_FOLDER_NAME_MESSAGE } from "../../../lawoss/okf/src/onboarding/messages";

test("an unsafe folder name is explained in the UI language, other errors become a general sentence", () => {
  const warn = spyOn(console, "warn").mockImplementation(() => undefined);
  const unsafe = new Error(UNSAFE_FOLDER_NAME_MESSAGE);
  expect(onboardingErrorMessage(unsafe, "sk")).toContain("Bodky vnútri názvu, napríklad „s. r. o.“, sú v poriadku.");
  expect(onboardingErrorMessage(unsafe, "cs")).toContain("Název složky nesmí být prázdný");
  expect(onboardingErrorMessage(unsafe, "en")).toContain("The folder name must not be empty");
  expect(onboardingErrorMessage(unsafe, "de")).toContain("Der Ordnername darf nicht leer sein");
  expect(onboardingErrorMessage(new Error("Matter must be within the selected client."), "sk")).toBe("Niečo sa nepodarilo. Skúste to znova, alebo vyberte iný priečinok.");
  expect(onboardingErrorMessage("x", "sk")).toBe("Niečo sa nepodarilo. Skúste to znova, alebo vyberte iný priečinok.");
  // Surová správa ide do konzoly, nie k advokátovi; aj pri známej chybe (MČ 19. 10.).
  expect(warn).toHaveBeenCalledTimes(6);
  warn.mockRestore();
});
