import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AiStepView, type AiModelView } from "../src/lawoss/domains/onboarding/ai-step";

const view = (model: AiModelView, options: { locale?: "sk" | "cs" | "en" | "de"; analytics?: boolean; withContinue?: boolean } = {}) =>
  renderToStaticMarkup(
    <AiStepView
      locale={options.locale ?? "sk"}
      model={model}
      analyticsEnabled={options.analytics ?? false}
      busy={false}
      onAnalyticsChange={() => {}}
      onOpenAiSettings={() => {}}
      onContinue={options.withContinue === false ? undefined : () => {}}
    />,
  );

describe("onboarding AI step", () => {
  test("a connected model is named and continuing is plain", () => {
    const html = view({ state: "ready", modelLabel: "Anthropic · Claude Sonnet" });
    expect(html).toContain('data-lawoss-ai-model="ready"');
    expect(html).toContain("Model je pripojený:");
    expect(html).toContain("Anthropic · Claude Sonnet");
    expect(html).toContain(">Pokračovať</button>");
    expect(html).toContain("Otvoriť nastavenia AI");
  });

  test("without a model the state is stated and continuing says so", () => {
    const html = view({ state: "no-model" });
    expect(html).toContain('data-lawoss-ai-model="no-model"');
    expect(html).toContain("Zatiaľ nemáte pripojený model.");
    expect(html).toContain("Pokračovať bez modelu");
    expect(html).not.toContain("Model je pripojený");
  });

  test("a connected provider without a pick and a vanished model are explicit too", () => {
    expect(view({ state: "pick-model" })).toContain("model zatiaľ nie je vybraný");
    expect(view({ state: "unavailable" })).toContain("Vybraný model už nie je dostupný.");
    expect(view({ state: "unavailable" })).toContain("Pokračovať bez modelu");
  });

  test("continuing waits for the check", () => {
    expect(view({ state: "checking" })).toMatch(/<button[^>]*disabled=""[^>]*>Pokračovať bez modelu<\/button>/);
  });

  test("the path without OKF has no continue button here", () => {
    const html = view({ state: "no-model" }, { withContinue: false });
    expect(html).not.toContain("Pokračovať bez modelu");
    expect(html).toContain("Zatiaľ nemáte pripojený model.");
  });

  test("analytics is a switch, off unless chosen", () => {
    expect(view({ state: "ready" })).toMatch(/role="switch"[^>]*aria-checked="false"|aria-checked="false"[^>]*role="switch"/);
    expect(view({ state: "ready" }, { analytics: true })).toMatch(/role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/);
    expect(view({ state: "ready" })).toContain("Predvolene vypnuté");
  });

  test("every UI language carries the AI step texts", () => {
    expect(view({ state: "no-model" }, { locale: "cs" })).toContain("Pokračovat bez modelu");
    expect(view({ state: "no-model" }, { locale: "cs" })).toContain("Sdílet anonymní údaje o používání");
    expect(view({ state: "no-model" }, { locale: "en" })).toContain("Continue without a model");
    expect(view({ state: "ready" }, { locale: "en" })).toContain("Share anonymous usage data");
    expect(view({ state: "no-model" }, { locale: "de" })).toContain("Ohne Modell fortfahren");
    expect(view({ state: "ready" }, { locale: "de" })).toContain("Anonyme Nutzungsdaten teilen");
  });
});
