// okf.config kancelárie v ANSI (PowerShell 5.1 `Set-Content`): appka chybu preloží a editor súbor neprepíše.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { t } from "../src/i18n";
import { OFFICE_CONFIG_ENCODING_CODE, parseOfficeWorkingProfile, workingProfile } from "../../../lawoss/okf/src/profile";
import { onboardingErrorMessage } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import { isOfficeConfigEncodingError, loadOfficeProfile, updateOfficeProfile } from "../src/lawoss/okf/office-profile";

// Tak ho vráti server: neplatné bajty ANSI dekóduje ako U+FFFD.
const ansi = 'standing_authorization: "JUDr. Vojt�ch ��ha"\nmatter_folders: ["Podklady", "N�vrhy"]\nfolder_roles:\n  drafts: "N�vrhy"\nclient_path: "Klienti/*"\n';
const encodingError = () => { try { parseOfficeWorkingProfile(ansi); } catch (error) { return error; } throw new Error("expected encoding error"); };

test("chyba kódovania profilu má stabilný kód a onboarding ju povie v jazyku appky", () => {
  const error = encodingError();
  expect(error).toMatchObject({ code: OFFICE_CONFIG_ENCODING_CODE });
  expect(isOfficeConfigEncodingError(error)).toBe(true);
  // Server onboardingu pošle len správu (400 onboarding_failed); appka ju rozpozná podľa začiatku.
  const fromServer = new Error((error as Error).message);
  expect(onboardingErrorMessage(fromServer, "sk")).toContain("uložte ho s kódovaním UTF-8");
  expect(onboardingErrorMessage(fromServer, "cs")).toContain("uložte ho s kódováním UTF-8");
  expect(onboardingErrorMessage(fromServer, "en")).toContain("save it with UTF-8 encoding");
  expect(onboardingErrorMessage(fromServer, "de")).toContain("Codierung UTF-8");
});

test("roztriedenie mapuje kód servera na vetu pre advokáta vo všetkých jazykoch", () => {
  const page = readFileSync(new URL("../src/lawoss/domains/roztriedenie/triage-page.tsx", import.meta.url), "utf8");
  expect(page).toContain('if (error.code === OFFICE_CONFIG_ENCODING_CODE) return text("error_office_config");');
  for (const locale of ["sk", "cs", "en", "de"] as const) {
    expect(t("lawoss.triage.error_office_config", locale)).toMatch(/UTF-8/);
    expect(t("lawoss.integrations.office.encoding", locale)).toMatch(/UTF-8/);
  }
});

test("editor kancelárie poškodený okf.config neprepíše: diakritika v cudzích riadkoch by sa stratila natrvalo", async () => {
  expect(() => updateOfficeProfile(ansi, { profile: workingProfile(["Podklady", "Návrhy"], { drafts: "Návrhy" }), clientPath: "Klienti/*" }))
    .toThrow(expect.objectContaining({ code: OFFICE_CONFIG_ENCODING_CODE }));
  const client = {
    statWorkspaceFile: async (_id: string, path: string) => path === "okf.config" ? { exists: true, kind: "file" } : { exists: false },
    readWorkspaceFile: async () => ({ content: ansi.replace('matter_folders: ["Podklady", "N�vrhy"]\nfolder_roles:\n  drafts: "N�vrhy"\n', "") }),
    writeWorkspaceFile: async () => { throw new Error("must not write"); },
  };
  // Aj keď sú vlastnené kľúče v poriadku, poškodené meno v poverení by uloženie zapísalo ako U+FFFD.
  await expect(loadOfficeProfile(client as never, "ws_1", "/kancelaria/Office")).rejects.toMatchObject({ code: OFFICE_CONFIG_ENCODING_CODE });
});
