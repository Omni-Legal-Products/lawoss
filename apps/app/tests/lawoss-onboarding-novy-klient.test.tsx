import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Client, clientFormValid, welcomeText } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import type { OnboardingProfile } from "../src/lawoss/domains/onboarding/api";

/**
 * Nový klient sa nedal pridať: „Náhľad zmien“ ostal vypnutý aj s vyplneným názvom a priečinkom.
 * Predvolený režim pripojenia existujúceho priečinka je `trial_clone` a jeho „kam uložiť kópiu“
 * (odvodené z názvu klienta, teda prázdne) sa kontrolovalo aj pri novom klientovi.
 */
const newClient = {
  existing: false,
  value: "Testovací klient s.r.o.",
  clientParent: "/Users/advokat/Prax/Klienti",
  memoryPath: "",
  identityAnchor: "",
  cloneParent: "",
  confirmedWrite: false,
  confirmedClient: false,
};

describe("nový klient", () => {
  test("stačí názov a nadradený priečinok pri každom predvolenom režime", () => {
    for (const mode of ["trial_clone", "convert", "map"] as const) {
      expect({ mode, valid: clientFormValid({ ...newClient, mode }) }).toEqual({ mode, valid: true });
    }
  });

  test("bez názvu alebo priečinka sa náhľad nespustí", () => {
    expect(clientFormValid({ ...newClient, mode: "trial_clone", value: "  " })).toBe(false);
    expect(clientFormValid({ ...newClient, mode: "trial_clone", clientParent: "" })).toBe(false);
  });

  test("priečinok Klienti je predvyplnený z kancelárie", () => {
    const base: OnboardingProfile = {
      version: 1, lawyerName: "Testovací advokát", jurisdiction: "cz", language: "cs",
      officeRoot: "/Users/advokat/Prax/Office",
    };
    const html = renderToStaticMarkup(
      <Client base={base} locale="cs" tr={welcomeText("cs")} busy={false} onPlan={async () => {}} addingClient />,
    );
    expect(html).toContain('value="/Users/advokat/Prax/Klienti"');
  });
});

describe("pripojenie existujúceho priečinka ostáva prísne", () => {
  const existing = { ...newClient, existing: true, value: "/Users/advokat/Stare/Novák", clientParent: "" };

  test("skúšobná kópia potrebuje miesto kópie a potvrdenie klienta", () => {
    expect(clientFormValid({ ...existing, mode: "trial_clone", confirmedClient: true })).toBe(false);
    expect(clientFormValid({ ...existing, mode: "trial_clone", cloneParent: "/Users/advokat/Stare" })).toBe(false);
    expect(clientFormValid({ ...existing, mode: "trial_clone", cloneParent: "/Users/advokat/Stare", confirmedClient: true })).toBe(true);
  });

  test("zápis do originálu potrebuje obe potvrdenia", () => {
    expect(clientFormValid({ ...existing, mode: "convert", confirmedClient: true })).toBe(false);
    expect(clientFormValid({ ...existing, mode: "convert", confirmedWrite: true })).toBe(false);
    expect(clientFormValid({ ...existing, mode: "convert", confirmedWrite: true, confirmedClient: true })).toBe(true);
  });

  test("mapovanie potrebuje pamäť a kotvu, potvrdenie klienta nie", () => {
    expect(clientFormValid({ ...existing, mode: "map", memoryPath: "pamat.md" })).toBe(false);
    expect(clientFormValid({ ...existing, mode: "map", memoryPath: "pamat.md", identityAnchor: "Novák" })).toBe(true);
  });
});
