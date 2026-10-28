/**
 * Nález N-A7-12: pri OpenAI pripojenom cez predplatné ChatGPT (OAuth) Nastavenia → Poskytovatelia AI
 * ponúkali „Upraviť“, ktoré skončilo anglickou hláškou „Couldn't load configuration for openai.“
 * OpenCode 1.18.29 dáva takému poskytovateľovi zdroj `custom` bez bloku v konfigurácii a bez adresy.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { currentLocale, setLocale, t, type Language } from "../src/i18n";
import { lawossProviderRow } from "../src/lawoss/providers/provider-row";
import { AiSettingsView } from "../src/react-app/domains/settings/pages/ai-view";

const initial: Language = currentLocale();
afterEach(() => setLocale(initial));

const chatgptOAuth = { id: "openai", name: "OpenAI", source: "custom" as const, options: {} };
const anthropicOAuth = { id: "anthropic", name: "Anthropic", source: "custom" as const, options: {} };
const openaiApiKey = { id: "openai", name: "OpenAI", source: "api" as const, options: {} };
const ownProvider = { id: "kancelaria-llm", name: "Kancelária LLM", source: "config" as const, options: { baseURL: "http://localhost:11434/v1" } };

describe("N-A7-12: Upraviť len pri poskytovateľovi s vlastnou adresou", () => {
  test("prihlásenie cez účet (zdroj custom bez adresy) sa upraviť nedá", () => {
    expect(lawossProviderRow(chatgptOAuth).editableAsCustom).toBe(false);
    expect(lawossProviderRow(anthropicOAuth).editableAsCustom).toBe(false);
    expect(lawossProviderRow(openaiApiKey).editableAsCustom).toBe(false);
  });

  test("vlastný poskytovateľ s adresou sa upraviť dá", () => {
    expect(lawossProviderRow(ownProvider).editableAsCustom).toBe(true);
    expect(lawossProviderRow({ ...ownProvider, source: "custom" }).editableAsCustom).toBe(true);
    expect(lawossProviderRow({ ...ownProvider, options: { baseURL: "  " } }).editableAsCustom).toBe(false);
  });

  test("popis predplatného len pri OpenAI bez vlastnej adresy", () => {
    setLocale("sk");
    expect(lawossProviderRow(chatgptOAuth).sourceLabel).toBe("Predplatné ChatGPT");
    const openaiWithBaseURL = { ...chatgptOAuth, options: { baseURL: "https://proxy.kancelaria.invalid/v1" } };
    expect(lawossProviderRow(openaiWithBaseURL).sourceLabel).toBeUndefined();
    expect(lawossProviderRow(openaiWithBaseURL).editableAsCustom).toBe(true);
    expect(lawossProviderRow(openaiApiKey).sourceLabel).toBeUndefined();
  });

  test("predplatné ChatGPT nie je „Vlastné“", () => {
    setLocale("sk");
    const html = renderToStaticMarkup(
      <AiSettingsView
        busy={false}
        providerAuthBusy={false}
        providerStatusLabel=""
        providerStatusStyle=""
        providerSummary=""
        connectedProviders={[
          { id: chatgptOAuth.id, name: chatgptOAuth.name, source: chatgptOAuth.source, ...lawossProviderRow(chatgptOAuth) },
          { id: anthropicOAuth.id, name: anthropicOAuth.name, source: anthropicOAuth.source, ...lawossProviderRow(anthropicOAuth) },
        ]}
        disconnectingProviderId={null}
        providerConnectError={null}
        providerDisconnectStatus={null}
        providerDisconnectError={null}
        onOpenProviderAuth={() => {}}
        onDisconnectProvider={() => {}}
        canDisconnectProvider={() => true}
        firmProviders={[]}
        onSignInFirmProvider={() => {}}
        onSaveFirmProviderKey={async () => undefined}
        eigenweltConnected={false}
        onManageEigenweltAccount={() => {}}
      />,
    );
    expect(html).toContain("Predplatné ChatGPT");
    // Iný poskytovateľ so zdrojom custom si upstream popis ponechá.
    expect(html.match(/Vlastné/g)?.length ?? 0).toBe(1);
  });

  test("Nastavenia používajú háčik a hláška je preložená", () => {
    const route = readFileSync(join(import.meta.dir, "../src/react-app/shell/settings-route.tsx"), "utf8");
    expect(route).toContain("...lawossProviderRow(provider),");
    expect(route).not.toContain('editableAsCustom: provider.source === "custom"');
    expect(route).not.toContain("Couldn't load configuration");
    expect(route).toContain('t("lawoss.providers.edit_unavailable", { name: resolveProviderDisplayName(providerId) })');
  });

  test("hláška povie ďalší krok vo všetkých štyroch jazykoch", () => {
    const steps: Record<Language, string[]> = {
      sk: ["OpenAI", "„Odpojiť“", "„Pridať poskytovateľa“"],
      cs: ["OpenAI", "„Odpojit“", "„Přidat poskytovatele“"],
      en: ["OpenAI", "“Disconnect”", "“Add provider”"],
      de: ["OpenAI", "„Trennen“", "„Anbieter hinzufügen“"],
    };
    for (const language of ["sk", "cs", "en", "de"] as const) {
      setLocale(language);
      const message = t("lawoss.providers.edit_unavailable", { name: "OpenAI" });
      for (const part of steps[language]) expect(message).toContain(part);
      expect(message).not.toContain("Couldn't");
    }
  });
});
