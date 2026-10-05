import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { SkillCard } from "../../../app/types";
import type { ImportedPlugin } from "../../../app/lib/extension-imports";
import type { LegalworkClaudePluginPreview } from "../../../app/lib/legalwork-server";
import type { Jurisdiction } from "../onboarding/api";
import { RecommendedBundlesPanel } from "./bundles-panel";
import { getMarketplaceCatalog, MARKETPLACE_SNAPSHOT, marketplaceCategories, type MarketplaceEntry } from "./catalog";
import { catalogUpdateState, installedProvenance } from "./installed-plugin";
import type { LawossMarketplaceApi, MarketplaceView } from "./marketplace-api";
import { catalogPluginId, catalogPluginUrl, installCatalogEntry, type CatalogActions, type InstallResult } from "./native-actions";
import { globalInstalledIds, installGlobalEntries, useLawossMarketplace } from "./use-lawoss-marketplace";
import { FileDecisionForm, LegacyInstallsPanel, MarketplaceUpdatesPanel, useGlobalRemove } from "./updates-panel";

export { RecommendedBundlesPanel } from "./bundles-panel";

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
  const marketplace = useLawossMarketplace({ api: props.marketplaceApi, workspaceId: props.workspaceId || null, checkOnOpen: true });
  const [target, setTarget] = useState<Target>("global");
  const globalReady = Boolean(marketplace.api);
  const effectiveTarget: Target = globalReady ? target : "workspace";
  const refreshAll = async () => {
    await Promise.allSettled([marketplace.refresh(), props.refresh()]);
  };
  const context: CardContext = { ...props, target: effectiveTarget, api: marketplace.api, view: marketplace.view, refreshAll };
  const installedGlobal = globalInstalledIds(marketplace.view, catalog);
  const card = (entry: MarketplaceEntry) => <CatalogCard key={entry.id} entry={entry} context={context}
    installedGlobal={installedGlobal.has(entry.id)}
    installed={entry.install.action === "okf"
      ? OKF_SKILLS.every((name) => props.skills.some((skill) => skill.name === name))
      : isPluginInstalled(props, entry)} />;
  return <section aria-label={t("lawoss.integrations.catalog.title", locale)} data-lawoss-marketplace="" className="space-y-4">
    <div>
      <h3 className="text-base font-medium text-dls-text">{MARKETPLACE_SNAPSHOT.name}</h3>
      <p className="text-sm text-dls-secondary">{t("lawoss.marketplace.catalog.description", locale)}</p>
    </div>
    {props.error ? <p role="alert" className="text-sm text-red-11">{t("lawoss.integrations.catalog.load_error", locale, { detail: props.error instanceof Error ? props.error.message : String(props.error) })}</p> : null}
    <MarketplaceUpdatesPanel api={marketplace.api} view={marketplace.view} checking={marketplace.checking} error={marketplace.error}
      onCheck={() => void marketplace.check("manual")}
      onWeeklyChange={(enabled) => void marketplace.setWeeklyCheck(enabled)}
      onChanged={refreshAll} />
    <LegacyInstallsPanel api={marketplace.api} workspaceId={props.workspaceId} workspaceName={props.workspaceName}
      plugins={marketplace.view?.workspace ?? []} onChanged={refreshAll} />
    <div className="rounded-xl border border-[rgba(201,162,74,0.35)] bg-[var(--lw-accent-soft)] p-4">
      <h4 className="mb-3 text-sm font-semibold text-dls-text">{t("lawoss.integrations.base.title", locale)}</h4>
      <RecommendedBundlesPanel embedded jurisdiction={props.jurisdiction} installed={installedGlobal} permitted={globalReady} busy={props.busy}
        install={(entries) => installGlobalEntries(marketplace.api!, entries)} onInstalled={refreshAll} />
    </div>
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-dls-text">{t("lawoss.integrations.catalog.all_title", locale)}</h4>
      <p className="text-sm text-dls-secondary">{t("lawoss.integrations.catalog.all_description", locale)}</p>
      <fieldset data-lawoss-target={effectiveTarget} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-dls-text">
        <legend className="mb-1 text-xs text-dls-secondary">{t("lawoss.marketplace.target.label", locale)}</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="lawoss-install-target" className="accent-[var(--lw-gold)]" checked={effectiveTarget === "global"} disabled={!globalReady} onChange={() => setTarget("global")} />
          {t("lawoss.marketplace.target.global", locale)}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="lawoss-install-target" className="accent-[var(--lw-gold)]" checked={effectiveTarget === "workspace"} onChange={() => setTarget("workspace")} />
          {t("lawoss.marketplace.target.workspace", locale, { name: props.workspaceName || t("lawoss.integrations.catalog.workspace", locale) })}
        </label>
      </fieldset>
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

