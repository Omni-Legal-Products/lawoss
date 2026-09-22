import { afterEach, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { currentLanguagePreference, setLanguagePreference, setLocale, t } from "../src/i18n";
import { integrationsEn, integrationsCs, integrationsSk, integrationsDe } from "../src/lawoss/i18n/integrations";
import { getMarketplaceCatalog, MARKETPLACE_CATALOG } from "../src/lawoss/domains/marketplace/catalog";
import { MemoryProfileEditor } from "../src/lawoss/domains/integrations/file-memory-integration-card";
import { OfficeProfileEditor } from "../src/lawoss/domains/settings/office-profile-view";
import { emptyMemoryProfile, previewMemoryProfile } from "../src/lawoss/okf/workspace-memory-profile";
import { workingProfile } from "../../../lawoss/okf/src/profile";
import { loadProfilePreview } from "../src/lawoss/okf/load-profile";
import { buildMcpConfigExport } from "../src/lawoss/okf/mcp-config-export";
import { initialMcpConfigExportDialogState, mcpConfigExportApprovalIsCurrent, mcpConfigExportDialogReducer, mcpConfigExportSelectionKey, runMcpConfigExportDownload } from "../src/lawoss/domains/integrations/mcp-config-export";

const previousLanguage = currentLanguagePreference();
afterEach(() => setLanguagePreference(previousLanguage));
const languages = ["sk", "cs", "en", "de"] as const;

test("integration dictionaries cover the same messages and preserve all placeholders", () => {
  const dictionaries = [integrationsCs, integrationsSk, integrationsDe];
  const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const dict of dictionaries) {
    expect(Object.keys(dict).sort()).toEqual(Object.keys(integrationsEn).sort());
    for (const [key, english] of Object.entries(integrationsEn)) {
      expect(placeholders(Reflect.get(dict, key))).toEqual(placeholders(english));
    }
  }
});

test("switching catalog language changes copy while pinned sources and installation identities stay exact", () => {
  const expected = ["Obchodný register SR", "Obchodní rejstřík SR", "Slovak Business Register", "Slowakisches Handelsregister"];
  languages.forEach((locale, index) => {
    setLocale(locale);
    const catalog = getMarketplaceCatalog();
    expect(catalog.find(entry => entry.id === "orsr")?.name).toBe(expected[index]);
    expect(catalog.find(entry => entry.id === "okf")?.description).toBe(t("lawoss.integrations.catalog.okf_description", locale));
    for (const entry of catalog) {
      const original = MARKETPLACE_CATALOG.find(item => item.id === entry.id)!;
      expect(entry.install).toEqual(original.install);
      expect(entry.source.repository).toBe(original.source.repository);
      if (entry.install.action === "plugin") expect(entry.source.ref).toBe(original.source.ref);
      expect(entry.jurisdictions).toEqual(original.jurisdictions);
    }
  });
});

test("language switching retains MCP confirmation identity and exactly the same selected export bytes", () => {
  const entries = [{ name: "Pracovní konektor", source: "config.project" as const, disabledByTools: true, config: { type: "local", command: ["tool", "--original-argument"], environment: { RAW_VALUE: "Původní hodnota" } } }];
  let state = mcpConfigExportDialogReducer(initialMcpConfigExportDialogState, { type: "open" });
  state = mcpConfigExportDialogReducer(state, { type: "toggle", name: entries[0].name });
  state = mcpConfigExportDialogReducer(state, { type: "confirm", value: true, approval: { entries, workspaceIdentity: "Původní spis", selectionKey: mcpConfigExportSelectionKey(state.selectedNames) } });
  const json = buildMcpConfigExport(entries, state.selectedNames).json;
  for (const locale of languages) {
    setLocale(locale);
    expect(mcpConfigExportApprovalIsCurrent(state, entries, "Původní spis")).toBe(true);
    let downloaded = "";
    runMcpConfigExportDownload({ state, entries, workspaceIdentity: "Původní spis", filename: "original-mcp.json", download: file => { downloaded = file.content; } });
    expect(downloaded).toBe(json);
    expect(JSON.parse(downloaded).mcp[entries[0].name].enabled).toBe(false);
  }
  expect(mcpConfigExportApprovalIsCurrent(state, entries, "Jiný spis")).toBe(false);
});

test("rendered memory and office controls localize labels while role values, paths, naming tokens and JSON remain exact", () => {
  const unused = async (): Promise<never> => { throw new Error("Rendering must not read or write workspace files"); };
  const profile = { ...emptyMemoryProfile(), matterId: "CASE-ORIGINAL", sources: [{ id: "memory", root: "matter", path: "Původní složka/_memory.md", role: "case_memory" as const, required: true, writable: true, anchors: ["CASE-ORIGINAL"] }] };
  const original = previewMemoryProfile(profile);
  const html = renderToStaticMarkup(<MemoryRouter><MemoryProfileEditor client={{ statWorkspaceFile: unused, readWorkspaceFile: unused, writeWorkspaceFile: unused, getWorkspaceMemoryStatus: unused, capabilities: unused }} workspaceId="case" initial={{ content: original, profile }} writable onReload={() => {}} /></MemoryRouter>);
  // The shared useLocale SSR snapshot is English; live switching is exercised by the browser smoke test.
  expect(html).toContain("Matter identity");
  expect(html).toContain('value="case_memory" selected=""');
  expect(html).toContain('value="Původní složka/_memory.md"');
  expect(html).toContain("Save mapping");
  expect(html).not.toContain("lawoss.integrations.");
  expect(previewMemoryProfile(profile)).toBe(original);
  const office = renderToStaticMarkup(<OfficeProfileEditor client={{ statWorkspaceFile: unused, readWorkspaceFile: unused, writeWorkspaceFile: unused }} workspaceId="office" initial={{ path: "Office/okf.config", content: null, value: { profile: workingProfile(), clientPath: "Původní klienti/*" } }} writable onReload={() => {}} />);
  expect(office).toContain("Name pattern for new documents");
  expect(office).toContain("{date} = date");
  expect(office).toContain('value="Původní klienti/*"');
  expect(office).not.toContain("lawoss.integrations.");
});

test("profile preview exposes reactive display keys without translating the source and warning used in agent prompts", async () => {
  const client = { statWorkspaceFile: async () => ({ exists: false, kind: null, size: null, modifiedAt: null }), readWorkspaceFile: async () => { throw new Error("No profile exists"); } };
  let baseline: Awaited<ReturnType<typeof loadProfilePreview>> | undefined;
  for (const locale of languages) {
    setLocale(locale);
    const result = await loadProfilePreview(client, "office", "", true);
    expect(result.sourceKey).toBe("lawoss.integrations.profile.default");
    expect(result.warningKey).toBe("lawoss.integrations.profile.office_missing");
    if (baseline) expect(result).toEqual(baseline);
    baseline = result;
  }
});
