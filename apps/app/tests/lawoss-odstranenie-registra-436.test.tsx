// LAWOSS #436: odstránenie pripojenia registra v Nastaveniach. Doplnok bez pripojenia sa ponúkne znova (nie „nainštalované“),
// klient čaká na výsledok vlastným limitom a po jeho uplynutí povie, že odstránenie ešte môže prebiehať.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { t } from "../src/i18n";
import { getMarketplaceCatalog, MARKETPLACE_CATALOG } from "../src/lawoss/domains/marketplace/catalog";
import type { MarketplaceView } from "../src/lawoss/domains/marketplace/marketplace-api";
import { catalogPluginId } from "../src/lawoss/domains/marketplace/native-actions";
import { RecommendedBundlesPanel } from "../src/lawoss/domains/marketplace/bundles-panel";
import { globalInstalledIds } from "../src/lawoss/domains/marketplace/use-lawoss-marketplace";
import { MCP_REMOVE_TIMEOUT_MS, removalMayBeRunning } from "../src/lawoss/domains/integrations/mcp-removal";

const entry = (id: string) => MARKETPLACE_CATALOG.find((item) => item.id === id)!;
const plugin = (id: string) => ({ pluginId: catalogPluginId(entry(id)), name: entry(id).name, marketplaceId: null, description: null, updatedAt: null, files: [], importedAt: null });
const view = (globalMissingMcp?: Record<string, string[]>): MarketplaceView => ({
  global: [plugin("slovlex"), plugin("orsr")], globalChanges: {}, workspace: [], settings: { weeklyCheck: false, lastCheckedAt: null }, check: null, updates: [],
  ...(globalMissingMcp ? { globalMissingMcp } : {}),
});

describe("#436 stav doplnku po odstránení pripojenia", () => {
  test("doplnok s pripojením je nainštalovaný, bez pripojenia nie", () => {
    expect([...globalInstalledIds(view(), MARKETPLACE_CATALOG)].sort()).toEqual(["orsr", "slovlex"]);
    const removed = view({ [catalogPluginId(entry("orsr"))]: ["orsr"] });
    expect([...globalInstalledIds(removed, MARKETPLACE_CATALOG)]).toEqual(["slovlex"]);
    // An empty list (nothing missing) keeps it installed.
    expect([...globalInstalledIds(view({ [catalogPluginId(entry("orsr"))]: [] }), MARKETPLACE_CATALOG)].sort()).toEqual(["orsr", "slovlex"]);
  });

  test("odporúčané balíky ponúknu doplnok bez pripojenia na inštaláciu", () => {
    const installed = globalInstalledIds(view({ [catalogPluginId(entry("orsr"))]: ["orsr"] }), MARKETPLACE_CATALOG);
    const html = renderToStaticMarkup(<RecommendedBundlesPanel jurisdiction="sk" installed={installed} permitted install={async () => ({ installed: [], failed: [] })} />);
    // The panel renders catalog names in the app language (English in tests).
    const name = getMarketplaceCatalog("en").find((item) => item.id === "orsr")!.name;
    const orsr = html.split("<li>").find((item) => item.includes(`>${name}<`)) ?? "";
    expect(orsr).toContain("checkbox");
    expect(orsr).not.toContain("disabled");
    expect(orsr).not.toContain(t("lawoss.marketplace.badge.global"));
  });

  test("odstránenie má vlastný dlhší limit a po ňom nehlási zlyhanie, ale možný beh na pozadí", () => {
    expect(MCP_REMOVE_TIMEOUT_MS).toBeGreaterThan(10_000);
    expect(removalMayBeRunning(new Error(t("app.request_timed_out")))).toBe(true);
    expect(removalMayBeRunning(new Error("Write request denied"))).toBe(false);
    expect(removalMayBeRunning("timeout")).toBe(false);
  });
});
