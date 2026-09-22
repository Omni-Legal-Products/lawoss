import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { currentLanguagePreference, setLanguagePreference, setLocale, t } from "../src/i18n";
import { setupEn, setupCs, setupSk, setupDe } from "../src/lawoss/i18n/setup";
import { LawossWelcomePage } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import { NovySpisPanel, PlanGroup } from "../src/lawoss/domains/novy-spis/novy-spis-page";
import { composePrompt, targetDir, type NovySpisForm } from "../src/lawoss/okf/compose-prompt";
import { previewPlan } from "../src/lawoss/okf/preview";
import { groupPlan } from "../src/lawoss/okf/plan-groups";
import { loadProfilePreview } from "../src/lawoss/okf/load-profile";
import { readOfficeProfile, updateOfficeProfile } from "../src/lawoss/okf/office-profile";

const form: NovySpisForm = {
  mode: "okf", subject: "spis", title: "Původní název / pôvodné meno", ico: "12345678", root: "/office/Client/Spisy",
  jurisdikcia: "CZ", country: "CZ", identifierType: "ICO", protistrana: "Protistrana pôvodná",
  matterKind: "advisory", matterMode: "ongoing", clientName: "Původní klient", advokat: "Test Advokát",
};

// SSR uses the hook's English snapshot. Root browser checks cover an actual
// mounted wizard with dirty values and a fetched plan through language changes.
test("welcome exposes pre-workspace language choice and localized onboarding content", () => {
  let calls = 0;
  const html = renderToStaticMarkup(<MemoryRouter><LawossWelcomePage onGetStarted={() => { calls++; }} analyticsEnabled={false} onAnalyticsChange={() => { calls++; }} /></MemoryRouter>);
  expect(html).toContain("data-lawoss-language-switcher");
  expect(html).toContain("Let’s prepare LAWOSS for your work");
  expect(html).toContain("Recommended setup");
  expect(html).toContain("Compare two documents");
  expect(html).not.toContain("lawoss.setup.");
  expect(html).not.toContain("Pripravme LAWOSS");
  expect(calls).toBe(0);
});

test("native wizard uses translated UI while keeping jurisdiction values and raw prompt", () => {
  const html = renderToStaticMarkup(<NovySpisPanel documentAuthor="Test Advokát" connection={{ client: null, baseUrl: "", token: "" }} workspace={{ id: "test-office", name: "Pôvodný workspace", path: "/office", workspaceType: "local" }} onOpenSession={() => { throw new Error("SSR must not open a draft"); }} />);
  expect(html).toContain("Matter using OKF");
  expect(html).toContain("Legal entity");
  expect(html).toContain('value="pravnicka-osoba"');
  expect(html).toContain("Slovakia");
  expect(html).toContain("Czechia");
  expect(html).toContain("Pôvodný workspace");
  expect(html).toContain("Test Advokát");
  expect(html).toContain("Show plan");
  expect(html).toContain("Prepare conversation draft");
  expect(html).not.toContain("lawoss.setup.");
  expect(html).toContain('class="lw-pre"');
});

test("plan groups translate presentation metadata and preserve actual filenames and titles", () => {
  const rows = previewPlan(form, (path) => path === "matter.md");
  const groups = groupPlan(rows, { form, workspacePath: "/office" });
  const before = JSON.stringify(groups);
  const html = renderToStaticMarkup(<><PlanGroup title="Existing" empty="none" items={groups.zostava} /><PlanGroup title="Attention" empty="none" items={groups.pozornost} /></>);
  expect(html).toContain("already exists; the plan does not overwrite it");
  expect(html).toContain("matter.md");
  expect(html).toContain(form.title);
  expect(html).toContain("adjusted to a single path segment");
  expect(html).not.toContain("názov priečinka sa líši");
  expect(JSON.stringify(groups)).toBe(before);
});

test("switching UI language leaves prompt, planned artifact bytes and persisted profile unchanged", async () => {
  const previous = currentLanguagePreference();
  const profileText = 'custom_setting: "původní hodnota"\nmatter_folders: ["MojeDrafty"]\nfolder_roles:\n  drafts: "MojeDrafty"\ndocument_naming: "{date}_{description}"\nclient_path: "Klienti/*"\n';
  const stored = readOfficeProfile(profileText);
  const baselineRows = previewPlan(form, () => false, stored.profile);
  const beforeForm = JSON.stringify(form);
  const expectedPrompt = composePrompt(form, { source: "Predvolený profil", warning: "Kancelársky profil sa vo workspace nenašiel. Agent ešte preverí nadradený Office pri finálnom CLI pláne.", paths: baselineRows.map((row) => row.path) });
  const expectedProfile = updateOfficeProfile(profileText, stored);
  try {
    for (const language of ["cs", "en", "sk", "de"] as const) {
      setLocale(language);
      const profile = await loadProfilePreview({
        statWorkspaceFile: async (_id, path) => ({ ok: true, path, exists: false }),
        readWorkspaceFile: async () => { throw new Error("Absent files must not be read"); },
      }, "test", "Client/Spisy/Vec", true);
      expect(profile.source).toBe("Predvolený profil");
      expect(profile.sourceKey).toBe("lawoss.integrations.profile.default");
      expect(previewPlan(form, () => false, stored.profile)).toEqual(baselineRows);
      expect(composePrompt(form, { source: profile.source, warning: profile.warning, paths: baselineRows.map((row) => row.path) })).toBe(expectedPrompt);
      expect(updateOfficeProfile(profileText, stored)).toBe(expectedProfile);
      expect(targetDir(form)).toBe("/office/Client/Spisy/Původní název - pôvodné meno");
    }
  } finally { setLanguagePreference(previous); }
  expect(JSON.stringify(form)).toBe(beforeForm);
});

test("setup translations have complete matching placeholders and genuine Czech/Slovak labels", () => {
  const tokens = (value: string) => (value.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
  for (const locale of [setupCs, setupSk, setupDe]) {
    expect(Object.keys(locale).sort()).toEqual(Object.keys(setupEn).sort());
    const translated: Record<string, string> = locale;
    for (const [key, value] of Object.entries(setupEn)) expect(tokens(translated[key])).toEqual(tokens(value));
  }
  expect(t("lawoss.setup.wizard.showPlan", "cs")).toBe("Zobrazit plán");
  expect(t("lawoss.setup.wizard.showPlan", "sk")).toBe("Zobraziť plán");
  expect(t("lawoss.setup.wizard.showPlan", "en")).toBe("Show plan");
  expect(t("lawoss.setup.wizard.showPlan", "de")).toBe("Plan anzeigen");
});
