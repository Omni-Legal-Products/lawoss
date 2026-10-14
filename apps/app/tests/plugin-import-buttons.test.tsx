import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ExtensionsView, type ExtensionsViewProps } from "../src/react-app/domains/settings/pages/extensions-view";

const noop = () => {};
const props: ExtensionsViewProps = {
  busy: false, developerMode: false, selectedWorkspaceRoot: "/project", isRemoteWorkspace: false, canEditPlugins: true, canUseGlobalScope: true, suggestedPlugins: [], mcpConnectedAppsCount: 0, mcpView: <p>Connectors</p>, skillsView: <p>Skills</p>, onRefresh: noop,
  pluginImports: { discoverPluginImports: async () => [], previewPluginImports: async () => [], installPluginImport: async () => { throw new Error("not invoked"); }, refreshPluginImport: async () => {} },
  extensions: { pluginScope: "project", setPluginScope: noop, refreshPlugins: noop, pluginConfigPath: () => null, pluginConfig: () => null, pluginList: () => [], pluginInput: () => "", setPluginInput: noop, pluginStatus: () => null, addPlugin: noop, removePlugin: noop, isPluginInstalledByName: () => false, activePluginGuide: () => null, setActivePluginGuide: noop },
};
test("plugin imports are available on Extensions without enabling developer mode", () => {
  const html = renderToStaticMarkup(<ExtensionsView {...props} />);
  const importButtons = html.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?>Import<\/button>/g) ?? [];
  expect(importButtons).toHaveLength(1);
  expect(importButtons[0]).not.toMatch(/^<button\b[^>]*\sdisabled(?:=|[\s>])/);
  expect(html).not.toContain("Import from ChatGPT");
  expect(html).not.toContain("Import from Claude");
  expect(html).not.toContain("Engine plugins");
});
test("read-only clients keep visible but disabled import actions", () => {
  const html = renderToStaticMarkup(<ExtensionsView {...props} canEditPlugins={false} />);
  const importButtons = html.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?>Import<\/button>/g) ?? [];
  expect(importButtons).toHaveLength(1);
  for (const button of importButtons) expect(button).toMatch(/^<button\b[^>]*\sdisabled(?:=|[\s>])/);
});

test("Browse directory is a single global action before Import on every category, including read-only clients", () => {
  const sections: ExtensionsViewProps["initialSection"][] = ["plugins", "mcp", "skills", "storage"];
  for (const initialSection of sections) {
    for (const canEditPlugins of [true, false]) {
      const html = renderToStaticMarkup(<ExtensionsView {...props} initialSection={initialSection} canEditPlugins={canEditPlugins} />);
      const buttons = html.match(/<button\b[^>]*>Browse directory<\/button>/g) ?? [];
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).not.toMatch(/^<button\b[^>]*\sdisabled(?:=|[\s>])/);
      expect(html.indexOf("Browse directory")).toBeLessThan(html.indexOf(">Import</button>"));
    }
  }
  const busy = renderToStaticMarkup(<ExtensionsView {...props} busy />);
  expect(busy).toMatch(/<button\b[^>]*\sdisabled=""[^>]*>Browse directory<\/button>/);
});

test("the public Plugins route selects the bundle tab in normal and developer modes", () => {
  for (const developerMode of [false, true]) {
    const html = renderToStaticMarkup(<ExtensionsView {...props} initialSection="plugins" developerMode={developerMode} />);
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>(?:(?!<\/button>)[\s\S])*Plugins<\/button>/);
    expect(html).toContain("Connectors");
    expect(html).toContain("File storage");
    expect(html).not.toContain("Engine plugins");
    expect(html).not.toContain("plugins.config_label");
  }
});

test("skill imports remain available when plugin editing is read-only, with one Import entry point", () => {
  const skillImports: ExtensionsViewProps["skillImports"] = {
    skills: () => [], scanGithubSkills: async () => ({ ref: "main", skills: [] }), previewClaudePlugin: async () => { throw new Error("not invoked"); },
    importGithubSkills: async () => ({ ok: true, message: "" }), installClaudePlugin: async () => ({ ok: true, message: "" }), importLocalSkill: noop, importLocalSkillZip: noop,
  };
  const html = renderToStaticMarkup(<ExtensionsView {...props} canEditPlugins={false} canImportSkills skillImports={skillImports} />);
  const importButtons = html.match(/<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?>Import<\/button>/g) ?? [];
  expect(importButtons).toHaveLength(1);
  expect(importButtons[0]).not.toMatch(/^<button\b[^>]*\sdisabled(?:=|[\s>])/);
});
