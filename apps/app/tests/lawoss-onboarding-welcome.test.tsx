import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LocalProvider } from "../src/react-app/kernel/local-provider";
import { clientsFolderOf, LawossWelcomePage, type WelcomeApi } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import type { OnboardingStep } from "../src/lawoss/domains/onboarding/api";

// renderToStaticMarkup nespúšťa efekty a jazyk rozhrania je pri SSR angličtina (useLocale).
const api: WelcomeApi = {
  onboardingStatus: async () => ({ profile: null, capabilities: { map: true, trialClone: true } }),
  updateOnboardingProfile: async (profile) => ({ version: 1, lawyerName: "", jurisdiction: "sk", language: "sk", ...profile }),
  classifyOnboarding: async () => ({ level: "unknown", confidence: "unknown", complete: false }),
  planOnboarding: async () => ({ id: "plan", fingerprint: "fingerprint", preview: {} }),
  applyOnboarding: async () => ({ result: "applied" }),
  suggestOnboarding: async () => ({ root: "/x", level: "client", marked: false, score: 0.5, signals: [], clients: [], complete: true }),
  lawossTriage: <T,>(): Promise<T> => Promise.reject(new Error("pri SSR sa nevolá")),
};
// Krok AI číta predvolený model z LocalProvider a zoznam poskytovateľov cez react-query.
const page = (initialStep: OnboardingStep, extra: { initialRoot?: string } = {}) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <LocalProvider>
        <MemoryRouter>
          <LawossWelcomePage api={api} initialStep={initialStep} initialRoot={extra.initialRoot} pickDirectory={async () => null} onOpenAiSettings={() => {}} onComplete={() => {}} />
        </MemoryRouter>
      </LocalProvider>
    </QueryClientProvider>,
  );

describe("LAWOSS welcome flow", () => {
  test("onboarding má tri kroky a krok Priečinok ponúkne obe voľby", () => {
    const html = page("folder");
    expect(html).toContain('data-lawoss-onboarding-step="folder"');
    expect(html).toContain("repeat(3, minmax(0, 1fr))");
    expect(html).not.toContain("grid-cols-5");
    expect(html).toContain("Connect an existing folder");
    expect(html).toContain("Start fresh");
  });

  test("krok AI sa dá preskočiť", () => {
    const html = page("ai");
    expect(html).toMatch(/Continue without a model|>Continue</);
  });

  test("staré kroky (voľba OKF, kancelária, balíky) sa otvoria ako krok Priečinok", () => {
    for (const step of ["okf", "office", "packs"] as const) {
      const html = page(step);
      expect(html).toContain('data-lawoss-onboarding-step="folder"');
      expect(html).toContain("Connect an existing folder");
      expect(html).not.toContain("Matter organisation (OKF)");
      expect(html).not.toContain("Recommended packs");
    }
  });

  test("cesta z odkazu otvorí rovno obrazovku Toto som našiel", () => {
    const html = page("folder", { initialRoot: "/Users/a/Klienti/Novák" });
    expect(html).toContain("Looking at the folder…");
    expect(html).not.toContain("Start fresh");
  });

  test("obrazovka Toto som našiel nahradí krok Priečinok aj po obnovení na kroku found", () => {
    const html = page("found", { initialRoot: "/x" });
    expect(html).toContain("Looking at the folder…");
    expect(html).toMatch(/<li data-state="current" aria-current="step"><span class="lw-onb-step-bar"><\/span><span class="lw-onb-step-label">3\. /);
  });

  test("formuláre klienta a veci z bočného panela nemajú hlavičku krokov", () => {
    expect(page("client")).not.toContain("lw-onb-steps");
    expect(page("matter")).not.toContain("lw-onb-steps");
    expect(page("folder")).toContain("lw-onb-steps");
  });

  test("the welcome flow scrolls inside its own area because the app root does not scroll", () => {
    expect(page("folder")).toMatch(/<div class="lw-onb h-screen overflow-y-auto" data-lawoss-onboarding-scroll="true">(?:<div [^>]*><\/div>)?<main/);
  });

  test("the welcome flow has a titlebar strip so the frameless window can be dragged", () => {
    expect(page("folder")).toMatch(/<div aria-hidden="true" class="fixed inset-x-0 top-0 z-20 h-10 mac:titlebar-drag"><\/div>/);
  });

  // Funkcia ostáva: krok klienta (`Client`) ňou predvypĺňa priečinok klientov vedľa kancelárie.
  test("the client step suggests the Klienti folder created next to the office", () => {
    expect(clientsFolderOf("/Users/a/LAWOSS/Office")).toBe("/Users/a/LAWOSS/Klienti");
    expect(clientsFolderOf("/Users/a/LAWOSS/Office/")).toBe("/Users/a/LAWOSS/Klienti");
    expect(clientsFolderOf("C:\\Data\\Office")).toBe("C:\\Data\\Klienti");
    expect(clientsFolderOf("/Office")).toBe("/Klienti");
    expect(clientsFolderOf(undefined)).toBe("");
    expect(clientsFolderOf("  ")).toBe("");
    expect(clientsFolderOf("Office")).toBe("");
  });
});
