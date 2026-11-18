// LAWOSS #545: uloženie do priečinka bez práva zápisu ukáže zrozumiteľnú hlášku namiesto „Unexpected server error“.
import { afterEach, describe, expect, test } from "bun:test";
import { LegalworkServerError } from "../src/app/lib/legalwork-server";
import { setLocale } from "../src/i18n";
import { fileSaveErrorMessage } from "../src/lawoss/domains/artifacts/file-save-error";

afterEach(() => setLocale("en"));

const denied = new LegalworkServerError(403, "file_not_writable", "The file cannot be saved: the folder is read-only or you do not have permission to write to it.");

describe("#545 hláška pri neuložení dokumentu", () => {
  test("priečinok bez práva zápisu po slovensky a česky", () => {
    setLocale("sk");
    expect(fileSaveErrorMessage(denied)).toBe("Dokument sa nedá uložiť: priečinok klienta je len na čítanie alebo nemáte právo zápisu. Zmeny ostali v editore. Uložte kópiu inam (Stiahnuť) alebo požiadajte o prístup.");
    setLocale("cs");
    expect(fileSaveErrorMessage(denied)).toBe("Dokument nelze uložit: složka klienta je jen pro čtení nebo nemáte právo zápisu. Změny zůstaly v editoru. Uložte kopii jinam (Stáhnout) nebo požádejte o přístup.");
  });

  test("plný disk má vlastnú hlášku", () => {
    setLocale("sk");
    expect(fileSaveErrorMessage(new LegalworkServerError(507, "disk_full", "The file cannot be saved: the disk is full."))).toBe("Dokument sa nedá uložiť: disk je plný. Zmeny ostali v editore. Uvoľnite miesto na disku alebo uložte kópiu inam (Stiahnuť).");
  });

  test("iné chyby nechá na pôvodnú hlášku", () => {
    expect(fileSaveErrorMessage(new LegalworkServerError(409, "conflict", "File changed since it was loaded"))).toBeNull();
    expect(fileSaveErrorMessage(new Error("file_not_writable"))).toBeNull();
  });
});
