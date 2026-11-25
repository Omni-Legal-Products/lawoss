import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { ChevronDown, CircleUserRound, Download, FileText } from "lucide-react";
import { resolveBrandIconSrc } from "@/react-app/design-system/extension-icon-src";
import { GoogleMark } from "../integrations/library-navigation";
import type { ImportedPlugin } from "../../../app/lib/extension-imports";
import type { LegalworkClaudePluginPreview } from "../../../app/lib/legalwork-server";
import type { Jurisdiction } from "../onboarding/api";
import { RecommendedBundlesPanel } from "./bundles-panel";
import { getMarketplaceCatalog, MARKETPLACE_SNAPSHOT, marketplaceCategories, type MarketplaceEntry } from "./catalog";
import { catalogUpdateState, installedProvenance } from "./installed-plugin";
import type { InstallOutcome, LawossMarketplaceApi, MarketplaceView } from "./marketplace-api";
import { catalogPluginId, catalogPluginUrl, installCatalogEntry, type CatalogActions, type InstallResult } from "./native-actions";
import { globalInstalledIds, installGlobalEntries, useLawossMarketplace } from "./use-lawoss-marketplace";
import { MarketplaceIntro } from "./marketplace-offer";
import { FileDecisionForm, LegacyInstallsPanel, MarketplaceUpdatesPanel, useGlobalRemove } from "./updates-panel";
import { filterCatalogEntries } from "./catalog-search";

export { RecommendedBundlesPanel } from "./bundles-panel";

type Props = CatalogActions & {
  workspaceName: string;
  busy: boolean;
  loading: boolean;
  error: unknown;
  plugins: ImportedPlugin[];
  skills?: ReadonlyArray<{ name: string; path: string; scope?: "global" | "project" }>;
  googleOnly?: boolean;
  previewPlugin: (url: string) => Promise<LegalworkClaudePluginPreview>;
  /** Jurisdikcia kancelárie, ak ju volajúci pozná (testy); inak sa načíta z profilu onboardingu. */
  jurisdiction?: Jurisdiction;
  /** Test seam; predvolene klient lokálneho servera (`/lawoss/marketplace`). */
  marketplaceApi?: LawossMarketplaceApi | null;
};

type Target = "global" | "workspace";

type CardContext = Props & {
  target: Target;
  api: LawossMarketplaceApi | null;
  view: MarketplaceView | null;
  refreshAll: () => Promise<void>;
};

