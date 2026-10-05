import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Jurisdiction } from "../onboarding/api";
import { bundleEntries, officeBundles, recommendedBundles } from "./base-pack";
import { getMarketplaceCatalog, type MarketplaceEntry } from "./catalog";
import type { BasePackResult } from "./native-actions";

/** Jurisdikcia z profilu onboardingu (len lokálny server); bez profilu Slovensko. */
export function useOfficeJurisdiction(known: Jurisdiction | undefined): Jurisdiction {
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>(known ?? "sk");
  useEffect(() => {
    if (known) { setJurisdiction(known); return; }
    let cancelled = false;
    void import("../../okf/connection")
      .then(({ loadOkfConnection }) => loadOkfConnection())
      .then((connection) => connection.client?.onboardingStatus())
      .then((status) => { if (!cancelled && status?.profile?.jurisdiction) setJurisdiction(status.profile.jurisdiction); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [known]);
  return jurisdiction;
}

export type BundlesPanelProps = {
  /** Jurisdikcia kancelárie, ak ju volajúci pozná (onboarding, testy); inak z profilu. */
  jurisdiction?: Jurisdiction;
  /** Id položiek katalógu, ktoré sú už nainštalované. */
  installed: ReadonlySet<string>;
  permitted: boolean;
  busy?: boolean;
  install: (entries: MarketplaceEntry[]) => Promise<BasePackResult>;
  /** Po dokončení inštalácie (obnova stavu). */
  onInstalled?: () => void | Promise<void>;
  /** Onboarding: bez rámčeka a nadpisu, ten má krok. */
  embedded?: boolean;
};

/**
 * Odporúčané balíky LAWOSS z marketplace (SK základ, CZ základ). Predvolene zaškrtnuté je, čo
 * v balíku jurisdikcie kancelárie ešte chýba; ostatné balíky sa dajú pridať. Inštaluje sa raz
 * pre všetkých klientov a sťahuje sa z GitHubu, preto až po kliknutí advokáta, nikdy potichu.
 * Ten istý panel je v onboardingu (krok „Odporúčané balíky LAWOSS“) aj v LAWOSS Marketplace.
 */
export function RecommendedBundlesPanel(props: BundlesPanelProps) {
  const locale = useLocale();
  const jurisdiction = useOfficeJurisdiction(props.jurisdiction);
  const catalog = getMarketplaceCatalog(locale);
  const bundles = recommendedBundles();
  const office = new Set(officeBundles(jurisdiction).map((bundle) => bundle.id));
  const isInstalled = (entry: MarketplaceEntry) => props.installed.has(entry.id);
  const missingDefaults = bundles.filter((bundle) => office.has(bundle.id))
    .flatMap((bundle) => bundleEntries(bundle, catalog)).filter((entry) => !isInstalled(entry)).map((entry) => entry.id);
  const defaultsKey = missingDefaults.join(",");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(missingDefaults));
  useEffect(() => { setSelected(new Set(defaultsKey ? defaultsKey.split(",") : [])); }, [defaultsKey]);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<BasePackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const all = bundles.flatMap((bundle) => bundleEntries(bundle, catalog));
  const chosen = all.filter((entry, index) => selected.has(entry.id) && !isInstalled(entry) && all.findIndex((item) => item.id === entry.id) === index);
  const missingAny = all.some((entry) => !isInstalled(entry));
  const nameOf = (id: string) => all.find((entry) => entry.id === id)?.name ?? id;
  const toggle = (id: string) => setSelected((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const install = async () => {
    setWorking(true); setResult(null); setError(null);
    try {
      setResult(await props.install(chosen));
      await props.onInstalled?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setWorking(false); }
  };
  return <article data-lawoss-recommended={jurisdiction} className={props.embedded ? "space-y-3" : "space-y-3 rounded-xl border border-[rgba(201,162,74,0.35)] bg-[var(--lw-accent-soft)] p-4"}>
    <div className="space-y-1">
      {props.embedded ? null : <h4 className="text-sm font-semibold text-dls-text">{t("lawoss.integrations.base.title", locale)}</h4>}
      <p className="max-w-prose text-sm text-dls-secondary">{t("lawoss.marketplace.bundles.description", locale)}</p>
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      {bundles.map((bundle) => <fieldset key={bundle.id} data-lawoss-bundle={bundle.id} className="space-y-2 rounded-lg border border-dls-border bg-dls-surface p-3">
        <legend className="sr-only">{bundle.title[locale]}</legend>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-dls-text">{bundle.title[locale]}</span>
          {office.has(bundle.id) ? <span className="rounded-full border border-[rgba(201,162,74,0.45)] bg-[var(--lw-gold-ink)] px-2 text-[10px] font-medium text-dls-text">{t("lawoss.integrations.base.office", locale)}</span> : null}
          {bundle.provisional ? <span className="rounded-full border border-dls-border px-2 text-[10px] text-dls-secondary">{t("lawoss.integrations.base.provisional", locale)}</span> : null}
        </div>
        <p className="text-xs text-dls-secondary">{bundle.summary[locale]}</p>
        <ul className="space-y-1.5">
          {bundleEntries(bundle, catalog).map((entry) => {
            const installed = isInstalled(entry);
            return <li key={entry.id}>
              <label className="flex items-start gap-2 text-sm text-dls-text">
                <input type="checkbox" className="mt-0.5 accent-[var(--lw-gold)]" checked={installed || selected.has(entry.id)} disabled={installed || working} onChange={() => toggle(entry.id)} />
                <span className="min-w-0">
                  <span className="font-medium">{entry.name}</span>
                  {installed ? <span className="ml-2 text-xs text-dls-secondary">{t("lawoss.marketplace.badge.global", locale)}</span> : null}
                </span>
              </label>
            </li>;
          })}
        </ul>
      </fieldset>)}
    </div>
    {!missingAny ? <p role="status" className="text-sm text-dls-secondary">{t("lawoss.marketplace.bundles.all_installed", locale)}</p> : <div className="flex flex-wrap items-center gap-3">
      <Button disabled={working || props.busy || !props.permitted || chosen.length === 0} onClick={() => void install()}>
        {working ? t("lawoss.marketplace.bundles.installing", locale) : t("lawoss.marketplace.bundles.install", locale)}
      </Button>
      {!props.permitted ? <p className="text-xs text-dls-secondary">{t("lawoss.marketplace.unavailable", locale)}</p> : null}
    </div>}
    {result?.installed.length ? <p role="status" className="text-sm text-dls-secondary">{t("lawoss.integrations.base.installed_list", locale, { names: result.installed.map(nameOf).join(", ") })}</p> : null}
    {result?.failed.length ? <p role="alert" className="text-sm text-red-11">{t("lawoss.integrations.base.failed_list", locale, { names: result.failed.map((item) => `${nameOf(item.id)} (${item.message})`).join("; ") })}</p> : null}
    {error ? <p role="alert" className="text-sm text-red-11">{error}</p> : null}
  </article>;
}
