import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { BASE_PACK, PROVISIONAL_BASE_PACK, basePackEntries } from "../src/lawoss/domains/marketplace/base-pack";
import { GOOGLE_WORKSPACE_GOG_REF, LAWOSS_MARKETPLACE_REF, MARKETPLACE_CATALOG } from "../src/lawoss/domains/marketplace/catalog";
import { catalogPluginId, catalogPluginUrl, installBasePack } from "../src/lawoss/domains/marketplace/native-actions";
import { BasePackPanel } from "../src/lawoss/domains/marketplace/native-catalog";

const MARKETPLACE_PLUGINS = ["crz", "cz-agents", "disq", "eurlex-celex", "fs-opendata-mcp", "judikaty", "kalkulacky", "orsr", "ov", "rpo", "rpvs", "ru", "ruz", "slovlex", "uvo"];

function actions(overrides: Partial<{ canInstallPlugin: boolean; workspaceId: string; failOn: string }> = {}) {
  const calls: string[] = [];
  return {
    calls,
    workspaceId: overrides.workspaceId ?? "selected",
    canInstallPlugin: overrides.canInstallPlugin ?? true,
    canInstallSkills: true,
    installPlugin: async (url: string) => {
      calls.push(url);
      if (overrides.failOn && url.endsWith(`/plugins/${overrides.failOn}`)) return { ok: false, message: "zlyhalo" };
      return { ok: true, message: "ok" };
    },
    installOkf: async () => ({ ok: true, message: "ok" }),
    refresh: async () => { calls.push("refresh"); },
  };
}

describe("LAWOSS základný balík a katalóg", () => {
  test("balík SK a CZ podľa rozhodnutia MČ 5. 10. 2026, CZ predbežne", () => {
    expect(BASE_PACK.sk).toEqual(["slovlex", "orsr", "judikaty", "kalkulacky", "ruz", "rpo"]);
    expect(BASE_PACK.cz).toEqual(["cz-agents", "eurlex-celex"]);
    expect(PROVISIONAL_BASE_PACK.has("cz")).toBe(true);
    for (const jurisdiction of ["sk", "cz"] as const) {
      expect(basePackEntries(jurisdiction).map((entry) => entry.id)).toEqual([...BASE_PACK[jurisdiction]]);
    }
  });

  test("katalóg ukazuje všetkých 15 pluginov marketplace a Google Workspace s označením jurisdikcie", () => {
    const ids = MARKETPLACE_CATALOG.map((entry) => entry.id);
    for (const id of [...MARKETPLACE_PLUGINS, "okf", "google-workspace-gog"]) expect(ids).toContain(id);
    for (const entry of MARKETPLACE_CATALOG) expect(entry.jurisdictions.length).toBeGreaterThan(0);
    expect(MARKETPLACE_CATALOG.find((entry) => entry.id === "eurlex-celex")?.jurisdictions).toEqual(["EU"]);
    expect(MARKETPLACE_CATALOG.find((entry) => entry.id === "cz-agents")?.jurisdictions).toEqual(["CZ"]);
  });

  test("všetky pluginy marketplace majú jeden pripnutý SHA; Google Workspace čaká na SHA po pushi", () => {
    expect(LAWOSS_MARKETPLACE_REF).toMatch(/^[a-f0-9]{40}$/);
    for (const id of MARKETPLACE_PLUGINS) {
      const entry = MARKETPLACE_CATALOG.find((item) => item.id === id)!;
      expect(entry.source.ref).toBe(LAWOSS_MARKETPLACE_REF);
      expect(catalogPluginUrl(entry)).toBe(`https://github.com/Omni-Legal-Products/lawoss-marketplace/tree/${LAWOSS_MARKETPLACE_REF}/plugins/${id}`);
    }
    const gog = MARKETPLACE_CATALOG.find((item) => item.id === "google-workspace-gog")!;
    expect(gog.source.ref).toBe(GOOGLE_WORKSPACE_GOG_REF);
    // Zástupná hodnota nie je SHA: inštalácia zlyhá hneď, nie až na GitHube.
    if (!/^[a-f0-9]{40}$/.test(GOOGLE_WORKSPACE_GOG_REF)) expect(() => catalogPluginUrl(gog)).toThrow();
  });

  test("inštalácia balíka ide po jednom cez natívny importér, zlyhanie nezastaví ostatné a stav sa obnoví raz", async () => {
    const context = actions({ failOn: "orsr" });
    const result = await installBasePack(basePackEntries("sk"), context);
    expect(result.installed).toEqual(["slovlex", "judikaty", "kalkulacky", "ruz", "rpo"]);
    expect(result.failed).toEqual([{ id: "orsr", message: "zlyhalo" }]);
    expect(context.calls.filter((call) => call === "refresh")).toHaveLength(1);
    expect(context.calls.at(-1)).toBe("refresh");
  });

  test("bez priečinka alebo práva zápisu sa nič neinštaluje", async () => {
    for (const context of [actions({ canInstallPlugin: false }), actions({ workspaceId: "" })]) {
      await expect(installBasePack(basePackEntries("sk"), context)).rejects.toThrow();
      expect(context.calls).toEqual([]);
    }
  });
});

describe("panel základného balíka", () => {
  const props = {
    workspaceId: "selected", workspaceName: "Vec Novák", busy: false, loading: false, error: null,
    plugins: [], skills: [], canInstallPlugin: true, canInstallSkills: true,
    installPlugin: async () => { throw new Error("vykreslenie nesmie inštalovať"); },
    installOkf: async () => ({ ok: true, message: "ok" }), refresh: async () => {},
    previewPlugin: async () => { throw new Error("vykreslenie nesmie načítať náhľad"); },
  };

  test("slovenská kancelária: šesť položiek predvolene zaškrtnutých, inštalácia až po kliknutí", () => {
    const html = renderToStaticMarkup(<BasePackPanel context={{ ...props, jurisdiction: "sk" }} />);
    expect(html).toContain('data-lawoss-base-pack="sk"');
    expect(html.match(/type="checkbox"/g)).toHaveLength(6);
    expect(html.match(/checked=""/g)).toHaveLength(6);
    expect(html).toContain("Install selected");
    expect(html).toContain("Vec Novák");
  });

  test("nainštalované položky sú označené a balík bez chýbajúcich položiek nič neponúka", () => {
    const installed = basePackEntries("sk").map((entry) => ({ pluginId: catalogPluginId(entry), name: entry.name, marketplaceId: null, description: null, updatedAt: null, files: [], importedAt: null }));
    const html = renderToStaticMarkup(<BasePackPanel context={{ ...props, jurisdiction: "sk", plugins: installed }} />);
    expect(html).toContain("The base pack is installed in this folder.");
    expect(html).not.toContain("Install selected");
  });

  test("česká kancelária: predbežný zoznam", () => {
    const html = renderToStaticMarkup(<BasePackPanel context={{ ...props, jurisdiction: "cz" }} />);
    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html).toContain("The list for Czechia is provisional.");
  });
});
