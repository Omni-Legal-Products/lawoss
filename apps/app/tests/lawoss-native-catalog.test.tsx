import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NativeCatalog } from "../src/lawoss/domains/marketplace/native-catalog";

const props = {
  workspaceId: "selected", workspaceName: "Selected matter", busy: false, loading: false,
  error: null, plugins: [], skills: [], canInstallPlugin: false, canInstallSkills: false,
  installPlugin: async () => ({ ok: true, message: "installed" }),
  installOkf: async () => ({ ok: true, message: "installed" }), refresh: async () => {},
  previewPlugin: async () => ({ pluginId: "p", name: "P", description: null, version: null,
    source: { owner: "owner", repo: "repo", ref: "commit", dir: null }, components: [], warnings: [] }),
};

describe("native catalog rendering", () => {
  test("existing OKF skills show the limited confirmed fact, not verified resources or connected MCP", () => {
    const html = renderToStaticMarkup(<NativeCatalog {...props} skills={[{ name: "novy-spis", path: "a" }, { name: "okf-pamat", path: "b" }, { name: "usporiadaj-spis", path: "c" }]} />);
    expect(html).toContain("Skilly uložené");
    expect(html).toContain("Potvrdiť aktualizáciu balíka");
    expect(html).not.toContain("MCP pripojené");
    expect(html).toContain("Tento import zatiaľ nepodporuje globálnu inštaláciu");
    expect(html).toContain("Selected matter");
  });
  test("partial OKF pack does not report all three installed and readonly actions stay disabled", () => {
    const html = renderToStaticMarkup(<NativeCatalog {...props} skills={[{ name: "novy-spis", path: "a" }, { name: "okf-pamat", path: "b" }]} />);
    expect(html).not.toContain("Skilly uložené");
    expect(html.match(/ disabled=""/g)?.length).toBe(3);
  });
  test("failed registry refresh does not present a cached import as a current installed badge", () => {
    const html = renderToStaticMarkup(<NativeCatalog {...props} error={new Error("registry offline")} plugins={[{
      pluginId: "github:Omni-Legal-Products/lawoss-marketplace#plugins/orsr", name: "ORSR", marketplaceId: null,
      description: null, updatedAt: null, files: [], importedAt: null,
    }]} />);
    expect(html).toContain("registry offline");
    expect(html).not.toContain(">Nainštalované<");
  });
});
