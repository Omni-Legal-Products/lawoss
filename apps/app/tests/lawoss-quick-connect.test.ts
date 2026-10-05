import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { LEGALWORK_EXTENSION_CATALOG, MCP_QUICK_CONNECT, MCP_QUICK_CONNECT_ALL } from "../src/app/constants";
import {
  HIDDEN_QUICK_CONNECT_SERVERS,
  LAWOSS_QUICK_CONNECT_ALLOWLIST,
  isHiddenQuickConnect,
  isLegalQuantsHidden,
} from "../src/lawoss/feature-flags";
import {
  LEGALWORK_SOURCE_STORAGE_KEY,
  isLegalworkSourceEnabled,
  reloadLegalworkSourceFromStorage,
} from "../src/lawoss/domains/integrations/legalwork-source";
import { applyLegalworkSource, setLegalworkSource } from "../src/lawoss/domains/integrations/legalwork-source-sync";
import { IntegrationSourcesContent } from "../src/lawoss/domains/integrations/integration-sources-card";
import { LegalQuantsImportButton } from "../src/react-app/domains/settings/pages/legalquants-import";

// Minimálna náhrada localStorage pod bun, rovnaký tvar ako v ostatných testoch úložiska.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
    clear: () => storage.clear(),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() { return storage.size; },
  },
  configurable: true,
});

const names = (entries: ReadonlyArray<{ serverName?: string }>) => entries.map((entry) => entry.serverName);
const UPSTREAM = ["notion", "dropbox", "courtlistener", "computer-use", "google-workspace", "legalwork-ui", "legalwork-voice"];

// Bun zdieľa jeden proces a cache modulov: každý test vráti katalógy do predvoleného stavu.
function reset() {
  storage.clear();
  reloadLegalworkSourceFromStorage();
  applyLegalworkSource();
}
beforeEach(reset);
afterEach(reset);

describe("LAWOSS zdroje integrácií: rýchle pripojenie MCP", () => {
  test("zdroj LegalWork je predvolene vypnutý", () => {
    expect(isLegalworkSourceEnabled()).toBe(false);
    for (const value of ["1", "true", "ON", "yes", ""]) {
      storage.set(LEGALWORK_SOURCE_STORAGE_KEY, value);
      reloadLegalworkSourceFromStorage();
      expect(isLegalworkSourceEnabled()).toBe(false);
    }
  });

  test("bez zdroja LegalWork sa ponúkne len allowlist LAWOSS, žiadny upstream konektor", () => {
    const visible = names(MCP_QUICK_CONNECT);
    for (const name of UPSTREAM) expect(visible).not.toContain(name);
    expect(visible.every((name) => LAWOSS_QUICK_CONNECT_ALLOWLIST.has(name ?? ""))).toBe(true);
    expect(LEGALWORK_EXTENSION_CATALOG.find((entry) => entry.id === "computer-use")).toBeUndefined();
  });

  test("so zapnutým zdrojom sa upstream konektory ukážu, LegalMemory nikdy", () => {
    setLegalworkSource(true);
    expect(storage.get(LEGALWORK_SOURCE_STORAGE_KEY)).toBe("on");
    const visible = names(MCP_QUICK_CONNECT);
    for (const name of UPSTREAM) expect(visible).toContain(name);
    expect(visible).not.toContain("legalmemory");
    expect(visible.length).toBe(MCP_QUICK_CONNECT_ALL.length - HIDDEN_QUICK_CONNECT_SERVERS.size);
    expect(LEGALWORK_EXTENSION_CATALOG.map((entry) => entry.id)).toEqual(expect.arrayContaining(["computer-use", "google-workspace"]));
  });

  test("LegalMemory ostane skrytý bez ohľadu na prepínač", () => {
    expect(isHiddenQuickConnect("legalmemory")).toBe(true);
    setLegalworkSource(true);
    expect(isHiddenQuickConnect("legalmemory")).toBe(true);
  });

  test("nová upstream položka sa po synci sama nezobrazí", () => {
    expect(isHiddenQuickConnect("buduci-upstream-konektor")).toBe(true);
    setLegalworkSource(true);
    expect(isHiddenQuickConnect("buduci-upstream-konektor")).toBe(false);
  });

  test("prepnutie mení obsah tých istých polí, ktoré držia spotrebitelia", () => {
    const quick = MCP_QUICK_CONNECT;
    const extensions = LEGALWORK_EXTENSION_CATALOG;
    setLegalworkSource(true);
    expect(MCP_QUICK_CONNECT).toBe(quick);
    expect(LEGALWORK_EXTENSION_CATALOG).toBe(extensions);
    expect(quick.length).toBeGreaterThan(0);
    setLegalworkSource(false);
    expect(names(quick)).not.toContain("notion");
  });
});

describe("LAWOSS zdroje integrácií: LegalQuants a karta", () => {
  const props = {
    busy: false,
    existingNames: new Set<string>(),
    className: "lq",
    extensions: {
      scanGithubSkills: async () => { throw new Error("nesmie skenovať"); },
      importGithubSkills: async () => { throw new Error("nesmie importovať"); },
    },
  };

  test("LegalQuants sa bez zdroja LegalWork nevykreslí, a teda neskenuje", () => {
    expect(isLegalQuantsHidden()).toBe(true);
    expect(renderToStaticMarkup(createElement(LegalQuantsImportButton, props))).toBe("");
    setLegalworkSource(true);
    expect(isLegalQuantsHidden()).toBe(false);
    expect(renderToStaticMarkup(createElement(LegalQuantsImportButton, props))).toContain("LegalQuants");
  });

  test("karta ukazuje tri zdroje a meno upstreamu v texte zdroja LegalWork", () => {
    const html = renderToStaticMarkup(createElement(IntegrationSourcesContent, { locale: "sk", legalWorkEnabled: false, onLegalworkChange: () => {} }));
    expect(html).toContain("LAWOSS");
    expect(html).toContain("Konektory a nástroje z projektu LegalWork. Pripájajú sa priamo k ich dodávateľom; LAWOSS ich nekontroluje.");
    expect(html).toContain("Vlastné");
    expect(html).toContain('data-lawoss-source-switch="legalwork"');
    expect(html).toContain("Vypnuté.");
    const on = renderToStaticMarkup(createElement(IntegrationSourcesContent, { locale: "de", legalWorkEnabled: true, onLegalworkChange: () => {} }));
    expect(on).toContain("Konnektoren und Werkzeuge aus dem Projekt LegalWork.");
  });
});
