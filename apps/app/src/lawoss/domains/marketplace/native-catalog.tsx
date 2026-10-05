import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { SkillCard } from "../../../app/types";
import type { ImportedPlugin } from "../../../app/lib/extension-imports";
import type { LegalworkClaudePluginPreview } from "../../../app/lib/legalwork-server";
import type { Jurisdiction } from "../onboarding/api";
import { bundleEntries, officeBundles, recommendedBundles } from "./base-pack";
import { getMarketplaceCatalog, MARKETPLACE_SNAPSHOT, marketplaceCategories, type MarketplaceEntry } from "./catalog";
import { catalogUpdateState, installedProvenance } from "./installed-plugin";
import { catalogPluginId, catalogPluginUrl, installBasePack, installCatalogEntry, type BasePackResult, type CatalogActions, type InstallResult } from "./native-actions";

type Props = CatalogActions & {
  workspaceName: string;
  busy: boolean;
  loading: boolean;
  error: unknown;
  plugins: ImportedPlugin[];
  skills: SkillCard[];
  previewPlugin: (url: string) => Promise<LegalworkClaudePluginPreview>;
  /** Jurisdikcia kancelárie, ak ju volajúci pozná (testy); inak sa načíta z profilu onboardingu. */
  jurisdiction?: Jurisdiction;
};

/** Content only: native Settings owns workspace, permissions, install lifecycle and connection status. */
export function NativeCatalog(props: Props) {
  const locale = useLocale();
  const catalog = getMarketplaceCatalog(locale);
  const card = (entry: MarketplaceEntry) => <CatalogCard key={entry.id} entry={entry} context={props}
    installed={entry.install.action === "okf"
      ? OKF_SKILLS.every((name) => props.skills.some((skill) => skill.name === name))
      : isPluginInstalled(props, entry)} />;
  return <section aria-label={t("lawoss.integrations.catalog.title", locale)} data-lawoss-marketplace="" className="space-y-4">
    <div>
      <h3 className="text-base font-medium text-dls-text">{MARKETPLACE_SNAPSHOT.name}</h3>
      <p className="text-sm text-dls-secondary">{t("lawoss.integrations.catalog.description", locale, { name: props.workspaceName })}</p>
    </div>
    {props.error ? <p role="alert" className="text-sm text-red-11">{t("lawoss.integrations.catalog.load_error", locale, { detail: props.error instanceof Error ? props.error.message : String(props.error) })}</p> : null}
    <RecommendedBundlesPanel context={props} />
    <div>
      <h4 className="text-sm font-semibold text-dls-text">{t("lawoss.integrations.catalog.all_title", locale)}</h4>
      <p className="text-sm text-dls-secondary">{t("lawoss.integrations.catalog.all_description", locale)}</p>
    </div>
    <CatalogSection id="bundled" label={t("lawoss.integrations.catalog.bundled_section", locale)}>
      {catalog.filter((entry) => entry.install.action === "okf").map(card)}
    </CatalogSection>
    {marketplaceCategories(locale).filter((category) => category.kind !== "bundles").map((category) => {
      const entries = catalog.filter((entry) => entry.category === category.id);
      return entries.length ? <CatalogSection key={category.id} id={category.id} label={category.label}>{entries.map(card)}</CatalogSection> : null;
    })}
  </section>;
}