/** Content only: native Settings owns workspace, permissions, install lifecycle and connection status. */
export function NativeCatalog(props: Props) {
  const locale = useLocale();
  const catalog = getMarketplaceCatalog(locale);
  const marketplace = useLawossMarketplace({ api: props.marketplaceApi, workspaceId: props.workspaceId || null, checkOnOpen: !props.googleOnly });
  const [target, setTarget] = useState<Target>("global");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "installed" | "available">("all");
  const globalReady = Boolean(marketplace.api);
  const effectiveTarget: Target = globalReady ? target : "workspace";
  const refreshAll = async () => {
    await Promise.allSettled([marketplace.refresh(), props.refresh()]);
  };
  const context: CardContext = { ...props, target: effectiveTarget, api: marketplace.api, view: marketplace.view, refreshAll };
  // The cloud plugin list merges two registries. The host view keeps their scopes separate.
  const installedGlobal = marketplace.view
    ? globalInstalledIds(marketplace.view, catalog)
    : new Set(catalog.filter(entry => installedPlugin(props, entry)?.scope === "global").map(entry => entry.id));
  const folderPlugins = marketplace.view?.workspace ?? (props.error ? [] : props.plugins.filter(plugin => !plugin.scope));
  const inFolder = (entry: MarketplaceEntry) => folderPlugins.some(plugin => plugin.pluginId === catalogPluginId(entry));
  const availableOkf = props.skills?.filter(skill => OKF_SKILLS.includes(skill.name));
  const hasInstall = (entry: MarketplaceEntry) => entry.install.action === "okf"
    ? Boolean(availableOkf?.length) : installedGlobal.has(entry.id) || inFolder(entry);
  const matchesFilter = (entry: MarketplaceEntry) => {
    if (filter === "all") return true;
    if (filter === "installed") return hasInstall(entry);
    if (hasInstall(entry)) return false;
    if (entry.install.action === "okf") return availableOkf?.length === 0;
    return (!globalReady || Boolean(marketplace.view)) && Boolean(props.workspaceId) && !props.loading && !props.error;
  };
  const filtered = props.googleOnly ? catalog.filter(entry => entry.id === "google-workspace-gog")
    : filterCatalogEntries(catalog, search).filter(matchesFilter);
  const targetPicker = <fieldset data-lawoss-target={effectiveTarget} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-dls-text">
        <legend className="mb-1 text-xs text-dls-secondary">{t("lawoss.marketplace.target.label", locale)}</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="lawoss-install-target" className="accent-[var(--lw-gold)]" checked={effectiveTarget === "global"} disabled={!globalReady} onChange={() => setTarget("global")} />
          {t("lawoss.marketplace.target.global", locale)}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="lawoss-install-target" className="accent-[var(--lw-gold)]" checked={effectiveTarget === "workspace"} onChange={() => setTarget("workspace")} />
          {t("lawoss.marketplace.target.workspace", locale, { name: props.workspaceName || t("lawoss.integrations.catalog.workspace", locale) })}
        </label>
      </fieldset>;
  const card = (entry: MarketplaceEntry) => <CatalogCard key={entry.id} entry={entry} context={context} targetPicker={props.googleOnly ? targetPicker : undefined}
    installedGlobal={installedGlobal.has(entry.id)}
    installed={entry.install.action === "okf" ? availableOkf?.length === OKF_SKILLS.length : inFolder(entry)} />;
  return <section aria-label={t("lawoss.integrations.catalog.title", locale)} data-lawoss-marketplace="" className="space-y-4">
    {!props.googleOnly ? <header>
      <h2 className="text-lg font-semibold text-dls-text">{MARKETPLACE_SNAPSHOT.name}</h2>
      <p className="mt-1 text-sm text-dls-secondary">{t("lawoss.marketplace.catalog.description", locale)}</p>
    </header> : null}
    {props.error ? <p role="alert" className="text-sm text-red-11">{t("lawoss.integrations.catalog.load_error", locale, { detail: props.error instanceof Error ? props.error.message : String(props.error) })}</p> : null}
    {!props.googleOnly ? <>
      <details className="rounded-xl border border-dls-border bg-dls-surface p-3">
        <summary className="cursor-pointer text-sm font-medium">{t("lawoss.integrations.base.title", locale)}</summary>
        <div className="mt-3"><RecommendedBundlesPanel embedded jurisdiction={props.jurisdiction} installed={installedGlobal} permitted={globalReady} busy={props.busy}
          install={(entries) => installGlobalEntries(marketplace.api!, entries)} onInstalled={refreshAll} /></div>
      </details>
      <MarketplaceUpdatesPanel api={marketplace.api} view={marketplace.view} checking={marketplace.checking} error={marketplace.error}
        onCheck={() => void marketplace.check("manual")}
        onWeeklyChange={(enabled) => void marketplace.setWeeklyCheck(enabled)}
        onChanged={refreshAll} />
      <LegacyInstallsPanel api={marketplace.api} workspaceId={props.workspaceId} workspaceName={props.workspaceName}
        plugins={marketplace.view?.workspace ?? []} onChanged={refreshAll} />
    </> : null}
    {!props.googleOnly ? <div className="space-y-3 rounded-xl border border-dls-border bg-dls-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant={filter === "all" ? "secondary" : "ghost"} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{t("lawoss.integrations.catalog.all_title", locale)}</Button>
          <Button size="sm" variant={filter === "available" ? "secondary" : "ghost"} aria-pressed={filter === "available"} onClick={() => setFilter("available")}>{t("lawoss.integrations.install_available", locale)}</Button>
          <Button size="sm" variant={filter === "installed" ? "secondary" : "ghost"} aria-pressed={filter === "installed"} onClick={() => setFilter("installed")}>{t("catalog.installed", locale)}</Button>
        </div>
        <Input type="search" className="w-full sm:max-w-64" value={search} onChange={event => setSearch(event.target.value)}
          aria-label={t("lawoss.integrations.catalog.search", locale)} placeholder={t("lawoss.integrations.catalog.search", locale)} />
      </div>
      {targetPicker}
    </div> : null}
    {!filtered.length ? <p role="status" className="py-3 text-sm text-dls-secondary">{t("lawoss.integrations.catalog.no_matches", locale)}</p> : null}
    {props.googleOnly ? filtered.map(card) : <>
    {filtered.some(entry => entry.install.action === "okf") ? <CatalogSection id="bundled" label={t("lawoss.integrations.catalog.bundled_section", locale)}>
      {filtered.filter((entry) => entry.install.action === "okf").map(card)}
    </CatalogSection> : null}
    {marketplaceCategories(locale).filter((category) => category.kind !== "bundles").map((category) => {
      const entries = filtered.filter((entry) => entry.category === category.id);
      return entries.length ? <CatalogSection key={category.id} id={category.id} label={category.label}>{entries.map(card)}</CatalogSection> : null;
    })}
    <MarketplaceIntro />
    </>}
  </section>;
}

