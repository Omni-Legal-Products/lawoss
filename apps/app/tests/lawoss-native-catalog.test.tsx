import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NativeCatalog } from "../src/lawoss/domains/marketplace/native-catalog";
import { MARKETPLACE_CATALOG } from "../src/lawoss/domains/marketplace/catalog";
import { writeLegalworkServerSettings } from "../src/app/lib/legalwork-server";
import { loadMarketplaceApi } from "../src/lawoss/domains/marketplace/use-lawoss-marketplace";

const props = {
  workspaceId: "selected", workspaceName: "Selected matter", busy: false, loading: false,
  error: null, plugins: [], skills: [], canInstallPlugin: false, canInstallSkills: false,
  installPlugin: async () => ({ ok: true, message: "installed" }),
  installOkf: async () => ({ ok: true, message: "installed" }), refresh: async () => {}, marketplaceApi: null,
  previewPlugin: async () => ({ pluginId: "p", name: "P", description: null, version: null,
    source: { owner: "owner", repo: "repo", ref: "commit", dir: null }, components: [], warnings: [] }),
};

async function withConnection(settings: Parameters<typeof writeLegalworkServerSettings>[0], check: () => Promise<void>) {
  const windowBefore = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storageBefore = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => { values.clear(); },
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage, dispatchEvent: () => true } });
  try {
    writeLegalworkServerSettings(settings);
    await check();
  } finally {
    if (windowBefore) Object.defineProperty(globalThis, "window", windowBefore); else Reflect.deleteProperty(globalThis, "window");
    if (storageBefore) Object.defineProperty(globalThis, "localStorage", storageBefore); else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

describe("native catalog rendering", () => {
  test("collaborator connection keeps the catalog and workspace workflows without global host actions", async () => {
    await withConnection({ urlOverride: "http://127.0.0.1:18797", token: "synthetic-collaborator" }, async () => {
      const marketplaceApi = await loadMarketplaceApi();
      expect(marketplaceApi).toBeNull();
      const html = renderToStaticMarkup(<NativeCatalog {...props} marketplaceApi={marketplaceApi} canInstallPlugin canInstallSkills jurisdiction="sk" />);
      expect(html).toContain("LAWOSS Marketplace");
      expect(html).toContain('data-lawoss-target="workspace"');
      expect(html).toMatch(/<input[^>]*type="radio"[^>]*disabled=""[^>]*\/>All clients/);
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Install for all clients<\/button>/);
      expect(html).toContain("Confirm installation in folder");
    });
  });
  test("loopback host connection retains global installation", async () => {
    await withConnection({ urlOverride: "http://127.0.0.1:18797", token: "synthetic-owner", hostToken: "synthetic-host" }, async () => {
      const marketplaceApi = await loadMarketplaceApi();
      expect(marketplaceApi).not.toBeNull();
      const html = renderToStaticMarkup(<NativeCatalog {...props} marketplaceApi={marketplaceApi} jurisdiction="sk" />);
      expect(html).toContain('data-lawoss-target="global"');
      expect(html).toMatch(/<input[^>]*type="radio"[^>]*checked=""[^>]*\/>All clients/);
      expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Install for all clients<\/button>/);
    });
  });
  test("a host token stored for a non-loopback connection cannot enable global installation", async () => {
    await withConnection({ urlOverride: "https://synthetic.invalid", token: "synthetic-collaborator", hostToken: "synthetic-host" }, async () => {
      expect(await loadMarketplaceApi()).toBeNull();
    });
  });
  test("existing OKF skills show the limited confirmed fact, not verified resources or connected MCP", () => {
    const html = renderToStaticMarkup(<NativeCatalog {...props} skills={[{ name: "novy-spis", path: "a" }, { name: "okf-pamat", path: "b" }, { name: "usporiadaj-spis", path: "c" }, { name: "roztried-spis", path: "d" }, { name: "vystup-dokumentu", path: "e" }]} />);
    expect(html).toContain("Skills saved");
    expect(html).toContain("Confirm package update");
    expect(html).not.toContain("MCP connected");
    expect(html).not.toContain("Resources verified");
    expect(html).toContain("installed once for all your clients");
    expect(html).toContain("LAWOSS Marketplace by Omni Legal Products");
    expect(html).toContain("Selected matter");
  });
  test("partial OKF pack does not report all five installed and readonly actions stay disabled", () => {
    const html = renderToStaticMarkup(<NativeCatalog {...props} skills={[{ name: "novy-spis", path: "a" }, { name: "okf-pamat", path: "b" }, { name: "usporiadaj-spis", path: "c" }]} />);
    expect(html).not.toContain("Skills saved");
    // Bez lokálneho servera LAWOSS Marketplace a bez práva zápisu: potvrdenie v každej karte je vypnuté.
    expect(html.match(/<button[^>]*disabled=""[^>]*>Confirm installation in folder<\/button>/g)?.length).toBe(MARKETPLACE_CATALOG.length);
    expect(html).toContain('data-lawoss-target="workspace"');
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
