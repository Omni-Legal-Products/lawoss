// LAWOSS #552: chyby verejnej požiadavky AI sú v jazyku rozhrania podľa kódu, nie anglická správa servera.
import { describe, expect, test } from "bun:test";
import { LegalworkServerError } from "../src/app/lib/legalwork-server";
import { publicAiErrorMessage } from "../src/lawoss/domains/ai/public-ai-error";

const denied = new LegalworkServerError(403, "public_ai_denied", "The public transmission was denied; protected AI remains unavailable.");

describe("#552 chyby verejného textu v oddelenom prostredí", () => {
  test("odmietnutie v okne hostiteľa po slovensky, česky, anglicky a nemecky", () => {
    expect(publicAiErrorMessage(denied, "sk")).toBe("Odoslanie ste v okne hostiteľa odmietli. Do modelu sa nič neodoslalo. Chránený kontext zostáva blokovaný.");
    expect(publicAiErrorMessage(denied, "cs")).toBe("Odeslání jste v okně hostitele odmítli. Do modelu se nic neodeslalo. Chráněný kontext zůstává blokovaný.");
    expect(publicAiErrorMessage(denied, "en")).toBe("You declined the transmission in the host window. Nothing was sent to the model. Protected context remains blocked.");
    expect(publicAiErrorMessage(denied, "de")).toBe("Sie haben die Übertragung im Hostfenster abgelehnt. An das Modell wurde nichts gesendet. Geschützter Kontext bleibt gesperrt.");
  });

  test("známe kódy majú vlastnú slovenskú vetu a nikdy anglickú správu servera", () => {
    for (const code of ["public_ai_engine_unavailable", "public_ai_engine_version", "public_ai_provider_unsupported", "public_ai_target_invalid", "org_policy_denied",
      "invalid_public_prompt", "read_only", "public_ai_model_failed", "public_ai_empty_reply"]) {
      const message = publicAiErrorMessage(new LegalworkServerError(409, code, "ENGLISH-SERVER-MESSAGE"), "sk");
      expect(message).not.toContain("ENGLISH-SERVER-MESSAGE");
      expect(message).not.toContain(code);
      expect(message).not.toBe(publicAiErrorMessage(denied, "sk"));
    }
  });

  test("neznámy kód servera dostane všeobecnú vetu s kódom; chyba bez kódu servera nič (sekcia ukáže vetu o nedostupnosti)", () => {
    expect(publicAiErrorMessage(new LegalworkServerError(500, "internal_error", "Unexpected server error"), "sk")).toBe("Verejnú požiadavku sa nepodarilo dokončiť (kód: internal_error).");
    expect(publicAiErrorMessage(new Error("Request timed out after 120000 ms"), "sk")).toBeNull();
  });
});