function CatalogSection({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return <div data-lawoss-category={id} className="space-y-2 border-t border-dls-border pt-4">
    <h5 className="text-sm font-semibold text-dls-text">{label}</h5>
    <div className="grid gap-2 @min-[850px]/integrations:grid-cols-2">{children}</div>
  </div>;
}

const OKF_SKILLS = ["novy-spis", "okf-pamat", "usporiadaj-spis", "roztried-spis", "vystup-dokumentu"];

function installedPlugin(props: Pick<Props, "error" | "plugins">, entry: MarketplaceEntry) {
  return props.error ? undefined : props.plugins.find((plugin) => plugin.pluginId === catalogPluginId(entry));
}

function CatalogCard({ entry, context, installed, installedGlobal, targetPicker }: { targetPicker?: ReactNode; entry: MarketplaceEntry; context: CardContext; installed: boolean; installedGlobal: boolean }) {
  const locale = useLocale();
  const [preview, setPreview] = useState<LegalworkClaudePluginPreview | null>(null);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<InstallResult | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const removal = useGlobalRemove(context.api, context.refreshAll);
  const okf = entry.install.action === "okf";
  const google = entry.id === "google-workspace-gog";
  const okfCount = context.skills?.filter(skill => OKF_SKILLS.includes(skill.name)).length;
  const global = entry.install.action === "plugin" && context.target === "global";
  const statusKnown = global ? Boolean(context.view) : Boolean(context.workspaceId) && !context.loading && !context.error;
  const permitted = global
    ? Boolean(context.api)
    : Boolean(context.workspaceId) && (entry.install.action === "okf" ? context.canInstallSkills : context.canInstallPlugin);
  const disabled = working || context.busy || !permitted;
  const showPreview = async () => {
    setWorking(true); setStatus(null); setPreview(null);
    try { setPreview(await context.previewPlugin(catalogPluginUrl(entry))); }
    catch (error) { setStatus({ ok: false, message: error instanceof Error ? error.message : String(error) }); }
    finally { setWorking(false); }
  };
  const install = async () => {
    setWorking(true); setStatus(null);
    try {
      if (global && context.api) {
        const outcome = await context.api.install(catalogPluginUrl(entry));
        await context.refreshAll();
        setStatus({ ok: true, message: installMessage(outcome, locale) });
      } else {
        setStatus(await installCatalogEntry(entry, context));
      }
    }
    catch (error) { setStatus({ ok: false, message: error instanceof Error ? error.message : String(error) }); }
    finally { setWorking(false); }
  };
  const uninstall = async () => {
    setWorking(true); setStatus(null);
    try {
      const backups = await removal.remove(catalogPluginId(entry), entry.name);
      if (backups.length) setStatus({ ok: true, message: t("lawoss.marketplace.updates.backups_note", locale, { files: backups.join(", ") }) });
    }
    catch (error) { setStatus({ ok: false, message: error instanceof Error ? error.message : String(error) }); }
    finally { setWorking(false); }
  };
  const confirmLabel = global
    ? t("lawoss.marketplace.target.confirm_global", locale)
    : okf && Boolean(okfCount) ? t("lawoss.integrations.okf_restore", locale)
    : installed ? t("lawoss.integrations.catalog.confirm_update", locale) : t("lawoss.integrations.catalog.confirm_install", locale);
  const installStatus = <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-dls-secondary [&>span]:rounded-md [&>span]:bg-muted [&>span]:px-2 [&>span]:py-0.5">
        {google && !installedGlobal && !installed ? <span>{t(statusKnown ? "lawoss.integrations.install_available" : "lawoss.integrations.install_unknown", locale)}</span> : null}
        {installedGlobal ? <span data-lawoss-installed="global">{t("lawoss.marketplace.badge.global", locale)}</span> : null}
        {installed && !okf ? <span data-lawoss-installed="workspace">{installedGlobal ? t("lawoss.marketplace.badge.workspace", locale) : t("lawoss.integrations.catalog.installed", locale)}</span> : null}
      </div>;
  return <article data-lawoss-entry={entry.id} className={context.googleOnly
    ? "overflow-hidden rounded-2xl border border-dls-border bg-dls-surface shadow-sm"
    : "min-w-0 space-y-2 rounded-xl border border-dls-border bg-dls-surface p-3.5"}>
    {context.googleOnly ? <div className="space-y-5 border-b border-dls-border p-5 sm:p-7" style={{ backgroundImage: "linear-gradient(115deg, rgb(66 133 244 / 15%), rgb(66 133 244 / 4%) 60%, var(--lw-accent-soft))" }}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="grid size-14 shrink-0 place-items-center rounded-2xl border border-blue-500/20 bg-background shadow-sm sm:size-16 [&>img]:size-8 sm:[&>img]:size-9"><GoogleMark /></div>
          <h2 className="text-xl font-semibold tracking-tight text-dls-text sm:text-2xl">{entry.name}</h2>
        </div>
        {installStatus}
      </div>
      <p className="max-w-2xl text-sm leading-relaxed text-dls-secondary">{t("lawoss.integrations.gog_summary", locale)}</p>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-dls-text">
        {[{ slug: "gmail", name: "Gmail" }, { slug: "googlecalendar", name: t("lawoss.integrations.gog_calendar", locale) }, { slug: "googledrive", name: t("lawoss.integrations.gog_drive", locale) }].map(service =>
          <span key={service.slug} className="inline-flex items-center gap-1.5"><img alt="" className="size-4" src={resolveBrandIconSrc(undefined, service.slug)} />{service.name}</span>)}
        <span className="inline-flex items-center gap-1.5"><FileText className="size-4 text-blue-500" aria-hidden />{t("lawoss.integrations.gog_docs", locale)}</span>
      </div>
    </div> : <>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-dls-text">{google ? <GoogleMark /> : null}{entry.name}</h4>
          <p className="mt-1 flex gap-1">{entry.jurisdictions.map((code) => <span key={code} data-lawoss-jurisdiction={code} className="rounded-full border border-dls-border px-1.5 text-[10px] font-medium text-dls-secondary">{code}</span>)}</p>
        </div>
        {installStatus}
      </div>
      <p className="text-sm text-dls-secondary">{entry.description}</p>
    </>}
    <div className={context.googleOnly ? "space-y-5 p-5 sm:p-7" : "space-y-2"}>
    {google ? <div className="flex items-start gap-3 rounded-xl border border-dls-border bg-muted/25 p-3.5 text-sm text-dls-secondary">
      <CircleUserRound className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold text-dls-text">{t("lawoss.integrations.gog_account", locale)}</p>
        <p className="mt-1 leading-relaxed">{t("lawoss.integrations.gog_check", locale)} <code className="inline-block select-all rounded border border-border bg-background px-1.5 text-xs text-dls-text">gog auth list --check</code></p>
      </div>
    </div> : null}
    {okf ? <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-dls-secondary">
      <p className="font-medium text-dls-text">{okfCount === undefined ? t("lawoss.integrations.okf_unknown", locale) : t("lawoss.integrations.okf_available", locale, { count: okfCount, total: OKF_SKILLS.length })}</p>
      <p className="mt-1">{t("lawoss.integrations.okf_scope", locale, { name: context.workspaceName || t("lawoss.integrations.catalog.workspace", locale) })}</p>
    </div> : null}
    <VersionLine entry={entry} context={context} />
    <details className="text-sm text-dls-secondary">
      {context.googleOnly ? <summary className="inline-flex cursor-pointer list-none items-center gap-2 rounded-full border border-[var(--lw-gold)] bg-[var(--lw-accent-soft)] px-4 py-2 font-medium text-dls-text hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <Download aria-hidden className="size-4" />{t(installed || installedGlobal ? "lawoss.integrations.gog_manage" : "lawoss.integrations.gog_install", locale)}<ChevronDown aria-hidden className="size-3.5" />
      </summary> : <summary className="cursor-pointer text-dls-text">{t("lawoss.integrations.catalog.plan", locale)}</summary>}
      <div className="mt-3 space-y-2">
        {targetPicker}
        <p>{global ? t("lawoss.marketplace.target.scope_global", locale) : t("lawoss.integrations.catalog.scope", locale, { name: context.workspaceName || t("lawoss.integrations.catalog.workspace", locale) })}</p>
        <p className="break-all">{t("lawoss.integrations.catalog.source", locale, { source: `${entry.source.repository}@${entry.source.ref}` })}</p>
        {entry.dependencies.length ? <p>{t("lawoss.integrations.catalog.requires", locale, { dependencies: entry.dependencies.join(", ") })}</p> : null}
        <p>{entry.humanGate}</p>
        {entry.install.action === "okf" ? <p>{t("lawoss.integrations.catalog.okf_install", locale)}</p> : <>
          <Button variant="outline" disabled={working || context.busy || !context.workspaceId} onClick={() => void showPreview()}>{t("lawoss.integrations.catalog.load_contents", locale)}</Button>
          {preview ? <div>
            <ul className="list-disc pl-5">{preview.components.map((component) => <li key={`${component.type}:${component.name}`}>{component.name} ({component.type})</li>)}</ul>
            {preview.warnings.map((warning) => <p key={warning} role="alert">{warning}</p>)}
          </div> : null}
        </>}
        {!permitted ? <p>{t("lawoss.integrations.catalog.permission_hint", locale)}</p> : null}
        {global && installedGlobal ? null : <Button variant="outline" disabled={disabled || (entry.install.action === "plugin" && !preview && !global)} onClick={() => void install()}>
          {working ? t("lawoss.integrations.catalog.working", locale) : confirmLabel}
        </Button>}
        {installedGlobal && context.api ? <GlobalRemoveAction name={entry.name} locale={locale} disabled={working || !context.api} confirming={confirmRemove}
          onRequest={() => setConfirmRemove(true)} onCancel={() => setConfirmRemove(false)}
          onConfirm={() => { setConfirmRemove(false); void uninstall(); }} /> : null}
        {removal.queue.pending.map((item) => <FileDecisionForm key={item.id} title={item.title} changes={item.changes} mode={item.mode}
          onCancel={() => removal.queue.done(item.id)}
          onConfirm={(resolutions) => void item.retry(resolutions).catch((error: unknown) => setStatus({ ok: false, message: error instanceof Error ? error.message : String(error) }))} />)}
      </div>
    </details>
    {context.loading && entry.install.action === "plugin" ? <p role="status" className="text-xs text-dls-secondary">{t("lawoss.integrations.catalog.loading_status", locale)}</p> : null}
    {status ? <p role={status.ok ? "status" : "alert"} className="text-sm text-dls-secondary">{status.messageKey ? t(status.messageKey, locale) : status.message}</p> : null}
    </div>
  </article>;
}

/**
 * Odinštalovanie pre všetkých klientov (#255): tlačidlo len otvorí potvrdenie, doplnok sa odstráni až po ňom.
 * Upravené súbory potom ešte rieši `FileDecisionForm` (zálohovať alebo zahodiť).
 */
export function GlobalRemoveAction({ name, locale, disabled, confirming, onRequest, onCancel, onConfirm }: {
  name: string;
  locale: Language;
  disabled: boolean;
  confirming: boolean;
  onRequest: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return <>
    <Button variant="ghost" disabled={disabled} onClick={onRequest}>{t("lawoss.marketplace.remove.global", locale)}</Button>
    <ConfirmModal open={confirming} variant="danger"
      title={t("lawoss.marketplace.remove.confirm_title", locale, { name })}
      message={t("lawoss.marketplace.remove.confirm_description", locale)}
      confirmLabel={t("lawoss.marketplace.remove.global", locale)}
      cancelLabel={t("lawoss.marketplace.decision.cancel", locale)}
      onCancel={onCancel} onConfirm={onConfirm} />
  </>;
}

/** #510: inštalácia už nainštalovaného doplnku verziu nemení; novšiu verziu povie a pošle do Aktualizácií. */
export function installMessage(outcome: InstallOutcome, locale: Language): string {
  const update = outcome.update;
  const base = outcome.status === "installed"
    ? t("lawoss.marketplace.status.installed_global", locale)
    : update ? t("lawoss.marketplace.status.already_global_version", locale, { installed: update.installed ?? "?" }) : t("lawoss.marketplace.status.already_global", locale);
  return update ? `${base} ${t("lawoss.marketplace.status.update_available", locale, { available: update.available })}` : base;
}

/** Verzia v katalógu a nainštalovaná verzia (bez siete). */
function VersionLine({ entry, context }: { entry: MarketplaceEntry; context: CardContext }) {
  const locale = useLocale();
  if (!entry.version) return null;
  const plugin = context.view?.global.find((item) => item.pluginId === catalogPluginId(entry)) ?? installedPlugin(context, entry);
  const installed = plugin ? installedProvenance(plugin) : null;
  const state = plugin ? catalogUpdateState(entry, plugin) : null;
  // #510: the server offers the update (release or bundled catalog); the card points to it.
  const updatable = Boolean(plugin && context.view?.updates.some((update) => update.pluginId === plugin.pluginId));
  return <p data-lawoss-version={state ?? "available"} className="text-[11px] text-dls-secondary">
    {state === "newer" && installed?.version
      ? t("lawoss.integrations.catalog.version_newer", locale, { installed: installed.version, version: entry.version })
      : t("lawoss.integrations.catalog.version", locale, { version: entry.version })}
    {updatable ? <span data-lawoss-update-hint="" className="ml-1">{t("lawoss.integrations.catalog.version_update_hint", locale)}</span> : null}
  </p>;
}
