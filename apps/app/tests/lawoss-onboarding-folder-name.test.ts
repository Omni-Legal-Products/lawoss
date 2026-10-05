import { expect, test } from "bun:test";
import { onboardingErrorMessage } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import { UNSAFE_FOLDER_NAME_MESSAGE } from "../../../lawoss/okf/src/onboarding/messages";

test("an unsafe folder name is explained in the UI language, other errors stay as sent", () => {
  const unsafe = new Error(UNSAFE_FOLDER_NAME_MESSAGE);
  expect(onboardingErrorMessage(unsafe, "sk")).toContain("Bodky vnútri názvu, napríklad „s. r. o.“, sú v poriadku.");
  expect(onboardingErrorMessage(unsafe, "cs")).toContain("Název složky nesmí být prázdný");
  expect(onboardingErrorMessage(unsafe, "en")).toContain("The folder name must not be empty");
  expect(onboardingErrorMessage(unsafe, "de")).toContain("Der Ordnername darf nicht leer sein");
  expect(onboardingErrorMessage(new Error("Parent must be a canonical existing directory."), "sk")).toBe("Parent must be a canonical existing directory.");
  expect(onboardingErrorMessage("x", "sk")).toBe("Tento krok sa nepodarilo dokončiť.");
});
