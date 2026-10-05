/**
 * LAWOSS: stav LAWOSS Marketplace pre všetkých klientov (server `/lawoss/marketplace`).
 * Čítanie stavu nejde na sieť; sieť ide len pri `check` (otvorenie Marketplace, tlačidlo)
 * a pri inštalácii, aktualizácii a presune, teda po akcii advokáta.
 */
import { useCallback, useEffect, useState } from "react";

import { createLegalworkServerClient } from "@/app/lib/legalwork-server";
import { resolveLegalworkConnection } from "@/react-app/shell/legalwork-connection";

import { catalogPluginId, catalogPluginUrl, type BasePackResult } from "./native-actions";
import type { MarketplaceEntry } from "./catalog";
import type { LawossMarketplaceApi, MarketplaceView } from "./marketplace-api";

/** Klient lokálneho servera s host tokenom (routes sú host auth ako `/lawoss/ocr`). */
export async function loadMarketplaceApi(): Promise<LawossMarketplaceApi | null> {
  const { normalizedBaseUrl, resolvedToken, resolvedHostToken } = await resolveLegalworkConnection();
  if (!normalizedBaseUrl || !resolvedToken) return null;
  return createLegalworkServerClient({ baseUrl: normalizedBaseUrl, token: resolvedToken, hostToken: resolvedHostToken || undefined }).lawossMarketplace;
}

/** Id pluginov z katalógu, ktoré sú nainštalované pre všetkých klientov. */
export function globalInstalledIds(view: MarketplaceView | null, entries: readonly MarketplaceEntry[]): Set<string> {
  const installed = new Set((view?.global ?? []).map((plugin) => plugin.pluginId));
  return new Set(entries.filter((entry) => entry.install.action === "plugin" && installed.has(catalogPluginId(entry))).map((entry) => entry.id));
}

/** Odporúčané balíky pre všetkých klientov: po jednom, zlyhanie jedného nezastaví ostatné. */
export async function installGlobalEntries(api: LawossMarketplaceApi, entries: readonly MarketplaceEntry[]): Promise<BasePackResult> {
  const result: BasePackResult = { installed: [], failed: [] };
  for (const entry of entries) {
    try {
      await api.install(catalogPluginUrl(entry));
      result.installed.push(entry.id);
    } catch (error) {
      result.failed.push({ id: entry.id, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

export function useLawossMarketplace(options: { api?: LawossMarketplaceApi | null; workspaceId?: string | null; checkOnOpen?: boolean } = {}) {
  const [api, setApi] = useState<LawossMarketplaceApi | null>(options.api ?? null);
  const [view, setView] = useState<MarketplaceView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const workspaceId = options.workspaceId ?? null;

  useEffect(() => {
    if (options.api !== undefined) { setApi(options.api); return; }
    let cancelled = false;
    void loadMarketplaceApi().then((loaded) => { if (!cancelled) setApi(loaded); }, () => undefined);
    return () => { cancelled = true; };
  }, [options.api]);

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      setView(await api.view(workspaceId));
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [api, workspaceId]);

  const check = useCallback(async (reason: "open" | "manual") => {
    if (!api) return;
    setChecking(true);
    try {
      setView(await api.check(reason, workspaceId));
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setChecking(false);
    }
  }, [api, workspaceId]);

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

  return { api, view, error, checking, refresh, check, setWeeklyCheck };
}

export type LawossMarketplaceState = ReturnType<typeof useLawossMarketplace>;
