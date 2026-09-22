import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { SkillCard } from "../../../app/types";
import type { ImportedPlugin } from "../../../app/lib/extension-imports";
import type { LegalworkClaudePluginPreview } from "../../../app/lib/legalwork-server";
import { MARKETPLACE_CATALOG, type MarketplaceEntry } from "./catalog";
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
  return <section aria-label="LAWOSS katalóg" className="space-y-3">
    <div>
      <h3 className="text-base font-medium text-dls-text">LAWOSS</h3>
      <p className="text-sm text-dls-secondary">Balíky pre pracovný priečinok {props.workspaceName}. Tento import zatiaľ nepodporuje globálnu inštaláciu. Stav pripojenia MCP je v záložke Konektory.</p>
    </div>
    {props.error ? <p role="alert" className="text-sm text-red-11">Zoznam nainštalovaných balíkov sa nepodarilo načítať: {props.error instanceof Error ? props.error.message : String(props.error)}</p> : null}
    <div className="grid gap-3 sm:grid-cols-2">
      {MARKETPLACE_CATALOG.map((entry) => <CatalogCard key={entry.id} entry={entry} context={props}
        installed={entry.install.action === "okf"
          ? ["novy-spis", "okf-pamat", "usporiadaj-spis"].every((name) => props.skills.some((skill) => skill.name === name))
          : !props.error && props.plugins.some((plugin) => plugin.pluginId === catalogPluginId(entry))} />)}
    </div>
  </section>;
}

function CatalogCard({ entry, context, installed }: { entry: MarketplaceEntry; context: Props; installed: boolean }) {
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
      {installed ? <span className="text-xs text-dls-secondary">{entry.install.action === "okf" ? "Skilly uložené" : "Nainštalované"}</span> : null}
    </div>
    <p className="text-sm text-dls-secondary">{entry.description}</p>
    <details className="text-sm text-dls-secondary">
      <summary className="cursor-pointer text-dls-text">Rozsah a plán inštalácie</summary>
      <div className="mt-3 space-y-2">
        <p>Rozsah: {context.workspaceName || "pracovný priečinok"}. Balík je v testovaní.</p>
        <p className="break-all">Zdroj: {entry.source.repository}@{entry.source.ref}</p>
        <p>Vyžaduje: {entry.dependencies.join(", ")}.</p>
        <p>{entry.humanGate}</p>
        {entry.install.action === "okf" ? <p>Uloží alebo aktualizuje tri skilly /novy-spis, /okf-pamat a /usporiadaj-spis a ich CLI resources. Samotná inštalácia nevytvára vec.</p> : <>
          <Button variant="outline" disabled={working || context.busy || !context.workspaceId} onClick={() => void showPreview()}>Načítať obsah balíka</Button>
          {preview ? <div>
            <ul className="list-disc pl-5">{preview.components.map((component) => <li key={`${component.type}:${component.name}`}>{component.name} ({component.type})</li>)}</ul>
            {preview.warnings.map((warning) => <p key={warning} role="alert">{warning}</p>)}
          </div> : null}
        </>}
        {!permitted ? <p>Inštalácia vyžaduje dostupný priečinok a oprávnenie na zápis.</p> : null}
        <Button variant="outline" disabled={disabled || (entry.install.action === "plugin" && !preview)} onClick={() => void install()}>
          {working ? "Pracujem…" : installed ? "Potvrdiť aktualizáciu balíka" : "Potvrdiť inštaláciu do priečinka"}
        </Button>
      </div>
    </details>
    {context.loading && entry.install.action === "plugin" ? <p role="status" className="text-xs text-dls-secondary">Načítavam stav inštalácie…</p> : null}
    {status ? <p role={status.ok ? "status" : "alert"} className="text-sm text-dls-secondary">{status.message}</p> : null}
  </article>;
}
