import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { OnboardingProfile } from "../src/lawoss/domains/onboarding/api";
import { markOnboardingCompleted, onboardingIncomplete, openingStep, resumeFound } from "../src/lawoss/domains/onboarding/resume";
import { OnboardingResumeCardView } from "../src/lawoss/domains/onboarding/resume-card";
import { OkfPageState } from "../src/lawoss/domains/okf-page";
import { OfficeProfileView } from "../src/lawoss/domains/settings/office-profile-view";

const base: OnboardingProfile = { version: 1, lawyerName: "Mgr. Test", jurisdiction: "sk", language: "sk" };

describe("návrat k nedokončenému nastaveniu praxe (#96)", () => {
  test("bez profilu sa karta neukáže (prvé spustenie rieši presmerovanie na /welcome)", () => {
    expect(onboardingIncomplete(null, false)).toBe(false);
    expect(onboardingIncomplete(null, true)).toBe(false);
  });

  test("prerušené nastavenie bez priečinka: karta sa ukáže", () => {
    expect(onboardingIncomplete({ ...base, step: "ai" }, false)).toBe(true);
  });

  test("pracovný priečinok vytvorený mimo sprievodcu (príznak v prefs, bez koreňov): karta sa ukáže", () => {
    expect(onboardingIncomplete({ ...base, step: "identity" }, true)).toBe(true);
  });

  test("prerušené počas pripájania (koreň zapísaný, príznak nie): karta sa ukáže", () => {
    expect(onboardingIncomplete({ ...base, step: "found", officeRoot: "/Prax" }, false)).toBe(true);
  });

  test("starší dokončený profil bez značky (koreň zo sprievodcu a príznak v prefs): karta sa neukáže", () => {
    expect(onboardingIncomplete({ ...base, step: "found", officeRoot: "/Prax" }, true)).toBe(false);
    expect(onboardingIncomplete({ ...base, step: "matter", clientRoot: "/Prax/Novák" }, true)).toBe(false);
  });

  test("dokončené so značkou ostáva dokončené aj po „+ Nová vec“ (krok matter)", () => {
    expect(onboardingIncomplete({ ...base, step: "matter", completedAt: "2026-10-18T10:00:00.000Z" }, false)).toBe(false);
  });

  test("pokračovanie otvorí uložený krok, dokončené nastavenie začne od prvého kroku", () => {
    expect(openingStep(undefined, { ...base, step: "ai" }, "identity", false)).toBe("ai");
    expect(openingStep(undefined, null, "folder", false)).toBe("folder");
    expect(openingStep(undefined, { ...base, step: "matter", completedAt: "2026-10-18T10:00:00.000Z" }, "matter", true)).toBe("identity");
    expect(openingStep("client", { ...base, completedAt: "2026-10-18T10:00:00.000Z" }, "identity", true)).toBe("client");
  });

  test("dokončenie zapíše značku do profilu na serveri, len raz", async () => {
    const calls: Partial<OnboardingProfile>[] = [];
    const api = { updateOnboardingProfile: async (patch: Partial<OnboardingProfile>) => { calls.push(patch); return { ...base, ...patch }; } };
    const now = new Date("2026-10-18T10:00:00.000Z");
    expect((await markOnboardingCompleted(api, base, now))?.completedAt).toBe("2026-10-18T10:00:00.000Z");
    expect(calls).toEqual([{ completedAt: "2026-10-18T10:00:00.000Z" }]);
    await markOnboardingCompleted(api, { ...base, completedAt: "2026-10-01T00:00:00.000Z" }, now);
    await markOnboardingCompleted(api, null, now);
    expect(calls).toHaveLength(1);
  });

  test("obnova po prerušení otvorí naposledy vybraný priečinok (M1, 22. 10. 2026)", () => {
    const profile: OnboardingProfile = { ...base, step: "found", foundRoot: "/x/3-neusporiadana-prax" };
    const step = openingStep(undefined, profile, "identity", false);
    expect(step).toBe("found");
    expect(resumeFound(step, profile)).toEqual({ root: "/x/3-neusporiadana-prax" });
    // `?root=` z adresy má prednosť; iný krok ani profil bez priečinka nič neobnoví.
    expect(resumeFound(step, profile, "/iny")).toBeNull();
    expect(resumeFound("folder", profile)).toBeNull();
    expect(resumeFound("found", { ...base, step: "found" })).toBeNull();
    expect(resumeFound("found", null)).toBeNull();
  });

  test("zmiznutý priečinok obnovy vráti krok Priečinok s preloženou vetou (review A4, minor 4)", async () => {
    const profile: OnboardingProfile = { ...base, step: "found", foundRoot: "/x/Presunutá prax" };
    expect(resumeFound("found", profile, undefined, true)).toEqual({ missing: "/x/Presunutá prax" });
    const { foundText } = await import("../src/lawoss/domains/onboarding/found-text");
    expect(foundText("sk")("resumeFolderMissing", { name: "Presunutá prax" })).toBe("Priečinok „Presunutá prax“ z prerušeného nastavenia sa nenašiel (možno bol presunutý alebo premenovaný). Vyberte ho znova.");
    for (const locale of ["cs", "en", "de"] as const) expect(foundText(locale)("resumeFolderMissing", { name: "Presunutá prax" })).toContain("Presunutá prax");
    // Sprievodca (C1) volá resumeFound cez wizardResume; zmiznutý priečinok vedie na Dokumenty aj z krokov 4–6.
    const flow = (await import("node:fs")).readFileSync(new URL("../src/lawoss/domains/onboarding/wizard/wizard-flow.ts", import.meta.url), "utf8");
    expect(flow).toContain("resumeFound(opening, profile, initialRoot, input.foundRootMissing)");
  });

  test("dokončenie zmaže priečinok obnovy aj pri už dokončenom profile", async () => {
    const calls: unknown[] = [];
    const api = { updateOnboardingProfile: async (patch: Partial<OnboardingProfile> | { foundRoot: null }) => { calls.push(patch); return base; } };
    const now = new Date("2026-10-22T10:00:00.000Z");
    await markOnboardingCompleted(api, { ...base, foundRoot: "/x" }, now);
    await markOnboardingCompleted(api, { ...base, completedAt: "2026-10-01T00:00:00.000Z", foundRoot: "/x" }, now);
    expect(calls).toEqual([{ completedAt: "2026-10-22T10:00:00.000Z", foundRoot: null }, { foundRoot: null }]);
  });

  test("zlyhaný zápis značky nezablokuje dokončenie", async () => {
    const api = { updateOnboardingProfile: async () => { throw new Error("invalid_scope"); } };
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(await markOnboardingCompleted(api, base)).toBe(base);
    } finally {
      console.warn = warn;
    }
  });

  test("karta: výzva a tlačidlo vedú do sprievodcu, nič neblokujú", () => {
    const html = renderToStaticMarkup(<MemoryRouter><OnboardingResumeCardView locale="sk" /></MemoryRouter>);
    expect(html).toContain("Dokončite nastavenie praxe");
    expect(html).toContain('href="/welcome"');
    expect(html).toContain("Pokračovať v nastavení");
    expect(html).not.toContain('role="alert"');
    const cs = renderToStaticMarkup(<MemoryRouter><OnboardingResumeCardView locale="cs" /></MemoryRouter>);
    expect(cs).toContain("Dokončete nastavení praxe");
    expect(cs).toContain("Pokračovat v nastavení");
  });

  test("karta sa ukáže aj pri pracovnom priečinku bez vecí", () => {
    const html = renderToStaticMarkup(<MemoryRouter>
      <OkfPageState connection="ready" workspace="Novák" error={null} loading={false}
        data={{ matters: [], clients: [], problems: [], truncated: false } as never}
        notice={<p>KARTA</p>}>
        {() => null}
      </OkfPageState>
    </MemoryRouter>);
    expect(html).toContain("KARTA");
  });

  test("Nastavenia ponúknu Sprievodcu nastavením aj bez otvoreného priečinka", () => {
    const html = renderToStaticMarkup(<MemoryRouter><OfficeProfileView client={null} workspaceId={null} workspacePath="" workspaceName="" /></MemoryRouter>);
    expect(html).toMatch(/<button[^>]*data-lawoss-setup-wizard[^>]*>Setup wizard<\/button>/);
  });
});
