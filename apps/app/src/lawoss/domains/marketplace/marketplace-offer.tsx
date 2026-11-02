/** @jsxImportSource react */
/**
 * LAWOSS: ponuka LAWOSS Marketplace po onboardingu a úvod „Ako fungujú doplnky“ (MČ 2. 11. 2026: ponúknuť
 * marketplace hneď po onboardingu aj s vysvetlením, prečo je to dobré). Inštalácia ostáva na kliknutí advokáta
 * (`RecommendedBundlesPanel`), otvorenie ponuky nejde na sieť.
 */
import { useState } from "react";
import { BookOpenCheck, Cable, Check, Package, ShieldCheck, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import type { Jurisdiction } from "../onboarding/api";
import { RecommendedBundlesPanel } from "./bundles-panel";
import { getMarketplaceCatalog } from "./catalog";
import type { LawossMarketplaceApi } from "./marketplace-api";
import { globalInstalledIds, installGlobalEntries, useLawossMarketplace } from "./use-lawoss-marketplace";

const BENEFITS = [
  { key: "lawoss.marketplace.offer.benefit_sources", Icon: BookOpenCheck },
  { key: "lawoss.marketplace.offer.benefit_once", Icon: Users },
  { key: "lawoss.marketplace.offer.benefit_control", Icon: ShieldCheck },
] as const;

/** Ponuka v kroku „Pripravené“: prečo doplnky, a odporúčané balíky jurisdikcie kancelárie (predvolene zaškrtnuté). */
export function MarketplaceOffer({ api, jurisdiction, busy = false }: { api?: LawossMarketplaceApi | null; jurisdiction?: Jurisdiction; busy?: boolean }) {
  const locale = useLocale();
  const marketplace = useLawossMarketplace({ api });
  const installed = globalInstalledIds(marketplace.view, getMarketplaceCatalog(locale));
  return <section className="lw-wiz-offer" aria-labelledby="lawoss-marketplace-offer" data-lawoss-marketplace-offer="">
    <h3 id="lawoss-marketplace-offer" className="lw-wiz-offer-title"><Sparkles className="size-4" aria-hidden />{t("lawoss.marketplace.offer.title", locale)}</h3>
    <p className="text-sm text-muted-foreground">{t("lawoss.marketplace.offer.lead", locale)}</p>
    <ul className="lw-wiz-offer-benefits">
      {BENEFITS.map(({ key, Icon }) => <li key={key}><Icon className="size-4 shrink-0" aria-hidden /><span>{t(key, locale)}</span></li>)}
    </ul>
    <RecommendedBundlesPanel embedded jurisdiction={jurisdiction} installed={installed} permitted={Boolean(marketplace.api)} busy={busy}
      install={(entries) => installGlobalEntries(marketplace.api!, entries)} onInstalled={marketplace.refresh} />
    <p className="text-xs text-muted-foreground">{t("lawoss.marketplace.onboarding.later", locale)}</p>
  </section>;
}

const INTRO_KEY = "lawoss.marketplace.intro.dismissed";
const PARTS = [
  { key: "lawoss.marketplace.intro.skill", Icon: BookOpenCheck },
  { key: "lawoss.marketplace.intro.connector", Icon: Cable },
  { key: "lawoss.marketplace.intro.plugin", Icon: Package },
] as const;

/** Uložená voľba „Rozumiem“; prehliadač bez úložiska (súkromné okno, náhľad) úvod ukáže znova. */
function readDismissed(): boolean {
  try { return globalThis.localStorage?.getItem(INTRO_KEY) === "1"; } catch { return false; }
}

/** Úvod nad katalógom: čo je skill, konektor a balík, a čo doplnky smú. Po „Rozumiem“ sa už neukáže. */
export function MarketplaceIntro() {
  const locale = useLocale();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed) return null;
  const dismiss = () => {
    try { globalThis.localStorage?.setItem(INTRO_KEY, "1"); } catch { /* úložisko nedostupné: skryje sa len teraz */ }
    setDismissed(true);
  };
  return <section className="space-y-3 rounded-xl border border-dls-border bg-dls-surface p-4" aria-labelledby="lawoss-marketplace-intro" data-lawoss-marketplace-intro="">
    <h4 id="lawoss-marketplace-intro" className="text-sm font-semibold text-dls-text">{t("lawoss.marketplace.intro.title", locale)}</h4>
    <ul className="grid gap-3 sm:grid-cols-3">
      {PARTS.map(({ key, Icon }) => <li key={key} className="flex gap-2 text-sm text-dls-text"><Icon className="mt-0.5 size-4 shrink-0 text-[var(--lw-gold)]" aria-hidden /><span>{t(key, locale)}</span></li>)}
    </ul>
    <p className="flex gap-2 text-xs text-dls-secondary"><ShieldCheck className="size-4 shrink-0" aria-hidden /><span>{t("lawoss.marketplace.intro.safety", locale)}</span></p>
    <div><Button type="button" size="sm" variant="outline" onClick={dismiss}><Check className="size-4" aria-hidden />{t("lawoss.marketplace.intro.dismiss", locale)}</Button></div>
  </section>;
}
