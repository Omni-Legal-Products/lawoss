import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFrontmatter } from "../../../lawoss/okf/src/core";
import { LOCALIZED_TEMPLATES } from "../../../lawoss/okf/src/templates";
import { composePrompt, documentLanguageForLocale, type NovySpisForm } from "../src/lawoss/okf/compose-prompt";
import { previewPlan, probePlanFiles } from "../src/lawoss/okf/preview";
import { loadProfilePreview } from "../src/lawoss/okf/load-profile";
import { LOCALIZED_OKF_TEMPLATES } from "../src/lawoss/okf/templates";
import { isCurrentCreationPlan, NovySpisPanel } from "../src/lawoss/domains/novy-spis/novy-spis-page";

const form: NovySpisForm = { mode: "okf", subject: "spis", title: "Původní název klienta", root: "/office/Client/Spisy", ico: "", jurisdikcia: "SK", protistrana: "Pôvodné označenie", matterKind: "dispute", matterMode: "bounded", documentLanguage: "cs" };

test("UI document language is explicit and independent of the selected jurisdiction", () => {
  for (const locale of ["cs", "sk", "en", "de"] as const) {
    const language = documentLanguageForLocale(locale);
    expect(language).toBe(locale === "de" ? "en" : locale);
    for (const jurisdiction of ["SK", "CZ"] as const) {
      const input = { ...form, documentLanguage: language, jurisdikcia: jurisdiction };
      const prompt = composePrompt(input);
      expect(prompt).toContain(`--${jurisdiction.toLowerCase()} --language ${language}`);
      const entries = previewPlan(input);
      const card = entries.find(entry => entry.path === "matter.md")?.content;
      expect(card).toBeDefined();
      const frontmatter = parseFrontmatter(card!);
      expect(frontmatter?.language).toBe(language);
      expect(frontmatter?.jurisdiction).toBe(jurisdiction.toLowerCase());
      expect(frontmatter?.title).toBe(form.title);
      const drafts = language === "cs" ? "03_Navrhy/.keep" : language === "en" ? "03_Drafts/.keep" : "03_Drafty/.keep";
      expect(entries.some(entry => entry.path === drafts)).toBe(true);
      expect(card).toContain(form.protistrana);
      expect(entries.find(entry => entry.path === "CLAUDE.md")?.content).toBe(entries.find(entry => entry.path === "AGENTS.md")?.content);
    }
  }
});

test("app preview and CLI bundle share every localized template byte", () => {
  expect(LOCALIZED_OKF_TEMPLATES).toEqual(LOCALIZED_TEMPLATES);
  const contents = ["cs", "sk", "en"].map(language => {
    const documentLanguage = language === "cs" ? "cs" : language === "sk" ? "sk" : "en";
    return previewPlan({ ...form, documentLanguage }).find(entry => entry.path === "matter.md")?.content;
  });
  expect(new Set(contents).size).toBe(3);
});

test("changing document language invalidates the previously confirmed plan while preserving its matter data", () => {
  const shown = { dir: "/office/Client/Spisy/Původní název klienta", formKey: JSON.stringify(form) };
  expect(isCurrentCreationPlan(shown, form)).toBe(true);
  for (const documentLanguage of ["sk", "en"] as const) {
    const next = { ...form, documentLanguage };
    expect(isCurrentCreationPlan(shown, next)).toBe(false);
    expect(next.jurisdikcia).toBe("SK");
    expect(next.title).toBe(form.title);
    expect(next.protistrana).toBe(form.protistrana);
  }
  expect(isCurrentCreationPlan(shown, { ...form, jurisdikcia: "CZ" })).toBe(false);
});

test("choosing a new document language preserves existing files and only probes their exact paths", async () => {
  const observed: string[] = [];
  const client = { statWorkspaceFile: async (_workspace: string, path: string) => {
    observed.push(path);
    return { ok: true, path, exists: path.endsWith("/matter.md") || path.endsWith("/AGENTS.md") };
  } };
  const names = await probePlanFiles(client, "workspace", "Client/Spisy/Původní název klienta", { ...form, documentLanguage: "en" });
  expect(names).toContain("matter.md");
  expect(names).toContain("AGENTS.md");
  const entries = previewPlan({ ...form, documentLanguage: "en" }, path => names.includes(path));
  for (const path of ["matter.md", "AGENTS.md"]) {
    const entry = entries.find(item => item.path === path);
    expect(entry?.action).toBe("skip");
    expect(entry?.content).toBeUndefined();
  }
  expect(observed.every(path => path.startsWith("Client/Spisy/Původní název klienta/"))).toBe(true);
});

test("wizard displays generated-document language and passes it separately from default Slovak jurisdiction", () => {
  const html = renderToStaticMarkup(<NovySpisPanel connection={{ client: null, baseUrl: "", token: "" }} workspace={{ id: "office", name: "Office", path: "/office", workspaceType: "local" }} onOpenSession={() => { throw new Error("Rendering cannot open a session"); }} />);
  // The existing locale hook uses an English SSR snapshot.
  expect(html).toContain('data-lawoss-document-language="en"');
  expect(html).toContain("Language of new documents");
  expect(html).toContain("English documents");
  expect(html).toContain("--sk --language en");
  expect(html).not.toContain("lawoss.setup.wizard.documentLanguage");
});


test("partial office config inherits the selected language defaults and preserves explicit folders", async () => {
  const makeClient = (content: string) => ({
    statWorkspaceFile: async (_workspace: string, path: string) => ({ ok: true, path, exists: path === "Office" || path === "Office/okf.config" }),
    readWorkspaceFile: async () => ({ ok: true, path: "Office/okf.config", content }),
  });
  const czech = await loadProfilePreview(makeClient('document_naming: "{date}_{description}"\n'), "office", "Client/Spisy/Vec", true, "cs");
  const english = await loadProfilePreview(makeClient('document_naming: "{date}_{description}"\n'), "office", "Client/Spisy/Vec", true, "en");
  expect(czech.profile?.folders).toContain("03_Navrhy");
  expect(english.profile?.folders).toContain("03_Drafts");
  expect(czech.profile?.naming).toBe("{date}_{description}");
  const explicit = await loadProfilePreview(makeClient('matter_folders: ["Pôvodné_drafty"]\nfolder_roles:\n  drafts: "Pôvodné_drafty"\n'), "office", "Client/Spisy/Vec", true, "cs");
  expect(explicit.profile?.folders).toEqual(["Pôvodné_drafty"]);
  expect(explicit.profile?.roles.drafts).toBe("Pôvodné_drafty");
});
