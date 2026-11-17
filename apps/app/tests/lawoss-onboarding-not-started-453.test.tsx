import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { OnboardingProfile } from "../src/lawoss/domains/onboarding/api";
import { onboardingNotStarted } from "../src/lawoss/domains/onboarding/resume";
import { OnboardingResumeCardView } from "../src/lawoss/domains/onboarding/resume-card";
import { OkfPageState } from "../src/lawoss/domains/okf-page";

const home = { path: "/Users/test/Library/Application Support/LAWOSS/lawoss-domov" };
const profile: OnboardingProfile = { version: 1, lawyerName: "Mgr. Test", jurisdiction: "sk", language: "sk" };

describe("#453: sprievodca opustený pred uložením profilu", () => {
  test("bez profilu a len s interným domovom: karta návratu sa ukáže", () => {
    expect(onboardingNotStarted(null, [home])).toBe(true);
    expect(onboardingNotStarted(null, [])).toBe(true);
  });

  test("nenačítaný profil kartu neukáže (nič netvrdí počas čítania)", () => {
    expect(onboardingNotStarted(undefined, [home])).toBe(false);
  });

  test("skutočný priečinok alebo uložený profil: o karte rozhoduje onboardingIncomplete, nie táto poistka", () => {
    expect(onboardingNotStarted(null, [home, { path: "/Prax/Klienti/Novak" }])).toBe(false);
    expect(onboardingNotStarted(profile, [home])).toBe(false);
  });

  test("karta sa ukáže aj nad stavom „organizácia prípadov je vypnutá“", () => {
    const html = renderToStaticMarkup(<MemoryRouter>
      <OkfPageState connection="ready" workspace="lawoss-domov" error={null} data={undefined} loading={false} okfOff
        notice={<OnboardingResumeCardView locale="sk" />}>{() => null}</OkfPageState>
    </MemoryRouter>);
    expect(html).toContain("data-lawoss-onboarding-resume");
    expect(html).toContain('href="/welcome"');
  });
});
