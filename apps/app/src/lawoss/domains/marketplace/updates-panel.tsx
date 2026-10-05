import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { ImportedPlugin } from "../../../app/lib/extension-imports";
import { getMarketplaceCatalog } from "./catalog";
import { pluginDisplayName } from "./use-lawoss-marketplace";
import { catalogPluginId, catalogPluginUrl } from "./native-actions";
import type { FileChange, FileResolution, LawossMarketplaceApi, MarketplaceView, NeedsDecision, Resolutions } from "./marketplace-api";

type Mode = "update" | "move" | "remove";

/** Voľby pri upravenom súbore podľa akcie; pri odinštalovaní nemá zmysel „ponechať“. */
const CHOICES: Record<Mode, readonly FileResolution[]> = {
  update: ["keep", "backup", "replace"],
  move: ["keep", "backup", "replace"],
  remove: ["backup", "replace"],
};

function choiceLabel(mode: Mode, choice: FileResolution, locale: Language): string {
  if (mode === "remove") return choice === "backup" ? t("lawoss.marketplace.decision.remove_backup", locale) : t("lawoss.marketplace.decision.remove_discard", locale);
  if (mode === "move" && choice === "keep") return t("lawoss.marketplace.decision.move_keep", locale);
  if (choice === "keep") return t("lawoss.marketplace.decision.keep", locale);
  if (choice === "backup") return t("lawoss.marketplace.decision.backup", locale);
  return t("lawoss.marketplace.decision.replace", locale);
}

