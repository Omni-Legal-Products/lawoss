import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { LawossWelcomePage, OkfChoiceStep, WorkingFolderStep } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import type { OnboardingApi } from "../src/lawoss/domains/onboarding/api";

const api: OnboardingApi = {
  onboardingStatus: async () => ({ profile: null, capabilities: { map: true, trialClone: true } }),
  updateOnboardingProfile: async (profile) => ({ version: 1, lawyerName: "", jurisdiction: "sk", language: "sk", ...profile }),
  classifyOnboarding: async () => ({ level: "unknown", confidence: "unknown", complete: false }),
  planOnboarding: async () => ({ id: "plan", fingerprint: "fingerprint", preview: {} }),
  applyOnboarding: async () => ({ result: "applied" }),
};
const choice = (locale: "sk" | "cs" | "en" | "de", initial?: boolean) =>
  renderToStaticMarkup(<OkfChoiceStep locale={locale} initial={initial} busy={false} continueLabel="Pokračovať" onChoose={async () => {}} />);

describe("OKF choice step", () => {
  test("shows the versioned notice verbatim with two equal choices and nothing preselected", () => {
    const html = choice("sk");
    expect(html).toContain("Organizácia spisov (OKF)");
    expect(html).toContain("V alfa verzii pracujte len s vymyslenými alebo verejnými údajmi, nie so skutočnými spismi.");
    expect(html).toContain("Používať OKF");
    expect(html).toContain("Zatiaľ bez OKF");
    expect(html.match(/aria-pressed="false"/g)?.length).toBe(2);
    expect(html).not.toContain("Beriem na vedomie");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Pokračovať<\/button>/);
    expect(html).not.toMatch(/súhlas/i);
  });

  test("using OKF requires the acknowledgement before continuing", () => {
    const html = choice("sk", true);
    expect(html).toContain("Beriem na vedomie, ako OKF pracuje s údajmi spisu.");
    expect(html).toContain('type="checkbox"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Pokračovať<\/button>/);
  });

  test("continuing without OKF needs no acknowledgement", () => {
    const html = choice("sk", false);
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Pokračovať<\/button>/);
  });

  test("every UI language carries its notice", () => {
    expect(choice("cs")).toContain("Používat OKF");
    expect(choice("cs", true)).toContain("Beru na vědomí, jak OKF pracuje s údaji spisu.");
    expect(choice("en", true)).toContain("I acknowledge how OKF handles matter data.");
    expect(choice("de", true)).toContain("Ich nehme zur Kenntnis, wie OKF mit Aktendaten umgeht.");
    expect(choice("en")).toContain("Not now");
    expect(choice("de")).toContain("Vorerst ohne OKF");
  });

  test("the welcome flow can open directly at the OKF choice with a two-step path before choosing", () => {
    const html = renderToStaticMarkup(<MemoryRouter><LawossWelcomePage api={api} initialStep="okf" pickDirectory={async () => null} onOpenAiSettings={() => {}} onComplete={() => {}} /></MemoryRouter>);
    expect(html).toContain('data-lawoss-onboarding-step="okf"');
    expect(html).toContain("repeat(2, minmax(0, 1fr))");
    expect(html).not.toContain("grid-cols-5");
  });

  test("the welcome flow scrolls inside its own area because the app root does not scroll", () => {
    const html = renderToStaticMarkup(<MemoryRouter><LawossWelcomePage api={api} initialStep="okf" pickDirectory={async () => null} onOpenAiSettings={() => {}} onComplete={() => {}} /></MemoryRouter>);
    expect(html).toMatch(/<div class="h-screen overflow-y-auto" data-lawoss-onboarding-scroll="true"><main/);
  });

  test("the path without OKF offers an optional working folder", () => {
    const html = renderToStaticMarkup(<WorkingFolderStep tr={(key) => key} busy={false} folder="" onFolderChange={() => {}} onFinish={() => {}} />);
    expect(html).toContain("workingFolder");
    expect(html).toContain("finish");
  });
});
