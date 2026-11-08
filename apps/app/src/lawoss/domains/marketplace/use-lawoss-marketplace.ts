/**
 * LAWOSS: stav LAWOSS Marketplace pre všetkých klientov (server `/lawoss/marketplace`).
 * Čítanie stavu nejde na sieť; sieť ide len pri `check` (otvorenie Marketplace, tlačidlo)
 * a pri inštalácii, aktualizácii a presune, teda po akcii advokáta.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { createLegalworkServerClient } from "@/app/lib/legalwork-server";
import { resolveLegalworkConnection } from "@/react-app/shell/legalwork-connection";

import { catalogPluginId, catalogPluginUrl, type BasePackResult } from "./native-actions";
import type { MarketplaceEntry } from "./catalog";
import type { LawossMarketplaceApi, MarketplaceView } from "./marketplace-api";
import { t } from "@/i18n";
import { LegalworkServerError } from "@/app/lib/legalwork-server";

/** Klient lokálneho servera s host tokenom (routes sú host auth ako `/lawoss/ocr`). */
export async function loadMarketplaceApi(): Promise<LawossMarketplaceApi | null> {
  const { normalizedBaseUrl, resolvedToken, resolvedHostToken } = await resolveLegalworkConnection();
  if (!normalizedBaseUrl || !resolvedToken || !resolvedHostToken) return null;
  return createLegalworkServerClient({ baseUrl: normalizedBaseUrl, token: resolvedToken, hostToken: resolvedHostToken || undefined }).lawossMarketplace;
}

/** Id pluginov z katalógu, ktoré sú nainštalované pre všetkých klientov. */
export function globalInstalledIds(view: MarketplaceView | null, entries: readonly MarketplaceEntry[]): Set<string> {
  const installed = new Set((view?.global ?? []).map((plugin) => plugin.pluginId));
  return new Set(entries.filter((entry) => entry.install.action === "plugin" && installed.has(catalogPluginId(entry))).map((entry) => entry.id));
}

/** Názov pluginu z katalógu v jazyku appky (server pozná len meno z `plugin.json`). */
export function pluginDisplayName(pluginId: string, fallback: string, catalog: readonly MarketplaceEntry[]): string {
  return catalog.find((entry) => entry.install.action === "plugin" && catalogPluginId(entry) === pluginId)?.name ?? fallback;
}

/** Odporúčané balíky pre všetkých klientov: po jednom, zlyhanie jedného nezastaví ostatné. */
export async function installGlobalEntries(api: LawossMarketplaceApi, entries: readonly MarketplaceEntry[]): Promise<BasePackResult> {
  const result: BasePackResult = { installed: [], failed: [] };
  let unreachable: string | null = null;
  for (const entry of entries) {
    // Po výpadku zdroja by každý ďalší doplnok čakal na sieť znova; zvyšok balíka dostane tú istú radu hneď.
    if (unreachable) { result.failed.push({ id: entry.id, message: unreachable }); continue; }
    try {
      await api.install(catalogPluginUrl(entry));
      result.installed.push(entry.id);
    } catch (error) {
      const message = installFailureMessage(error);
      if (isSourceUnreachable(error)) unreachable = message;
      result.failed.push({ id: entry.id, message });
    }
  }
  return result;
}

const isSourceUnreachable = (error: unknown) => error instanceof LegalworkServerError && error.code === "plugin_source_unreachable";

/** N7: výpadok siete pri sťahovaní doplnku je po slovensky a s radou, ostatné chyby ostávajú pôvodné. */
export function installFailureMessage(error: unknown): string {
  if (isSourceUnreachable(error)) return t("lawoss.integrations.base.source_unreachable");
  return error instanceof Error ? error.message : String(error);
}

export function useLawossMarketplace(options: { api?: LawossMarketplaceApi | null; workspaceId?: string | null; checkOnOpen?: boolean } = {}) {
  const [loadedApi, setApi] = useState<LawossMarketplaceApi | null>(null);
  const api = options.api === undefined ? loadedApi : options.api;
  const workspaceId = options.workspaceId ?? null;
  const scope = useMemo(() => ({ active: true, request: 0, checks: 0 }), [api, workspaceId]);
  const [result, setResult] = useState<{ scope: typeof scope; view: MarketplaceView | null; error: string | null } | null>(null);
  const [checkingScope, setCheckingScope] = useState<typeof scope | null>(null);
  useEffect(() => {
    scope.active = true;
    return () => { scope.active = false; scope.request++; };
  }, [scope]);

  useEffect(() => {
    if (options.api !== undefined) return;
    let cancelled = false;
    void loadMarketplaceApi().then((loaded) => { if (!cancelled) setApi(loaded); }, () => undefined);
    return () => { cancelled = true; };
  }, [options.api]);

  const refresh = useCallback(async () => {
    if (!api || !scope.active) return;
    const request = ++scope.request;
    try {
      const view = await api.view(workspaceId);
      if (scope.active && scope.request === request) setResult({ scope, view, error: null });
    } catch (failure) {
      if (scope.active && scope.request === request) setResult({ scope, view: null, error: failure instanceof Error ? failure.message : String(failure) });
    }
  }, [api, workspaceId, scope]);

  const check = useCallback(async (reason: "open" | "manual") => {
    if (!api || !scope.active || scope.checks) return;
    const request = ++scope.request;
    scope.checks++;
    setCheckingScope(scope);
    try {
      const view = await api.check(reason, workspaceId);
      if (scope.active && scope.request === request) setResult({ scope, view, error: null });
    } catch (failure) {
      if (scope.active && scope.request === request) setResult({ scope, view: null, error: failure instanceof Error ? failure.message : String(failure) });
    } finally {
      scope.checks--;
      if (scope.active) setCheckingScope(current => current === scope ? null : current);
    }
  }, [api, workspaceId, scope]);

  useEffect(() => {
    if (!api) return;
    // Otvorenie LAWOSS Marketplace je akcia advokáta: skontroluje vydania (server krátko po kontrole vráti uložený stav).
    if (options.checkOnOpen) void refresh().then(() => check("open"));
    else void refresh();
  }, [api, refresh, check, options.checkOnOpen]);

  const setWeeklyCheck = useCallback(async (weeklyCheck: boolean) => {
    if (!api) return;
    await api.setWeeklyCheck(weeklyCheck);
    await refresh();
  }, [api, refresh]);

  return { api, view: result?.scope === scope ? result.view : null, error: result?.scope === scope ? result.error : null,
    checking: checkingScope === scope, refresh, check, setWeeklyCheck };
}

export type LawossMarketplaceState = ReturnType<typeof useLawossMarketplace>;
