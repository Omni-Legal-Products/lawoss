import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { SkillCard } from "../../../app/types";
import type { ImportedPlugin } from "../../../app/lib/extension-imports";
import type { LegalworkClaudePluginPreview } from "../../../app/lib/legalwork-server";
import { getMarketplaceCatalog, type MarketplaceEntry } from "./catalog";
import { catalogPluginId, catalogPluginUrl, installCatalogEntry, type CatalogActions, type InstallResult } from "./native-actions";

type Props = CatalogActions & {
  workspaceName: string;
  busy: boolean;
  loading: boolean;
  error: unknown;
  plugins: ImportedPlugin[];
  skills: SkillCard[];
  previewPlugin: (url: string) => Promise<LegalworkClaudePluginPreview>;
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
    <div className="grid gap-3 sm:grid-cols-2">
      {getMarketplaceCatalog(locale).map((entry) => <CatalogCard key={entry.id} entry={entry} context={props}
        installed={entry.install.action === "okf"
          ? ["novy-spis", "okf-pamat", "usporiadaj-spis"].every((name) => props.skills.some((skill) => skill.name === name))
          : !props.error && props.plugins.some((plugin) => plugin.pluginId === catalogPluginId(entry))} />)}
    </div>
  </section>;
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
      <h4 className="text-sm font-semibold text-dls-text">{entry.name}</h4>
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
