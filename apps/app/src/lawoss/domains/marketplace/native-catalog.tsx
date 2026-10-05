import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { SkillCard } from "../../../app/types";
import type { ImportedPlugin } from "../../../app/lib/extension-imports";
import type { LegalworkClaudePluginPreview } from "../../../app/lib/legalwork-server";
import type { Jurisdiction } from "../onboarding/api";
import { basePackEntries, PROVISIONAL_BASE_PACK } from "./base-pack";
import { getMarketplaceCatalog, type MarketplaceEntry } from "./catalog";
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
  return <section aria-label={t("lawoss.integrations.catalog.title", locale)} className="space-y-3">
    <div>
      <h3 className="text-base font-medium text-dls-text">LAWOSS</h3>
      <p className="text-sm text-dls-secondary">{t("lawoss.integrations.catalog.description", locale, { name: props.workspaceName })}</p>
    </div>
    {props.error ? <p role="alert" className="text-sm text-red-11">{t("lawoss.integrations.catalog.load_error", locale, { detail: props.error instanceof Error ? props.error.message : String(props.error) })}</p> : null}
    <BasePackPanel context={props} />
    <div>
      <h4 className="text-sm font-semibold text-dls-text">{t("lawoss.integrations.catalog.all_title", locale)}</h4>
      <p className="text-sm text-dls-secondary">{t("lawoss.integrations.catalog.all_description", locale)}</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      {getMarketplaceCatalog(locale).map((entry) => <CatalogCard key={entry.id} entry={entry} context={props}
        installed={entry.install.action === "okf"
          ? OKF_SKILLS.every((name) => props.skills.some((skill) => skill.name === name))
          : isPluginInstalled(props, entry)} />)}
    </div>
  </section>;
}

const OKF_SKILLS = ["novy-spis", "okf-pamat", "usporiadaj-spis", "roztried-spis", "vystup-dokumentu"];

function isPluginInstalled(props: Pick<Props, "error" | "plugins">, entry: MarketplaceEntry) {
  return !props.error && props.plugins.some((plugin) => plugin.pluginId === catalogPluginId(entry));
}

/** Jurisdikcia z profilu onboardingu (len lokálny server); bez profilu Slovensko. */
function useOfficeJurisdiction(known: Jurisdiction | undefined): [Jurisdiction, (next: Jurisdiction) => void] {
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
  return [jurisdiction, setJurisdiction];
}

const JURISDICTION_LABELS: Record<Jurisdiction, string> = {
  sk: "lawoss.integrations.base.jurisdiction_sk",
  cz: "lawoss.integrations.base.jurisdiction_cz",
};

/**
 * Základný balík podľa jurisdikcie kancelárie: predvolene zaškrtnuté, čo v priečinku ešte chýba.
 * Sťahuje sa z GitHubu, preto až po kliknutí advokáta, nikdy potichu na pozadí.
 */
export function BasePackPanel({ context }: { context: Props }) {
  const locale = useLocale();
  const [jurisdiction, setJurisdiction] = useOfficeJurisdiction(context.jurisdiction);
  const catalog = getMarketplaceCatalog(locale);
  const entries = basePackEntries(jurisdiction, catalog);
  const missing = entries.filter((entry) => !isPluginInstalled(context, entry));
  const missingKey = missing.map((entry) => entry.id).join(",");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(missing.map((entry) => entry.id)));
  useEffect(() => { setSelected(new Set(missingKey ? missingKey.split(",") : [])); }, [missingKey]);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<BasePackResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const permitted = Boolean(context.workspaceId) && context.canInstallPlugin;
  const chosen = missing.filter((entry) => selected.has(entry.id));
  const nameOf = (id: string) => entries.find((entry) => entry.id === id)?.name ?? id;
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
  return <article data-lawoss-base-pack={jurisdiction} className="space-y-3 rounded-xl border border-[rgba(201,162,74,0.35)] bg-[var(--lw-accent-soft)] p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h4 className="text-sm font-semibold text-dls-text">{t("lawoss.integrations.base.title", locale)}</h4>
        <p className="max-w-prose text-sm text-dls-secondary">{t("lawoss.integrations.base.description", locale, { jurisdiction: t(JURISDICTION_LABELS[jurisdiction], locale), name: context.workspaceName || t("lawoss.integrations.catalog.workspace", locale) })}</p>
        {PROVISIONAL_BASE_PACK.has(jurisdiction) ? <p className="text-xs text-dls-secondary">{t("lawoss.integrations.base.provisional", locale)}</p> : null}
      </div>
      <div role="radiogroup" aria-label={t("lawoss.integrations.base.jurisdiction_label", locale)} className="inline-flex shrink-0 rounded-full border border-dls-border p-0.5 text-xs">
        {(["sk", "cz"] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={jurisdiction === value}
          className={`rounded-full px-3 py-1 ${jurisdiction === value ? "bg-dls-surface font-medium text-dls-text" : "text-dls-secondary"}`}
          onClick={() => setJurisdiction(value)}>{t(JURISDICTION_LABELS[value], locale)}</button>)}
      </div>
    </div>
    <ul className="grid gap-2 sm:grid-cols-2">
      {entries.map((entry) => {
        const installed = isPluginInstalled(context, entry);
        return <li key={entry.id}>
          <label className="flex items-start gap-2 text-sm text-dls-text">
            <input type="checkbox" className="mt-0.5 accent-[var(--lw-gold)]" checked={installed || selected.has(entry.id)} disabled={installed || working} onChange={() => toggle(entry.id)} />
            <span className="min-w-0">
              <span className="font-medium">{entry.name}</span>
              {installed ? <span className="ml-2 text-xs text-dls-secondary">{t("lawoss.integrations.catalog.installed", locale)}</span> : null}
              <span className="block text-xs text-dls-secondary">{entry.description}</span>
            </span>
          </label>
        </li>;
      })}
    </ul>
    {missing.length === 0 && entries.length > 0 ? <p role="status" className="text-sm text-dls-secondary">{t("lawoss.integrations.base.all_installed", locale)}</p> : <div className="flex flex-wrap items-center gap-3">
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
