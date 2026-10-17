import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readWorkspaceImports, type ImportedPlugin } from "../src/app/lib/extension-imports";
import { ImportedPackageContents } from "../src/react-app/domains/settings/pages/plugin-package-contents";

const plugin: ImportedPlugin = {
  pluginId: "import:claude:test", name: "Test", marketplaceId: null, description: null, updatedAt: null, importedAt: 1,
  files: [{ configObjectId: "skill", versionId: null, objectType: "skill", title: "Review", path: ".opencode/skills/test/review/SKILL.md", updatedAt: null }],
  excludedConnectors: [{ name: "Unavailable connector", message: "The provider only accepts approved applications." }],
};

test("excluded connectors persist through import parsing and appear as explanations rather than broken clickable components", () => {
  const parsed = readWorkspaceImports({ cloudImports: { plugins: { [plugin.pluginId]: plugin } } }).plugins[plugin.pluginId];
  expect(parsed.excludedConnectors).toEqual(plugin.excludedConnectors);
  const html = renderToStaticMarkup(<ImportedPackageContents plugin={parsed} onOpen={() => {}} />);
  expect(html).toContain("Connectors not imported");
  expect(html).toContain("Unavailable connector");
  expect(html).toContain("only accepts approved applications");
  expect(html.match(/<button\b/g)).toHaveLength(1);
  expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>)[\s\S])*Unavailable connector/);
});

test("search can find an excluded connector or its reason without reporting that no matching component exists", () => {
  for (const query of ["Unavailable", "approved"]) {
    const html = renderToStaticMarkup(<ImportedPackageContents plugin={plugin} query={query} onOpen={() => {}} />);
    expect(html).toContain("Unavailable connector");
    expect(html).not.toContain("No matches");
    expect(html).not.toContain("<button");
  }
});
