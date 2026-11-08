import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useLawossMarketplace } from "../src/lawoss/domains/marketplace/use-lawoss-marketplace";
import { filterCatalogEntries as filterCatalog } from "../src/lawoss/domains/marketplace/catalog-search";
import { getMarketplaceCatalog } from "../src/lawoss/domains/marketplace/catalog";
import { lawossMarketplaceMethods, type MarketplaceView } from "../src/lawoss/domains/marketplace/marketplace-api";

// Mounted React regression, runnable in Chromium or an isolated DOM. No network or app state.
export async function runMarketplaceScopeRegression() {
  const host = document.createElement("div");
  host.hidden = true; document.body.appendChild(host);
  const root = createRoot(host);
  const pending: Array<{ path: string; resolve: (view: MarketplaceView) => void }> = [];
  const api = lawossMarketplaceMethods(<T,>(path: string) => new Promise<T>(resolve => pending.push({ path, resolve: value => resolve(value as T) })));
  const value = (label: string): MarketplaceView => ({ global: [], globalChanges: {}, workspace: [], updates: [], settings: { weeklyCheck: false, lastCheckedAt: null }, check: { status: "error", message: label } });
  let state: ReturnType<typeof useLawossMarketplace>;
  function Probe({ id }: { id: string }) { state = useLawossMarketplace({ api, workspaceId: id }); return null; }
  const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)); flushSync(() => {}); };
  let checks = 0;
  const check = (ok: boolean) => { if (!ok) throw Error(`Marketplace scope assertion ${checks + 1}`); checks++; };
  try {
    flushSync(() => root.render(<Probe id="SYN-A" />));
    await settle();
    const oldRefresh = state!.refresh;
    check(pending.length === 1);
    flushSync(() => root.render(<Probe id="SYN-B" />));
    await settle();
    check(state!.view === null && pending.length === 2);
    pending[1]!.resolve(value("B")); await settle();
    check(state!.view?.check?.status === "error" && state!.view.check.message === "B");
    pending[0]!.resolve(value("A-late")); await settle();
    check(state!.view?.check?.status === "error" && state!.view.check.message === "B");
    await oldRefresh(); check(pending.length === 2);
    const one = state!.check("manual"), two = state!.check("manual");
    await settle(); check(pending.length === 3 && state!.checking);
    pending[2]!.resolve(value("B-checked")); await Promise.all([one, two]); await settle();
    check(!state!.checking && state!.view?.check?.status === "error" && state!.view.check.message === "B-checked");
    const catalog = getMarketplaceCatalog("sk");
    check(filterCatalog(catalog, "   ").length === catalog.length);
    check(filterCatalog(catalog, "obchodny register").some(item => item.id === "orsr"));
    check(filterCatalog(catalog, "SYN-no-such-connector-999").length === 0);
    check(filterCatalog(catalog, "SLOV-LEX").some(item => item.id === "slovlex"));
    return { checks, status: "pass" };
  } finally { flushSync(() => root.unmount()); host.remove(); }
}