/** Rozhodnutie advokáta o súboroch, ktoré upravil. Predvolená voľba nikdy nezahodí jeho úpravu. */
export function FileDecisionForm({ title, changes, mode, onConfirm, onCancel }: {
  title: string;
  changes: readonly FileChange[];
  mode: Mode;
  onConfirm: (resolutions: Resolutions) => void;
  onCancel: () => void;
}) {
  const locale = useLocale();
  const [choices, setChoices] = useState<Record<string, FileResolution>>(() =>
    Object.fromEntries(changes.map((change) => [change.path, CHOICES[mode][0]!])));
  return <div role="group" data-lawoss-decision={mode} className="space-y-3 rounded-lg border border-[rgba(201,162,74,0.45)] bg-dls-surface p-3">
    <p className="text-sm font-semibold text-dls-text">{t("lawoss.marketplace.decision.title", locale, { name: title })}</p>
    <p className="text-xs text-dls-secondary">{t("lawoss.marketplace.decision.description", locale)}</p>
    <ul className="space-y-3">
      {changes.map((change) => <li key={change.path} className="space-y-1">
        <p className="text-sm text-dls-text">
          <span className="font-medium">{change.title}</span>
          {change.state === "missing" ? <span className="ml-1 text-xs text-dls-secondary">{t("lawoss.marketplace.decision.missing", locale)}</span> : null}
        </p>
        <p className="break-all text-[11px] text-dls-secondary">{change.path.replace(/^\.opencode\//, "")}</p>
        <div className="flex flex-col gap-1">
          {CHOICES[mode].map((choice) => <label key={choice} className="flex items-center gap-2 text-sm text-dls-text">
            <input type="radio" className="accent-[var(--lw-gold)]" name={`${mode}:${change.path}`} checked={choices[change.path] === choice}
              onChange={() => setChoices((previous) => ({ ...previous, [change.path]: choice }))} />
            {choiceLabel(mode, choice, locale)}
          </label>)}
        </div>
      </li>)}
    </ul>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => onConfirm(choices)}>{t("lawoss.marketplace.decision.confirm", locale)}</Button>
      <Button size="sm" variant="outline" onClick={onCancel}>{t("lawoss.marketplace.decision.cancel", locale)}</Button>
    </div>
  </div>;
}

type Pending = { id: string; title: string; mode: Mode; changes: FileChange[]; retry: (resolutions: Resolutions) => Promise<void> };

/**
 * Spustí akciu, ktorá môže vrátiť `needs_decision`; vtedy ukáže formulár a po rozhodnutí
 * ju zopakuje s voľbami advokáta. Fronta pre „Aktualizovať všetko“.
 */
export function useDecisionQueue() {
  const [pending, setPending] = useState<Pending[]>([]);
  const ask = (item: Pending) => setPending((previous) => [...previous.filter((entry) => entry.id !== item.id), item]);
  const done = (id: string) => setPending((previous) => previous.filter((entry) => entry.id !== id));
  return { pending, ask, done };
}

const isDecision = (value: { status: string }): value is NeedsDecision => value.status === "needs_decision";

export function formatChecked(at: number, locale: Language): string {
  const tag = { sk: "sk-SK", cs: "cs-CZ", en: "en-GB", de: "de-DE" }[locale];
  return new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short" }).format(new Date(at));
}

function checkMessage(view: MarketplaceView, locale: Language): string | null {
  const check = view.check;
  if (!check) return null;
  if (check.status === "no_release") return t("lawoss.marketplace.updates.no_release", locale);
  if (check.status === "error") return t("lawoss.marketplace.updates.error", locale, { detail: check.message });
  return view.updates.length ? null : t("lawoss.marketplace.updates.none", locale, { tag: check.release.tag });
}

/** Aktualizácie z vydaní LAWOSS Marketplace: kontrola, týždenné nastavenie, zoznam a „Aktualizovať“. */
export function MarketplaceUpdatesPanel({ api, view, checking, error, onCheck, onWeeklyChange, onChanged }: {
  api: LawossMarketplaceApi | null;
  view: MarketplaceView | null;
  checking: boolean;
  error: string | null;
  onCheck: () => void;
  onWeeklyChange: (enabled: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const locale = useLocale();
  const queue = useDecisionQueue();
  const [working, setWorking] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);

  const runUpdate = async (pluginId: string, name: string, resolutions: Resolutions = {}): Promise<void> => {
    if (!api) return;
    const outcome = await api.update(pluginId, resolutions);
    if (isDecision(outcome)) {
      queue.ask({ id: pluginId, title: name, mode: "update", changes: outcome.changes, retry: (next) => runUpdate(pluginId, name, next) });
      return;
    }
    queue.done(pluginId);
    const lines = [t("lawoss.marketplace.updates.updated", locale, { names: name })];
    if (outcome.kept.length) lines.push(t("lawoss.marketplace.updates.kept_note", locale, { files: outcome.kept.map((path) => path.replace(/^\.opencode\//, "")).join(", ") }));
    if (outcome.backups.length) lines.push(t("lawoss.marketplace.updates.backups_note", locale, { files: outcome.backups.join(", ") }));
    setNotes((previous) => [...previous, ...lines]);
  };

  const guarded = async (key: string, action: () => Promise<void>) => {
    setWorking(key); setFailure(null);
    try { await action(); }
    catch (reason) { setFailure(reason instanceof Error ? reason.message : String(reason)); }
    finally { setWorking(null); await onChanged().catch(() => undefined); }
  };

  const catalog = getMarketplaceCatalog(locale);
  const updates = (view?.updates ?? []).map((update) => ({ ...update, name: pluginDisplayName(update.pluginId, update.name, catalog) }));
  const message = view ? checkMessage(view, locale) : null;
  return <section data-lawoss-updates="" aria-label={t("lawoss.marketplace.updates.title", locale)} className="space-y-3 rounded-xl border border-dls-border bg-dls-surface p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-dls-text">{t("lawoss.marketplace.updates.title", locale)}</h4>
        <p className="text-xs text-dls-secondary">
          {view?.settings.lastCheckedAt
            ? t("lawoss.marketplace.updates.last_checked", locale, { date: formatChecked(view.settings.lastCheckedAt, locale) })
            : t("lawoss.marketplace.updates.never_checked", locale)}
        </p>
      </div>
      <Button size="sm" variant="outline" disabled={!api || checking || working !== null} onClick={onCheck}>
        {checking ? t("lawoss.marketplace.updates.checking", locale) : t("lawoss.marketplace.updates.check", locale)}
      </Button>
    </div>
    <label className="flex items-start gap-3 text-sm text-dls-text">
      <Switch checked={view?.settings.weeklyCheck ?? true} disabled={!api || !view} onCheckedChange={(checked) => onWeeklyChange(checked === true)} />
      <span className="space-y-0.5">
        <span className="block">{t("lawoss.marketplace.updates.weekly", locale)}</span>
        <span className="block text-xs text-dls-secondary">{t("lawoss.marketplace.updates.weekly_hint", locale)}</span>
      </span>
    </label>
    {error ? <p role="alert" className="text-sm text-red-11">{t("lawoss.marketplace.updates.error", locale, { detail: error })}</p> : null}
    {message ? <p role="status" data-lawoss-check={view?.check?.status} className="text-sm text-dls-secondary">{message}</p> : null}
    {updates.length ? <div className="space-y-2" data-lawoss-update-list="">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-dls-text">{t("lawoss.marketplace.updates.available", locale, { count: String(updates.length), tag: view?.check?.status === "ok" ? view.check.release.tag : "" })}</p>
        {updates.length > 1 ? <Button size="sm" disabled={working !== null} onClick={() => void guarded("all", async () => {
          for (const update of updates) await runUpdate(update.pluginId, update.name);
        })}>{working === "all" ? t("lawoss.marketplace.working", locale) : t("lawoss.marketplace.updates.update_all", locale)}</Button> : null}
      </div>
      <ul className="space-y-2">
        {updates.map((update) => <li key={update.pluginId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dls-border px-3 py-2">
          <span className="text-sm text-dls-text">{t("lawoss.marketplace.updates.item", locale, { name: update.name, installed: update.installed ?? "?", available: update.available })}</span>
          <Button size="sm" variant="outline" disabled={working !== null} onClick={() => void guarded(update.pluginId, () => runUpdate(update.pluginId, update.name))}>
            {working === update.pluginId ? t("lawoss.marketplace.working", locale) : t("lawoss.marketplace.updates.update", locale)}
          </Button>
        </li>)}
      </ul>
      <p className="text-xs text-dls-secondary">{t("lawoss.marketplace.updates.protect_hint", locale)}</p>
    </div> : null}
    {queue.pending.map((item) => <FileDecisionForm key={item.id} title={item.title} changes={item.changes} mode={item.mode}
      onCancel={() => queue.done(item.id)}
      onConfirm={(resolutions) => void guarded(item.id, () => item.retry(resolutions))} />)}
    {notes.map((note) => <p key={note} role="status" className="break-all text-sm text-dls-secondary">{note}</p>)}
    {failure ? <p role="alert" className="text-sm text-red-11">{failure}</p> : null}
  </section>;
}

/** Doterajšie inštalácie len v jednom priečinku: fungujú ďalej, ponúkne sa presun na všetkých klientov. */
export function LegacyInstallsPanel({ api, workspaceId, workspaceName, plugins, onChanged }: {
  api: LawossMarketplaceApi | null;
  workspaceId: string;
  workspaceName: string;
  plugins: readonly ImportedPlugin[];
  onChanged: () => Promise<void>;
}) {
  const locale = useLocale();
  const queue = useDecisionQueue();
  const [working, setWorking] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  if (!plugins.length) return null;
  const catalog = getMarketplaceCatalog(locale);
  const urlOf = (plugin: ImportedPlugin) => {
    const entry = catalog.find((item) => item.install.action === "plugin" && catalogPluginId(item) === plugin.pluginId);
    return entry ? catalogPluginUrl(entry) : null;
  };
  const move = async (plugin: ImportedPlugin, resolutions: Resolutions = {}): Promise<void> => {
    const url = urlOf(plugin);
    if (!api || !url) throw new Error(t("lawoss.marketplace.unavailable", locale));
    const outcome = await api.move(workspaceId, plugin.pluginId, url, resolutions);
    if (isDecision(outcome)) {
      queue.ask({ id: plugin.pluginId, title: pluginDisplayName(plugin.pluginId, plugin.name, catalog), mode: "move", changes: outcome.changes, retry: (next) => move(plugin, next) });
      return;
    }
    queue.done(plugin.pluginId);
    setNotes((previous) => [...previous, t("lawoss.marketplace.legacy.moved", locale, { name: pluginDisplayName(plugin.pluginId, plugin.name, catalog) }),
      ...(outcome.backups.length ? [t("lawoss.marketplace.updates.backups_note", locale, { files: outcome.backups.join(", ") })] : [])]);
  };
  const guarded = async (key: string, action: () => Promise<void>) => {
    setWorking(key); setFailure(null);
    try { await action(); }
    catch (reason) { setFailure(reason instanceof Error ? reason.message : String(reason)); }
    finally { setWorking(null); await onChanged().catch(() => undefined); }
  };
  return <section data-lawoss-legacy="" className="space-y-3 rounded-xl border border-dls-border bg-dls-surface p-4">
    <div className="space-y-1">
      <h4 className="text-sm font-semibold text-dls-text">{t("lawoss.marketplace.legacy.title", locale, { name: workspaceName })}</h4>
      <p className="max-w-prose text-xs text-dls-secondary">{t("lawoss.marketplace.legacy.description", locale)}</p>
    </div>
    <ul className="space-y-2">
      {plugins.map((plugin) => <li key={plugin.pluginId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dls-border px-3 py-2">
        <span className="text-sm text-dls-text">{pluginDisplayName(plugin.pluginId, plugin.name, catalog)}</span>
        <Button size="sm" variant="outline" disabled={!api || working !== null || !urlOf(plugin)} onClick={() => void guarded(plugin.pluginId, () => move(plugin))}>
          {working === plugin.pluginId ? t("lawoss.marketplace.working", locale) : t("lawoss.marketplace.legacy.move", locale)}
        </Button>
      </li>)}
    </ul>
    {queue.pending.map((item) => <FileDecisionForm key={item.id} title={item.title} changes={item.changes} mode={item.mode}
      onCancel={() => queue.done(item.id)}
      onConfirm={(resolutions) => void guarded(item.id, () => item.retry(resolutions))} />)}
    {notes.map((note) => <p key={note} role="status" className="break-all text-sm text-dls-secondary">{note}</p>)}
    {failure ? <p role="alert" className="text-sm text-red-11">{failure}</p> : null}
  </section>;
}

/** Odinštalovanie pluginu pre všetkých klientov s ochranou úprav. */
export function useGlobalRemove(api: LawossMarketplaceApi | null, onChanged: () => Promise<void>) {
  const queue = useDecisionQueue();
  const remove = async (pluginId: string, name: string, resolutions: Resolutions = {}): Promise<string[]> => {
    if (!api) return [];
    const outcome = await api.remove(pluginId, resolutions);
    if (isDecision(outcome)) {
      queue.ask({ id: pluginId, title: name, mode: "remove", changes: outcome.changes, retry: async (next) => { await remove(pluginId, name, next); } });
      return [];
    }
    queue.done(pluginId);
    await onChanged();
    return outcome.backups;
  };
  return { queue, remove };
}