function CatalogSection({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div data-lawoss-category={id} className="space-y-2">
    <h5 className="text-[11px] font-medium text-dls-secondary">{label}</h5>
    <div className="grid gap-3 sm:grid-cols-2">{children}</div>
  </div>;
}

const OKF_SKILLS = ["novy-spis", "okf-pamat", "usporiadaj-spis", "roztried-spis", "vystup-dokumentu"];

function installedPlugin(props: Pick<Props, "error" | "plugins">, entry: MarketplaceEntry) {
  return props.error ? undefined : props.plugins.find((plugin) => plugin.pluginId === catalogPluginId(entry));
}

function isPluginInstalled(props: Pick<Props, "error" | "plugins">, entry: MarketplaceEntry) {
  return Boolean(installedPlugin(props, entry));
}

/** Jurisdikcia z profilu onboardingu (len lokálny server); bez profilu Slovensko. */
function useOfficeJurisdiction(known: Jurisdiction | undefined): Jurisdiction {
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>(known ?? "sk");
  useEffect(() => {
    if (known) return;
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

/**
 * Odporúčané balíky LAWOSS z marketplace (SK základ, CZ základ). Predvolene zaškrtnuté je, čo
 * v balíku jurisdikcie kancelárie ešte chýba; ostatné balíky sa dajú pridať. Sťahuje sa
 * z GitHubu, preto až po kliknutí advokáta, nikdy potichu na pozadí.
 */
export function RecommendedBundlesPanel({ context }: { context: Props }) {
  const locale = useLocale();
  const jurisdiction = useOfficeJurisdiction(context.jurisdiction);
  const catalog = getMarketplaceCatalog(locale);
  const bundles = recommendedBundles();
  const office = new Set(officeBundles(jurisdiction).map((bundle) => bundle.id));
  const missingDefaults = bundles.filter((bundle) => office.has(bundle.id))
    .flatMap((bundle) => bundleEntries(bundle, catalog)).filter((entry) => !isPluginInstalled(context, entry)).map((entry) => entry.id);
  const defaultsKey = missingDefaults.join(",");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(missingDefaults));
  useEffect(() => { setSelected(new Set(defaultsKey ? defaultsKey.split(",") : [])); }, [defaultsKey]);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<BasePackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const permitted = Boolean(context.workspaceId) && context.canInstallPlugin;
  const all = bundles.flatMap((bundle) => bundleEntries(bundle, catalog));
  const chosen = all.filter((entry, index) => selected.has(entry.id) && !isPluginInstalled(context, entry) && all.findIndex((item) => item.id === entry.id) === index);
  const missingAny = all.some((entry) => !isPluginInstalled(context, entry));
  const nameOf = (id: string) => all.find((entry) => entry.id === id)?.name ?? id;
  const toggle = (id: string) => setSelected((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const install = async () => {
    setWorking(true); setResult(null); setError(null);
    try { setResult(await installBasePack(chosen, context)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setWorking(false); }
  };
  return <article data-lawoss-recommended={jurisdiction} className="space-y-3 rounded-xl border border-[rgba(201,162,74,0.35)] bg-[var(--lw-accent-soft)] p-4">
    <div className="space-y-1">
      <h4 className="text-sm font-semibold text-dls-text">{t("lawoss.integrations.base.title", locale)}</h4>
      <p className="max-w-prose text-sm text-dls-secondary">{t("lawoss.integrations.base.description", locale, { name: context.workspaceName || t("lawoss.integrations.catalog.workspace", locale) })}</p>
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
            const installed = isPluginInstalled(context, entry);
            return <li key={entry.id}>
              <label className="flex items-start gap-2 text-sm text-dls-text">
                <input type="checkbox" className="mt-0.5 accent-[var(--lw-gold)]" checked={installed || selected.has(entry.id)} disabled={installed || working} onChange={() => toggle(entry.id)} />
                <span className="min-w-0">
                  <span className="font-medium">{entry.name}</span>
                  {installed ? <span className="ml-2 text-xs text-dls-secondary">{t("lawoss.integrations.catalog.installed", locale)}</span> : null}
                </span>
              </label>
            </li>;
          })}
        </ul>
      </fieldset>)}
    </div>
    {!missingAny ? <p role="status" className="text-sm text-dls-secondary">{t("lawoss.integrations.base.all_installed", locale)}</p> : <div className="flex flex-wrap items-center gap-3">
      <Button disabled={working || context.busy || !permitted || chosen.length === 0} onClick={() => void install()}>
        {working ? t("lawoss.integrations.catalog.working", locale) : t("lawoss.integrations.base.install", locale)}
      </Button>
      {!permitted ? <p className="text-xs text-dls-secondary">{t("lawoss.integrations.catalog.permission_hint", locale)}</p> : null}
    </div>}
    {result?.installed.length ? <p role="status" className="text-sm text-dls-secondary">{t("lawoss.integrations.base.installed_list", locale, { names: result.installed.map(nameOf).join(", ") })}</p> : null}
    {result?.failed.length ? <p role="alert" className="text-sm text-red-11">{t("lawoss.integrations.base.failed_list", locale, { names: result.failed.map((item) => `${nameOf(item.id)} (${item.message})`).join("; ") })}</p> : null}
    {error ? <p role="alert" className="text-sm text-red-11">{error}</p> : null}
  </article>;
}

function CatalogCard({ entry, context, installed }: { entry: MarketplaceEntry; context: Props; installed: boolean }) {
  const locale = useLocale();
  const [preview, setPreview] = useState<LegalworkClaudePluginPreview | null>(null);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<InstallResult | null>(null);
  const permitted = Boolean(context.workspaceId) && (entry.install.action === "okf" ? context.canInstallSkills : context.canInstallPlugin);
  const disabled = working || context.busy || !permitted;
  const showPreview = async () => {
    setWorking(true); setStatus(null); setPreview(null);
    try { setPreview(await context.previewPlugin(catalogPluginUrl(entry))); }
    catch (error) { setStatus({ ok: false, message: error instanceof Error ? error.message : String(error) }); }
    finally { setWorking(false); }
  };
  const install = async () => {
    setWorking(true); setStatus(null);
    try { setStatus(await installCatalogEntry(entry, context)); }
    catch (error) { setStatus({ ok: false, message: error instanceof Error ? error.message : String(error) }); }
    finally { setWorking(false); }
  };
  return <article className="rounded-xl border border-dls-border bg-dls-surface p-4 space-y-3">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-dls-text">{entry.name}</h4>
        <p className="mt-1 flex gap-1">{entry.jurisdictions.map((code) => <span key={code} data-lawoss-jurisdiction={code} className="rounded-full border border-dls-border px-1.5 text-[10px] font-medium text-dls-secondary">{code}</span>)}</p>
      </div>
      {installed ? <span className="text-xs text-dls-secondary">{entry.install.action === "okf" ? t("lawoss.integrations.catalog.skills_saved", locale) : t("lawoss.integrations.catalog.installed", locale)}</span> : null}
    </div>
    <p className="text-sm text-dls-secondary">{entry.description}</p>
    <VersionLine entry={entry} context={context} />
    <details className="text-sm text-dls-secondary">
      <summary className="cursor-pointer text-dls-text">{t("lawoss.integrations.catalog.plan", locale)}</summary>
      <div className="mt-3 space-y-2">
        <p>{t("lawoss.integrations.catalog.scope", locale, { name: context.workspaceName || t("lawoss.integrations.catalog.workspace", locale) })}</p>
        <p className="break-all">{t("lawoss.integrations.catalog.source", locale, { source: `${entry.source.repository}@${entry.source.ref}` })}</p>
        <p>{t("lawoss.integrations.catalog.requires", locale, { dependencies: entry.dependencies.join(", ") })}</p>
        <p>{entry.humanGate}</p>
        {entry.install.action === "okf" ? <p>{t("lawoss.integrations.catalog.okf_install", locale)}</p> : <>
          <Button variant="outline" disabled={working || context.busy || !context.workspaceId} onClick={() => void showPreview()}>{t("lawoss.integrations.catalog.load_contents", locale)}</Button>
          {preview ? <div>
            <ul className="list-disc pl-5">{preview.components.map((component) => <li key={`${component.type}:${component.name}`}>{component.name} ({component.type})</li>)}</ul>
            {preview.warnings.map((warning) => <p key={warning} role="alert">{warning}</p>)}
          </div> : null}
        </>}
        {!permitted ? <p>{t("lawoss.integrations.catalog.permission_hint", locale)}</p> : null}
        <Button variant="outline" disabled={disabled || (entry.install.action === "plugin" && !preview)} onClick={() => void install()}>
          {working ? t("lawoss.integrations.catalog.working", locale) : installed ? t("lawoss.integrations.catalog.confirm_update", locale) : t("lawoss.integrations.catalog.confirm_install", locale)}
        </Button>
      </div>
    </details>
    {context.loading && entry.install.action === "plugin" ? <p role="status" className="text-xs text-dls-secondary">{t("lawoss.integrations.catalog.loading_status", locale)}</p> : null}
    {status ? <p role={status.ok ? "status" : "alert"} className="text-sm text-dls-secondary">{status.messageKey ? t(status.messageKey, locale) : status.message}</p> : null}
  </article>;
}

/** Verzia v katalógu a nainštalovaná verzia (bez siete). Pripravuje upozornenie na aktualizáciu. */
function VersionLine({ entry, context }: { entry: MarketplaceEntry; context: Props }) {
  const locale = useLocale();
  if (!entry.version) return null;
  const plugin = installedPlugin(context, entry);
  const installed = plugin ? installedProvenance(plugin) : null;
  const state = plugin ? catalogUpdateState(entry, plugin) : null;
  return <p data-lawoss-version={state ?? "available"} className="text-[11px] text-dls-secondary">
    {state === "newer" && installed?.version
      ? t("lawoss.integrations.catalog.version_newer", locale, { installed: installed.version, version: entry.version })
      : t("lawoss.integrations.catalog.version", locale, { version: entry.version })}
  </p>;
}
