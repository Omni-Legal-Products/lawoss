/**
 * Nález N-A7-15 (zadanie L): v nastaveniach pre advokáta nesmie byť Eigenwelt ani ponuka
 * predplatného. Súkromie ukazovalo mŕtvy prepínač „Aktualizovať zoznam modelov online“
 * so sťahovaním od Eigenweltu, Oprávnenia nástrojov vetu o pláne „Sync, Plus alebo Pro“.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { currentLocale, setLocale, t, type Language } from "../src/i18n";
import { isModelCatalogUpdatesHidden } from "../src/lawoss/feature-flags";
import { PreferencesView } from "../src/react-app/domains/settings/pages/preferences-view";

const initial: Language = currentLocale();
afterEach(() => setLocale(initial));

const privacy = () =>
  renderToStaticMarkup(
    <PreferencesView
      busy={false}
      showThinking={false}
      onToggleShowThinking={() => {}}
      autoCompactContext={false}
      autoCompactContextBusy={false}
      onToggleAutoCompactContext={() => {}}
      analyticsEnabled={false}
      onToggleAnalytics={() => {}}
      modelCatalogUpdatesEnabled={false}
      modelCatalogUpdatesBusy={false}
      modelCatalogUpdatesError={null}
      onToggleModelCatalogUpdates={() => {}}
      hideAppMode="recording"
      onChangeHideAppMode={() => {}}
    />,
  );

describe("N-A7-15: nastavenia bez Eigenweltu a ponuky plánov", () => {
  test("Súkromie neponúka sťahovanie zoznamu modelov", () => {
    expect(isModelCatalogUpdatesHidden()).toBe(true);
    for (const language of ["sk", "cs", "en", "de"] as const) {
      setLocale(language);
      const html = privacy();
      expect(html).not.toContain(t("settings.model_catalog_updates"));
      expect(html).not.toContain("Eigenwelt");
      // Ostatné voľby Súkromia ostávajú.
      expect(html).toContain(t("settings.hide_app_title"));
    }
  });

  test("Oprávnenia nástrojov: uložené na tomto počítači, bez plánu Sync, Plus alebo Pro", () => {
    const expected: Record<Language, string> = {
      sk: "Uložené na tomto počítači.",
      cs: "Uloženo na tomto počítači.",
      en: "Saved on this computer.",
      de: "Auf diesem Computer gespeichert.",
    };
    for (const language of ["sk", "cs", "en", "de"] as const) {
      setLocale(language);
      expect(t("sandbox.sync_local")).toBe(expected[language]);
    }
  });
});
