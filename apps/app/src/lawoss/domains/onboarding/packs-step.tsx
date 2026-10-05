/** @jsxImportSource react */
/**
 * LAWOSS: krok onboardingu „Odporúčané balíky LAWOSS“ (rozhodnutie MČ 5. 10. 2026, ADR 0015 bod 8).
 * Po kancelárii, predvyplnený podľa jurisdikcie; balík sa dá odškrtnúť a pridať balík inej
 * jurisdikcie. Inštaluje raz pre všetkých klientov až tlačidlom; stiahnutie z GitHubu Omni Legal
 * Products je v texte uvedené. Krok sa dá preskočiť, ten istý panel ostáva v LAWOSS Marketplace.
 * Otvorenie kroku nejde na sieť.
 */
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";

import { RecommendedBundlesPanel } from "../marketplace/bundles-panel";
import { getMarketplaceCatalog } from "../marketplace/catalog";
import type { LawossMarketplaceApi } from "../marketplace/marketplace-api";
import { globalInstalledIds, installGlobalEntries, useLawossMarketplace } from "../marketplace/use-lawoss-marketplace";
import type { Jurisdiction } from "./api";

export function PacksStep({ api, jurisdiction, busy, onContinue }: {
  /** Klient servera z onboardingu; bez neho sa načíta lokálny server. */
  api?: LawossMarketplaceApi | null;
  jurisdiction: Jurisdiction;
  busy: boolean;
  onContinue: () => void;
}) {
  const locale = useLocale();
  const marketplace = useLawossMarketplace({ api });
  const installed = globalInstalledIds(marketplace.view, getMarketplaceCatalog(locale));
  return <div data-lawoss-onboarding-packs="" className="grid gap-4">
    <h2 className="text-xl font-semibold">{t("lawoss.integrations.base.title", locale)}</h2>
    <p className="text-muted-foreground">{t("lawoss.marketplace.onboarding.intro", locale)}</p>
    <RecommendedBundlesPanel embedded jurisdiction={jurisdiction} installed={installed} permitted={Boolean(marketplace.api)} busy={busy}
      install={(entries) => installGlobalEntries(marketplace.api!, entries)} onInstalled={marketplace.refresh} />
    <p className="text-xs text-muted-foreground">{t("lawoss.marketplace.onboarding.later", locale)}</p>
    <div>
      <Button variant="outline" disabled={busy} onClick={onContinue}>{t("lawoss.marketplace.onboarding.continue", locale)}</Button>
    </div>
  </div>;
}
