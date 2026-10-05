import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { bundleEntries, officeBundles, recommendedBundles } from "../src/lawoss/domains/marketplace/base-pack";
import { MARKETPLACE_CATALOG, MARKETPLACE_SNAPSHOT, PENDING_REF, getMarketplaceCatalog, marketplaceCategories } from "../src/lawoss/domains/marketplace/catalog";
import { catalogPluginId, catalogPluginUrl, installBasePack } from "../src/lawoss/domains/marketplace/native-actions";
import { RecommendedBundlesPanel } from "../src/lawoss/domains/marketplace/native-catalog";
import { catalogUpdateState, installedProvenance } from "../src/lawoss/domains/marketplace/installed-plugin";
import { validateSnapshot } from "../../../lawoss/scripts/update-marketplace-snapshot.mjs";

const MARKETPLACE_PLUGINS = ["crz", "cz-agents", "disq", "eurlex-celex", "fs-opendata-mcp", "judikaty", "kalkulacky", "orsr", "ov", "rpo", "rpvs", "ru", "ruz", "slovlex", "uvo", "google-workspace-gog"];
const sk = recommendedBundles().find((bundle) => bundle.id === "sk-zaklad")!;

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

function imported(id: string, provenance?: unknown) {
  const entry = MARKETPLACE_CATALOG.find((item) => item.id === id)!;
  return { pluginId: catalogPluginId(entry), name: id, marketplaceId: null, description: null, updatedAt: null, files: [], importedAt: null, ...(provenance ? { provenance } : {}) };
}

describe("LAWOSS Marketplace: katalóg z marketplace, nie z kódu appky", () => {
  test("pribalená kópia katalógu je platná a pochádza z lawoss-marketplace", () => {
    expect(validateSnapshot(MARKETPLACE_SNAPSHOT)).toEqual([]);
    expect(MARKETPLACE_SNAPSHOT.repository).toBe("Omni-Legal-Products/lawoss-marketplace");
    expect(MARKETPLACE_CATALOG.map((entry) => entry.id)).toEqual(["okf", ...MARKETPLACE_SNAPSHOT.plugins.map((plugin) => plugin.name)]);
    for (const id of MARKETPLACE_PLUGINS) expect(MARKETPLACE_CATALOG.some((entry) => entry.id === id)).toBe(true);
  });

  test("kategórie podľa jurisdikcie, Všeobecné a Balíky nesie marketplace", () => {
    expect(marketplaceCategories("sk").map((category) => [category.id, category.label])).toEqual([
      ["sk", "Slovensko"], ["cz", "Česko"], ["general", "Všeobecné"], ["bundles", "Balíky"],
    ]);
    expect(marketplaceCategories("de").map((category) => category.label)).toEqual(["Slowakei", "Tschechien", "Allgemein", "Pakete"]);
    const category = (id: string) => MARKETPLACE_CATALOG.find((entry) => entry.id === id)?.category;
    expect(category("orsr")).toBe("sk");
    expect(category("cz-agents")).toBe("cz");
    expect(category("google-workspace-gog")).toBe("general");
    expect(category("eurlex-celex")).toBe("general");
  });

  test("balíky SK základ a CZ základ z marketplace, CZ predbežne", () => {
    expect(sk.plugins).toEqual(["slovlex", "orsr", "judikaty", "kalkulacky", "ruz", "rpo"]);
    const cz = recommendedBundles().find((bundle) => bundle.id === "cz-zaklad")!;
    expect(cz.plugins).toEqual(["cz-agents", "eurlex-celex"]);
    expect(cz.provisional).toBe(true);
    expect(officeBundles("sk").map((bundle) => bundle.id)).toEqual(["sk-zaklad"]);
    expect(officeBundles("cz").map((bundle) => bundle.id)).toEqual(["cz-zaklad"]);
    expect(bundleEntries(sk).map((entry) => entry.id)).toEqual(sk.plugins);
  });

  test("jeden pripnutý SHA pre pluginy; plugin, ktorý na ňom ešte nie je, sa odmietne bez siete", () => {
    for (const entry of MARKETPLACE_CATALOG.filter((item) => item.install.action === "plugin")) {
      if (entry.source.ref === PENDING_REF) {
        expect(() => catalogPluginUrl(entry)).toThrow();
        continue;
      }
      expect(entry.source.ref).toBe(MARKETPLACE_SNAPSHOT.ref);
      expect(catalogPluginUrl(entry)).toBe(`https://github.com/Omni-Legal-Products/lawoss-marketplace/tree/${MARKETPLACE_SNAPSHOT.ref}/${entry.install.path}`);
    }
  });

  test("názvy a popisy v štyroch jazykoch prichádzajú z marketplace", () => {
    expect(getMarketplaceCatalog("cs").find((entry) => entry.id === "orsr")?.name).toBe("Obchodní rejstřík SR");
    expect(getMarketplaceCatalog("en").find((entry) => entry.id === "google-workspace-gog")?.name).toBe("Google Workspace via gog");
  });
});

