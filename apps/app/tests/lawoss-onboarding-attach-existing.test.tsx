import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Language } from "../src/i18n";
import { OnboardingEntryActions } from "../src/lawoss/domains/onboarding/entry-actions";
import { Client, parentFolderOf, trialCloneName, welcomeText } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import type { OnboardingProfile } from "../src/lawoss/domains/onboarding/api";
import { ALPHA_HIDE_MAP_WITHOUT_WRITING, visibleExistingClientModes } from "../src/lawoss/feature-flags";
import { ATTACH_EXISTING_CLIENT_PATH } from "../src/lawoss/lite/links";
import { ClientsView } from "../src/lawoss/lite/pages/clients-page";

const base: OnboardingProfile = { version: 1, lawyerName: "Testovací advokát", jurisdiction: "sk", language: "sk" };
const client = (locale: Language, initialExisting = true) =>
  renderToStaticMarkup(<Client base={base} locale={locale} tr={welcomeText(locale)} busy={false} onPlan={async () => {}} initialExisting={initialExisting} />);

describe("connecting an existing client folder", () => {
  test("opens the client step directly in the attach mode with the trial clone preselected", () => {
    expect(ATTACH_EXISTING_CLIENT_PATH).toBe("/welcome?continue=existing");
    const html = client("sk");
    expect(html).toContain("Pripojiť existujúci priečinok klienta");
    expect(html).toContain("Čo sa stane s pôvodným priečinkom");
    expect(html).toMatch(/<input type="radio"[^>]*checked=""[^>]*value="trial_clone"\/>/);
    expect(html).not.toMatch(/<input type="radio"[^>]*checked=""[^>]*value="convert"\/>/);
    expect(html).toContain("Originál ostane nedotknutý");
    expect(html).toContain("LAWOSS zapíše priamo do pôvodného priečinka");
    expect(html).toContain("Kam uložiť kópiu");
  });

  test("hides the map mode in the alpha with one switch", () => {
    expect(ALPHA_HIDE_MAP_WITHOUT_WRITING).toBe(true);
    expect(visibleExistingClientModes(["trial_clone", "convert", "map"])).toEqual(["trial_clone", "convert"]);
    const html = client("sk");
    expect(html).not.toContain('value="map"');
    expect(html).not.toContain("Mapovať bez zápisu");
  });

  test("every UI language explains what happens to the original", () => {
    expect(client("cs")).toContain("Připojit existující složku klienta");
    expect(client("cs")).toContain("Originál zůstane nedotčený");
    expect(client("en")).toContain("The original stays untouched");
    expect(client("de")).toContain("Das Original bleibt unberührt");
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      const tr = welcomeText(locale);
      for (const key of ["attachTitle", "original", "modeQuestion", "trial_cloneHelp", "convertHelp", "convertConfirm", "cloneParent", "cloneTarget", "trialPreview"]) {
        expect({ locale, key, value: typeof tr(key) }).toEqual({ locale, key, value: "string" });
      }
    }
  });

  test("a new client keeps its own form", () => {
    const html = client("sk", false);
    expect(html).toContain("Prvý klient");
    expect(html).not.toContain('type="radio"');
  });

  test("the copy is placed next to the original by default and named like the server names it", () => {
    expect(parentFolderOf("/Users/test/Klienti/ACME s. r. o.")).toBe("/Users/test/Klienti");
    expect(parentFolderOf("/Users/test/Klienti/ACME/")).toBe("/Users/test/Klienti");
    expect(parentFolderOf("C:\\Klienti\\ACME")).toBe("C:\\Klienti");
    expect(trialCloneName("/Users/test/Klienti/ACME", "2026-10-05")).toBe("ACME (trial 2026-10-05)");
  });

  test("the sidebar icon and the settings button carry the full name", () => {
    const html = renderToStaticMarkup(<MemoryRouter><OnboardingEntryActions compact okfOffered={false} /></MemoryRouter>);
    expect(html).toContain('aria-label="Connect an existing client folder"');
    expect(html).toContain('title="Connect an existing client folder"');
    expect(renderToStaticMarkup(<MemoryRouter><OnboardingEntryActions okfOffered={false} /></MemoryRouter>)).toContain("<span>Connect an existing client folder</span>");
  });

  test("Klienti offers the attach button next to New matter", () => {
    const html = renderToStaticMarkup(<MemoryRouter><ClientsView groups={[]} locale="sk" /></MemoryRouter>);
    expect(html).toContain('href="/welcome?continue=existing"');
    expect(html).toContain("Pripojiť existujúci priečinok klienta");
    expect(html).toContain("+ Nová vec");
  });
});
