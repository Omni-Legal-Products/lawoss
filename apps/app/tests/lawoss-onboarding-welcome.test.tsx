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
const page = (initialStep: OnboardingStep, extra: { initialRoot?: string; completed?: boolean } = {}) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <LocalProvider>
        <MemoryRouter>
          <LawossWelcomePage api={api} initialStep={initialStep} initialRoot={extra.initialRoot} hasCompletedOnboarding={extra.completed} onCancel={() => {}} pickDirectory={async () => null} onOpenAiSettings={() => {}} onComplete={() => {}} />
        </MemoryRouter>
      </LocalProvider>
    </QueryClientProvider>,
  );

describe("LAWOSS welcome flow", () => {
  test("onboarding má šesť krokov a krok Dokumenty ponúkne obe voľby (C1)", () => {
    const html = page("folder");
    expect(html).toContain('data-lawoss-onboarding-step="folder"');
    expect(html).toContain("repeat(6, minmax(0, 1fr))");
    expect(html).not.toContain("grid-cols-5");
    expect(html).toContain("Connect an existing folder");
    expect(html).toContain("Start fresh");
  });

  test("krok AI sa dá preskočiť", () => {
    const html = page("ai");
    expect(html).toMatch(/Continue without AI|>Continue</);
  });

  test("kroky Ako agent pracuje a Pripravené sú v sprievodcovi so Späť pri nadpise a bez päty (C1)", () => {
    const approvals = page("approvals");
    expect(approvals).toContain("repeat(6, minmax(0, 1fr))");
    expect(approvals).toMatch(/<li data-state="current" aria-current="step"><span class="lw-onb-step-bar"><\/span><span class="lw-onb-step-label">5\. How the agent works/);
    expect(approvals).toContain('data-lawoss-wizard-screen="approvals"');
    expect(approvals).toContain("Ask before every change");
    expect(approvals).toMatch(/>Back<\/button>/);
    expect(approvals).not.toContain("<footer");
    const ready = page("ready");
    expect(ready).toContain('data-lawoss-wizard-screen="ready"');
    // Pri SSR sa postup z úložiska nenačíta: bez pripojeného priečinka je prvou úlohou pripojiť ho.
    expect(ready).toContain('data-lawoss-ready-primary="connectFolder"');
    expect(ready).toMatch(/>Back<\/button>/);
    expect(ready).not.toContain("<footer");
  });

  test("krok Toto sme našli bez vybraného priečinka ukáže výber dokumentov (C1)", () => {
    const html = page("found");
    expect(html).toContain('data-lawoss-onboarding-step="found"');
    expect(html).toContain('data-lawoss-wizard-screen="folder"');
    expect(html).toContain("Connect an existing folder");
  });

  test("odkaz s priečinkom (?root=) v hlavnej ceste otvorí krok found (atribút kroku sa zmenil z folder)", () => {
    expect(page("folder", { initialRoot: "/x" })).toContain('data-lawoss-onboarding-step="found"');
    expect(page("folder", { initialRoot: "/x", completed: true })).toContain('data-lawoss-onboarding-step="folder"');
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

  test("Vybrať iný priečinok je dostupné už počas prezerania priečinka (MČ 19. 10.)", () => {
    const html = page("folder", { initialRoot: "/Users/a/Klienti/Novák" });
    expect(html).toContain("Looking at the folder…");
    expect(html).toMatch(/<button[^>]*>Choose another folder<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Choose another folder/);
  });

  test("obrazovka Toto som našiel nahradí krok Priečinok aj po obnovení na kroku found", () => {
    const html = page("found", { initialRoot: "/x" });
    expect(html).toContain("Looking at the folder…");
    expect(html).toMatch(/<li data-state="current" aria-current="step"><span class="lw-onb-step-bar"><\/span><span class="lw-onb-step-label">3\. /);
  });

  test("tok z bočného panela po dokončenom onboardingu: Zrušiť namiesto hlavičky krokov a Späť", () => {
    for (const html of [page("folder", { completed: true }), page("client", { completed: true }), page("matter", { completed: true })]) {
      expect(html).toMatch(/<button[^>]*class="lw-btn"[^>]*>Cancel<\/button>/);
      expect(html).not.toContain("lw-onb-steps");
      expect(html).not.toMatch(/>Back</);
    }
  });

  test("kým sa hľadá klient pre nový prípad, ostáva Zrušiť aj Teraz preskočiť (19. 10. 2026)", () => {
    const html = page("matter", { completed: true });
    expect(html).toContain("Finding the open client");
    expect(html).toMatch(/>Cancel<\/button>/);
    expect(html).toMatch(/>Skip for now<\/button>/);
  });

  test("prvý onboarding nemá Zrušiť a krok Priečinok má Späť", () => {
    const html = page("folder");
    expect(html).not.toMatch(/>Cancel</);
    expect(html).toMatch(/>Back</);
  });

  test("Späť a Zrušiť na kroku Priečinok sú v hlavičke, bez rolovania pod voľby (MČ 19. 10.)", () => {
    for (const [html, label] of [[page("folder"), ">Back<"], [page("folder", { completed: true }), ">Cancel<"]] as const) {
      expect(html.indexOf(label)).toBeGreaterThan(-1);
      expect(html.indexOf(label)).toBeLessThan(html.indexOf("Connect an existing folder"));
      expect(html.split(label)).toHaveLength(2);
      expect(html).not.toContain("<footer");
    }
  });

  test("počas obrazovky Toto som našiel nie je Späť (zápis sa nedá potichu opustiť)", () => {
    expect(page("folder", { initialRoot: "/Users/a/Klienti/Novák" })).not.toMatch(/>Back</);
    const sidebar = page("folder", { initialRoot: "/Users/a/Klienti/Novák", completed: true });
    expect(sidebar).not.toMatch(/>Cancel</);
    expect(sidebar).not.toContain("lw-onb-steps");
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

  // Koreň praxe (pripojený existujúci priečinok) nie je kancelária: Klienti patria dovnútra, nie vedľa.
  test("the Klienti folder lies inside a practice root and beside an office folder", () => {
    expect(clientsFolderOf("/x/Prax")).toBe("/x/Prax/Klienti");
    expect(clientsFolderOf("/x/Prax/Office")).toBe("/x/Prax/Klienti");
    expect(clientsFolderOf("C:\\Prax")).toBe("C:\\Prax\\Klienti");
    expect(clientsFolderOf("C:\\Prax\\Office")).toBe("C:\\Prax\\Klienti");
    expect(clientsFolderOf("/x/Prax/_kancelaria")).toBe("/x/Prax/Klienti");
    expect(clientsFolderOf("/x/Prax/")).toBe("/x/Prax/Klienti");
  });
});