describe("inštalácia odporúčaných balíkov a pôvod inštalácie", () => {
  test("ide po jednom cez natívny importér, zlyhanie nezastaví ostatné a stav sa obnoví raz", async () => {
    const context = actions({ failOn: "orsr" });
    const result = await installBasePack(bundleEntries(sk), context);
    expect(result.installed).toEqual(["slovlex", "judikaty", "kalkulacky", "ruz", "rpo"]);
    expect(result.failed).toEqual([{ id: "orsr", message: "zlyhalo" }]);
    expect(context.calls.filter((call) => call === "refresh")).toHaveLength(1);
  });

  test("bez priečinka alebo práva zápisu sa nič neinštaluje", async () => {
    for (const context of [actions({ canInstallPlugin: false }), actions({ workspaceId: "" })]) {
      await expect(installBasePack(bundleEntries(sk), context)).rejects.toThrow();
      expect(context.calls).toEqual([]);
    }
  });

  test("zapísaná verzia sa porovná s katalógom bez siete", () => {
    const entry = MARKETPLACE_CATALOG.find((item) => item.id === "orsr")!;
    const source = { owner: "Omni-Legal-Products", repo: "lawoss-marketplace", ref: MARKETPLACE_SNAPSHOT.ref, dir: "plugins/orsr" };
    expect(installedProvenance(imported("orsr", { source, version: "1.0.0" }))).toEqual({ repository: "Omni-Legal-Products/lawoss-marketplace", ref: MARKETPLACE_SNAPSHOT.ref, version: "1.0.0" });
    expect(catalogUpdateState(entry, imported("orsr", { source, version: "1.0.0" }))).toBe("newer");
    expect(catalogUpdateState(entry, imported("orsr", { source, version: entry.version }))).toBe("current");
    expect(catalogUpdateState(entry, imported("orsr"))).toBe("unknown");
  });
});

describe("panel Odporúčané balíky LAWOSS", () => {
  const panel = (jurisdiction: "sk" | "cz", installed: Set<string> = new Set()) => renderToStaticMarkup(
    <RecommendedBundlesPanel jurisdiction={jurisdiction} installed={installed} permitted
      install={async () => { throw new Error("vykreslenie nesmie inštalovať"); }} />);

  test("slovenská kancelária: SK základ zaškrtnutý, CZ základ sa dá pridať", () => {
    const html = panel("sk");
    expect(html).toContain('data-lawoss-recommended="sk"');
    expect(html).toContain('data-lawoss-bundle="sk-zaklad"');
    expect(html).toContain('data-lawoss-bundle="cz-zaklad"');
    expect(html.match(/type="checkbox"/g)).toHaveLength(8);
    expect(html.match(/checked=""/g)).toHaveLength(6);
    expect(html).toContain("Recommended LAWOSS bundles");
    // Jasný text: raz pre všetkých klientov, až tlačidlom, z GitHubu Omni Legal Products.
    expect(html).toContain("installed once for all your clients, only after you click the button");
    expect(html).toContain("public repository of Omni Legal Products (Omni-Legal-Products/lawoss-marketplace)");
    expect(html).toContain("Install for all clients");
  });

  test("česká kancelária: CZ základ zaškrtnutý a označený ako predbežný", () => {
    const html = panel("cz");
    expect(html.match(/checked=""/g)).toHaveLength(2);
    expect(html).toContain("Provisional");
  });

  test("všetko nainštalované: nič sa neponúka", () => {
    const html = panel("sk", new Set(recommendedBundles().flatMap((bundle) => bundle.plugins)));
    expect(html).toContain("All recommended bundles are installed for all your clients.");
    expect(html).not.toContain("Install for all clients");
  });
});
