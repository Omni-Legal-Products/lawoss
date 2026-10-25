import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LocalProvider } from "../src/react-app/kernel/local-provider";
import { Client, LawossWelcomePage, welcomeText, type WelcomeApi } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import { revealError } from "../src/lawoss/domains/onboarding/reveal-error";
import type { OnboardingProfile } from "../src/lawoss/domains/onboarding/api";

// N-A5-5 (UI test dev 25. 10. 2026): po „Náhľad zmien“ (dolu) sa odmietnutie vnoreného klienta zobrazilo navrchu
// stránky mimo zorného poľa a „Pridať klienta“ v nastavenej praxi malo nadpis „Nastavte svoju prax“ a „Prvý klient“.

describe("odmietnutie sa posunie do zorného poľa", () => {
  test("hláška sa posunie do stredu okna a dostane fokus bez druhého posunu", () => {
    const calls: unknown[] = [];
    const element = { scrollIntoView: (options?: unknown) => calls.push(["scroll", options]), focus: (options?: unknown) => calls.push(["focus", options]) };
    revealError(element, false);
    revealError(element, true);
    revealError(null, false);
    expect(calls).toEqual([
      ["scroll", { block: "center", behavior: "smooth" }], ["focus", { preventScroll: true }],
      ["scroll", { block: "center", behavior: "auto" }], ["focus", { preventScroll: true }],
    ]);
  });

  test("onboarding volá posun pri každej novej chybe a hláška je zamerateľná (strážca väzby)", () => {
    // SSR nespúšťa efekty a repozitár nemá DOM pre testy: väzbu hlášky na posun stráži zdroj stránky (ref, tabIndex,
    // efekt nad errorState); správanie posunu a fokusu overuje test `revealError` vyššie.
    const page = readFileSync(join(import.meta.dir, "../src/lawoss/domains/onboarding/lawoss-welcome-page.tsx"), "utf8");
    expect(page).toContain("ref={errorBanner}");
    expect(page).toMatch(/role="alert"\s+tabIndex=\{-1\}/);
    expect(page).toMatch(/useEffect\(\(\) => \{\s+if \(errorState\) revealError\(errorBanner\.current/);
  });
});

const base: OnboardingProfile = { version: 1, lawyerName: "Testovací advokát", jurisdiction: "sk", language: "sk" };
const api: WelcomeApi = {
  onboardingStatus: async () => ({ profile: null, capabilities: { map: true, trialClone: true } }),
  updateOnboardingProfile: async (profile) => ({ version: 1, lawyerName: "", jurisdiction: "sk", language: "sk", ...profile }),
  classifyOnboarding: async () => ({ level: "unknown", confidence: "unknown", complete: false }),
  planOnboarding: async () => ({ id: "plan", fingerprint: "fingerprint", preview: {} }),
  applyOnboarding: async () => ({ result: "applied" }),
  suggestOnboarding: async () => ({ root: "/x", level: "client", marked: false, score: 0.5, signals: [], clients: [], complete: true }),
  lawossTriage: <T,>(): Promise<T> => Promise.reject(new Error("pri SSR sa nevolá")),
};
const page = (completed: boolean, initialStep: "client" | "matter" = "client") => renderToStaticMarkup(
  <QueryClientProvider client={new QueryClient()}><LocalProvider><MemoryRouter>
    <LawossWelcomePage api={api} initialStep={initialStep} hasCompletedOnboarding={completed} onCancel={() => {}} pickDirectory={async () => null} onOpenAiSettings={() => {}} onComplete={() => {}} />
  </MemoryRouter></LocalProvider></QueryClientProvider>,
);

describe("Pridať klienta v nastavenej praxi", () => {
  test("nadpis „Pridať klienta“ a karta „Nový klient“; prvé nastavenie ostáva „Nastavte svoju prax“", () => {
    // SSR jazyk rozhrania je angličtina (useLocale).
    expect(page(true)).toContain("Add a client");
    expect(page(true)).not.toContain("Set up your practice");
    // Karta klienta na stránke dostane „Nový klient“ (prop addingClient), nie „Prvý klient“.
    expect(page(true)).toContain("New client");
    expect(page(true)).not.toContain("First client");
    // „Nový prípad“ z bočného panela nie je nastavenie praxe.
    expect(page(true, "matter")).not.toContain("Set up your practice");
    expect(page(false)).toContain("Set up your practice");
    const sk = (addingClient: boolean) => renderToStaticMarkup(<Client base={base} locale="sk" tr={welcomeText("sk")} busy={false} onPlan={async () => {}} addingClient={addingClient} />);
    expect(sk(true)).toContain("Nový klient");
    expect(sk(true)).not.toContain("Prvý klient");
    expect(sk(false)).toContain("Prvý klient");
  });
});