function CatalogCard({ entry, context, installed, installedGlobal }: { entry: MarketplaceEntry; context: CardContext; installed: boolean; installedGlobal: boolean }) {
  const locale = useLocale();
  const [preview, setPreview] = useState<LegalworkClaudePluginPreview | null>(null);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<InstallResult | null>(null);
  const removal = useGlobalRemove(context.api, context.refreshAll);
  const global = entry.install.action === "plugin" && context.target === "global";
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
        setStatus({ ok: true, message: outcome.status === "installed" ? t("lawoss.marketplace.status.installed_global", locale) : t("lawoss.marketplace.status.already_global", locale) });
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
    : installed ? t("lawoss.integrations.catalog.confirm_update", locale) : t("lawoss.integrations.catalog.confirm_install", locale);
  return <article className="rounded-xl border border-dls-border bg-dls-surface p-4 space-y-3">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <h4 className="text-sm font-semibold text-dls-text">{entry.name}</h4>
        <p className="mt-1 flex gap-1">{entry.jurisdictions.map((code) => <span key={code} data-lawoss-jurisdiction={code} className="rounded-full border border-dls-border px-1.5 text-[10px] font-medium text-dls-secondary">{code}</span>)}</p>
      </div>
      <div className="flex flex-col items-end gap-0.5 text-xs text-dls-secondary">
        {installedGlobal ? <span data-lawoss-installed="global">{t("lawoss.marketplace.badge.global", locale)}</span> : null}
        {installed ? <span data-lawoss-installed="workspace">{entry.install.action === "okf" ? t("lawoss.integrations.catalog.skills_saved", locale) : installedGlobal ? t("lawoss.marketplace.badge.workspace", locale) : t("lawoss.integrations.catalog.installed", locale)}</span> : null}
      </div>
    </div>
    <p className="text-sm text-dls-secondary">{entry.description}</p>
    <VersionLine entry={entry} context={context} />
    <details className="text-sm text-dls-secondary">
      <summary className="cursor-pointer text-dls-text">{t("lawoss.integrations.catalog.plan", locale)}</summary>
      <div className="mt-3 space-y-2">
        <p>{global ? t("lawoss.marketplace.target.scope_global", locale) : t("lawoss.integrations.catalog.scope", locale, { name: context.workspaceName || t("lawoss.integrations.catalog.workspace", locale) })}</p>
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
        {global && installedGlobal ? null : <Button variant="outline" disabled={disabled || (entry.install.action === "plugin" && !preview && !global)} onClick={() => void install()}>
          {working ? t("lawoss.integrations.catalog.working", locale) : confirmLabel}
        </Button>}
        {installedGlobal ? <Button variant="ghost" disabled={working || !context.api} onClick={() => void uninstall()}>{t("lawoss.marketplace.remove.global", locale)}</Button> : null}
        {removal.queue.pending.map((item) => <FileDecisionForm key={item.id} title={item.title} changes={item.changes} mode={item.mode}
          onCancel={() => removal.queue.done(item.id)}
          onConfirm={(resolutions) => void item.retry(resolutions).catch((error: unknown) => setStatus({ ok: false, message: error instanceof Error ? error.message : String(error) }))} />)}
      </div>
    </details>
    {context.loading && entry.install.action === "plugin" ? <p role="status" className="text-xs text-dls-secondary">{t("lawoss.integrations.catalog.loading_status", locale)}</p> : null}
    {status ? <p role={status.ok ? "status" : "alert"} className="text-sm text-dls-secondary">{status.messageKey ? t(status.messageKey, locale) : status.message}</p> : null}
  </article>;
}

/** Verzia v katalógu a nainštalovaná verzia (bez siete). */
function VersionLine({ entry, context }: { entry: MarketplaceEntry; context: CardContext }) {
  const locale = useLocale();
  if (!entry.version) return null;
  const plugin = context.view?.global.find((item) => item.pluginId === catalogPluginId(entry)) ?? installedPlugin(context, entry);
  const installed = plugin ? installedProvenance(plugin) : null;
  const state = plugin ? catalogUpdateState(entry, plugin) : null;
  return <p data-lawoss-version={state ?? "available"} className="text-[11px] text-dls-secondary">
    {state === "newer" && installed?.version
      ? t("lawoss.integrations.catalog.version_newer", locale, { installed: installed.version, version: entry.version })
      : t("lawoss.integrations.catalog.version", locale, { version: entry.version })}
  </p>;
}
