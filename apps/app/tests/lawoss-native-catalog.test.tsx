import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NativeCatalog } from "../src/lawoss/domains/marketplace/native-catalog";
import { MARKETPLACE_CATALOG } from "../src/lawoss/domains/marketplace/catalog";

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
    const html = renderToStaticMarkup(<NativeCatalog {...props} skills={[{ name: "novy-spis", path: "a" }, { name: "okf-pamat", path: "b" }, { name: "usporiadaj-spis", path: "c" }, { name: "roztried-spis", path: "d" }, { name: "vystup-dokumentu", path: "e" }]} />);
    expect(html).toContain("Skills saved");
    expect(html).toContain("Confirm package update");
    expect(html).not.toContain("MCP connected");
    expect(html).not.toContain("Resources verified");
    expect(html).toContain("This importer does not support global installation yet");
    expect(html).toContain("Selected matter");
  });
  test("partial OKF pack does not report all five installed and readonly actions stay disabled", () => {
    const html = renderToStaticMarkup(<NativeCatalog {...props} skills={[{ name: "novy-spis", path: "a" }, { name: "okf-pamat", path: "b" }, { name: "usporiadaj-spis", path: "c" }]} />);
    expect(html).not.toContain("Skills saved");
    // Potvrdenie inštalácie v každej karte katalógu a tlačidlo základného balíka.
    expect(html.match(/ disabled=""/g)?.length).toBe(MARKETPLACE_CATALOG.length + 1);
  });
  test("failed registry refresh does not present a cached import as a current installed badge", () => {
    const html = renderToStaticMarkup(<NativeCatalog {...props} error={new Error("registry offline")} plugins={[{
      pluginId: "github:Omni-Legal-Products/lawoss-marketplace#plugins/orsr", name: "ORSR", marketplaceId: null,
      description: null, updatedAt: null, files: [], importedAt: null,
    }]} />);
    expect(html).toContain("registry offline");
    expect(html).not.toContain(">Installed<");
  });
});
