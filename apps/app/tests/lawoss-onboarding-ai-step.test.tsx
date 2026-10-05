import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AiStepView, type AiModelView } from "../src/lawoss/domains/onboarding/ai-step";

const view = (model: AiModelView, options: { locale?: "sk" | "cs" | "en" | "de"; withContinue?: boolean } = {}) =>
  renderToStaticMarkup(
    <AiStepView
      locale={options.locale ?? "sk"}
      model={model}
      busy={false}
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

  test("before the first folder there are no AI settings to open, only the way forward", () => {
    const html = view({ state: "no-workspace" });
    expect(html).toContain('data-lawoss-ai-model="no-workspace"');
    expect(html).toContain("Model pripojíte, keď bude otvorený prvý priečinok");
    expect(html).not.toContain("Otvoriť nastavenia AI");
    expect(html).toContain("Pokračovať bez modelu");
    expect(view({ state: "no-workspace" }, { locale: "cs" })).toContain("Poskytovatelé AI");
    expect(view({ state: "no-workspace" }, { locale: "en" })).toContain("Settings → AI Providers");
    expect(view({ state: "no-workspace" }, { locale: "de" })).toContain("KI-Provider");
  });

  test("continuing waits for the check", () => {
    expect(view({ state: "checking" })).toMatch(/<button[^>]*disabled=""[^>]*>Pokračovať bez modelu<\/button>/);
  });

  test("the path without OKF has no continue button here", () => {
    const html = view({ state: "no-model" }, { withContinue: false });
    expect(html).not.toContain("Pokračovať bez modelu");
    expect(html).toContain("Zatiaľ nemáte pripojený model.");
  });

  test("analytics has no choice here: LAWOSS keeps it off permanently", () => {
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      const html = view({ state: "ready" }, { locale });
      expect(html).not.toContain('role="switch"');
      expect(html).not.toMatch(/anonym/i);
    }
  });

  test("every UI language carries the AI step texts", () => {
    expect(view({ state: "no-model" }, { locale: "cs" })).toContain("Pokračovat bez modelu");
    expect(view({ state: "no-model" }, { locale: "en" })).toContain("Continue without a model");
    expect(view({ state: "no-model" }, { locale: "de" })).toContain("Ohne Modell fortfahren");
  });
});
