import { LegalworkServerError } from "@/app/lib/legalwork-server";
import type { Language } from "@/i18n";

type Messages = {
  public_ai_denied: string; public_ai_engine_unavailable: string; public_ai_engine_version: string; public_ai_provider_unsupported: string;
  public_ai_target_invalid: string; org_policy_denied: string; invalid_public_prompt: string; read_only: string;
  public_ai_model_failed: string; public_ai_empty_reply: string; failed: string;
};

const MESSAGES: Record<Language, Messages> = {
  sk: {
    public_ai_denied: "Odoslanie ste v okne hostiteľa odmietli. Do modelu sa nič neodoslalo. Chránený kontext zostáva blokovaný.",
    public_ai_engine_unavailable: "Spustite spravovaný engine; verejný test bez neho nebeží.",
    public_ai_engine_version: "Spravovaný engine nemá overenú verziu pre verejný test. Aktualizujte alebo reštartujte LAWOSS.",
    public_ai_provider_unsupported: "Vyberte nastaveného OpenAI-compatible poskytovateľa a jeden z jeho modelov.",
    public_ai_target_invalid: "Adresa poskytovateľa musí používať HTTPS alebo byť lokálna (localhost) a nesmie obsahovať prihlasovacie údaje.",
    org_policy_denied: "Politika kancelárie nepovoľuje vlastné pripojenie k verejnému modelu.",
    invalid_public_prompt: "Vyberte poskytovateľa, model a zadajte verejný text (najviac 16 000 znakov).",
    read_only: "Server je len na čítanie; verejný test teraz nemožno spustiť.",
    public_ai_model_failed: "Model nevrátil úspešnú odpoveď. Skontrolujte, či poskytovateľ beží a model existuje.",
    public_ai_empty_reply: "Model vrátil prázdnu odpoveď.",
    failed: "Verejnú požiadavku sa nepodarilo dokončiť (kód: {code}).",
  },
  cs: {
    public_ai_denied: "Odeslání jste v okně hostitele odmítli. Do modelu se nic neodeslalo. Chráněný kontext zůstává blokovaný.",
    public_ai_engine_unavailable: "Spusťte spravovaný engine; veřejný test bez něj neběží.",
    public_ai_engine_version: "Spravovaný engine nemá ověřenou verzi pro veřejný test. Aktualizujte nebo restartujte LAWOSS.",
    public_ai_provider_unsupported: "Vyberte nastaveného OpenAI-compatible poskytovatele a jeden z jeho modelů.",
    public_ai_target_invalid: "Adresa poskytovatele musí používat HTTPS nebo být místní (localhost) a nesmí obsahovat přihlašovací údaje.",
    org_policy_denied: "Politika kanceláře nepovoluje vlastní připojení k veřejnému modelu.",
    invalid_public_prompt: "Vyberte poskytovatele, model a zadejte veřejný text (nejvýše 16 000 znaků).",
    read_only: "Server je jen pro čtení; veřejný test teď nelze spustit.",
    public_ai_model_failed: "Model nevrátil úspěšnou odpověď. Zkontrolujte, zda poskytovatel běží a model existuje.",
    public_ai_empty_reply: "Model vrátil prázdnou odpověď.",
    failed: "Veřejný požadavek se nepodařilo dokončit (kód: {code}).",
  },
  en: {
    public_ai_denied: "You declined the transmission in the host window. Nothing was sent to the model. Protected context remains blocked.",
    public_ai_engine_unavailable: "Start the managed engine; the public test does not run without it.",
    public_ai_engine_version: "The managed engine does not have the verified version for the public test. Update or restart LAWOSS.",
    public_ai_provider_unsupported: "Select a configured OpenAI-compatible provider and one of its models.",
    public_ai_target_invalid: "The provider address must use HTTPS or be local (localhost) and must not contain credentials.",
    org_policy_denied: "The firm policy does not permit a custom connection to a public model.",
    invalid_public_prompt: "Select a provider and a model and enter public text (at most 16,000 characters).",
    read_only: "The server is read-only; the public test cannot run now.",
    public_ai_model_failed: "The model did not return a successful answer. Check that the provider is running and the model exists.",
    public_ai_empty_reply: "The model returned an empty answer.",
    failed: "The public request could not be completed (code: {code}).",
  },
  de: {
    public_ai_denied: "Sie haben die Übertragung im Hostfenster abgelehnt. An das Modell wurde nichts gesendet. Geschützter Kontext bleibt gesperrt.",
    public_ai_engine_unavailable: "Starten Sie die verwaltete Engine; ohne sie läuft der öffentliche Test nicht.",
    public_ai_engine_version: "Die verwaltete Engine hat nicht die geprüfte Version für den öffentlichen Test. Aktualisieren oder starten Sie LAWOSS neu.",
    public_ai_provider_unsupported: "Wählen Sie einen konfigurierten OpenAI-kompatiblen Anbieter und eines seiner Modelle.",
    public_ai_target_invalid: "Die Anbieteradresse muss HTTPS verwenden oder lokal (localhost) sein und darf keine Zugangsdaten enthalten.",
    org_policy_denied: "Die Kanzleirichtlinie erlaubt keine eigene Verbindung zu einem öffentlichen Modell.",
    invalid_public_prompt: "Wählen Sie Anbieter und Modell und geben Sie öffentlichen Text ein (höchstens 16.000 Zeichen).",
    read_only: "Der Server ist schreibgeschützt; der öffentliche Test kann jetzt nicht laufen.",
    public_ai_model_failed: "Das Modell hat keine erfolgreiche Antwort geliefert. Prüfen Sie, ob der Anbieter läuft und das Modell existiert.",
    public_ai_empty_reply: "Das Modell hat eine leere Antwort geliefert.",
    failed: "Die öffentliche Anfrage konnte nicht abgeschlossen werden (Code: {code}).",
  },
};

const isKnownCode = (code: string): code is Exclude<keyof Messages, "failed"> => code !== "failed" && Object.hasOwn(MESSAGES.en, code);

/** #552: anglickú správu servera neukazuje; podľa `code` vráti vetu v jazyku rozhrania, bez kódu servera `null`. */
export function publicAiErrorMessage(error: unknown, locale: Language): string | null {
  const messages = MESSAGES[locale];
  if (!(error instanceof LegalworkServerError)) return null;
  return isKnownCode(error.code) ? messages[error.code] : messages.failed.replace("{code}", error.code);
}
