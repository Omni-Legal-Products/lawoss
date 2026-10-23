import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { onboardingErrorMessage, onboardingRefusalAction } from "../src/lawoss/domains/onboarding/onboarding-errors";
import { workspaceProjectRoute } from "../src/react-app/shell/workspace-routes";

// Chyby onboardingu zapisujú surovú správu do konzoly; v teste je to len šum.
let quiet: ReturnType<typeof spyOn>;
beforeEach(() => { quiet = spyOn(console, "warn").mockImplementation(() => undefined); });
afterEach(() => { quiet.mockRestore(); });

/** Tvar chyby klienta servera (`LegalworkServerError`): kód a `details` z odpovede servera. */
const serverError = (code: string, details: unknown) => Object.assign(new Error("This folder belongs to another client. A client cannot be inside another client. Nothing was changed."), { status: 409, code, details });
const nested = serverError("onboarding_client_nested", { workspaceId: "ws_c002", name: "SYN Beta, a. s." });
const contains = serverError("onboarding_client_contains_clients", { clients: [{ workspaceId: "ws_c001", name: "SYN Alfa" }, { workspaceId: "ws_c002", name: "SYN Beta, a. s." }] });
const LOCALES = ["sk", "cs", "en", "de"] as const;

describe("klient vnútri iného klienta (N-A3-1)", () => {
  test("odmietnutie vysvetlí, komu priečinok patrí, a ponúkne otvoriť toho klienta vo všetkých jazykoch", () => {
    expect(onboardingErrorMessage(nested, "sk")).toBe("Tento priečinok patrí klientovi „SYN Beta, a. s.“. Klient nemôže byť vnútri iného klienta. Nič sa nezmenilo.");
    expect(onboardingRefusalAction(nested, "sk")).toEqual({ workspaceId: "ws_c002", label: "Otvoriť v klientovi SYN Beta, a. s." });
    expect(onboardingRefusalAction(nested, "cs")?.label).toBe("Otevřít u klienta SYN Beta, a. s.");
    expect(onboardingRefusalAction(nested, "en")?.label).toBe("Open in client SYN Beta, a. s.");
    expect(onboardingRefusalAction(nested, "de")?.label).toBe("Beim Mandanten SYN Beta, a. s. öffnen");
    const generic = onboardingErrorMessage(new Error("x"), "sk");
    for (const locale of LOCALES) {
      const message = onboardingErrorMessage(nested, locale);
      expect(message).toContain("SYN Beta, a. s.");
      expect(message).not.toBe(onboardingErrorMessage(new Error("x"), locale));
      expect(message).not.toMatch(/409|workspace|LegalWork|ws_c002/i);
    }
    expect(generic).toContain("Niečo sa nepodarilo");
  });

  test("priečinok s klientmi sa odmietne s menami klientov a bez ponuky otvoriť jedného z nich", () => {
    expect(onboardingErrorMessage(contains, "sk")).toBe("Tento priečinok obsahuje priečinky iných klientov (SYN Alfa, SYN Beta, a. s.). Vyberte priečinok jedného klienta. Nič sa nezmenilo.");
    for (const locale of LOCALES) {
      expect(onboardingErrorMessage(contains, locale)).toContain("SYN Alfa, SYN Beta, a. s.");
      expect(onboardingRefusalAction(contains, locale)).toBeUndefined();
    }
  });

  test("iná chyba alebo neúplné údaje servera ponuku nedostanú", () => {
    expect(onboardingRefusalAction(new Error("x"), "sk")).toBeUndefined();
    expect(onboardingRefusalAction(serverError("onboarding_client_nested", { name: "Bez id" }), "sk")).toBeUndefined();
    expect(onboardingRefusalAction(serverError("folder_missing", { workspaceId: "ws", name: "x" }), "sk")).toBeUndefined();
  });

  test("tlačidlo pri chybe otvorí prehľad toho klienta", () => {
    const page = readFileSync(join(import.meta.dir, "../src/lawoss/domains/onboarding/lawoss-welcome-page.tsx"), "utf8");
    expect(page).toContain("navigate(workspaceProjectRoute(errorAction.workspaceId))");
    expect(workspaceProjectRoute("ws_c002")).toBe("/workspace/ws_c002/project");
  });
});
