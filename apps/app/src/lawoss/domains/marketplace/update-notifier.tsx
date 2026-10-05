/** @jsxImportSource react */
/**
 * LAWOSS: upozornenie v appke na aktualizácie LAWOSS Marketplace (ADR 0015 bod 6).
 *
 * Číta len uložený výsledok poslednej kontroly na lokálnom serveri (`GET /lawoss/marketplace`,
 * bez siete) pri štarte a potom raz za hodinu. Sieť ide až po kliknutí na „Aktualizovať všetko“;
 * plugin s upraveným súborom sa neaktualizuje, advokát rozhodne v LAWOSS Marketplace.
 * Rovnaká sada aktualizácií sa ohlási raz za spustenie appky.
 */
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { toast } from "@/components/ui/sonner";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { readActiveWorkspaceId } from "@/react-app/shell/session-memory";

import type { LawossMarketplaceApi, PluginUpdate } from "./marketplace-api";
import { nativeIntegrationRoute } from "./native-actions";
import { loadMarketplaceApi } from "./use-lawoss-marketplace";

const POLL_MS = 60 * 60 * 1000;
const NOTIFIED_KEY = "lawoss.marketplace.notified";

export function updatesSignature(tag: string, updates: readonly PluginUpdate[]): string {
  return `${tag}:${updates.map((update) => `${update.pluginId}@${update.available}`).sort().join(",")}`;
}

function alreadyNotified(signature: string): boolean {
  try { return sessionStorage.getItem(NOTIFIED_KEY) === signature; } catch { return false; }
}

function markNotified(signature: string): void {
  try { sessionStorage.setItem(NOTIFIED_KEY, signature); } catch { /* bez úložiska sa upozorní znova */ }
}

/** Aktualizuje všetko, čo nemá upravené súbory; ostatné nechá na rozhodnutie v Marketplace. */
export async function updateAllWithoutConflicts(api: LawossMarketplaceApi, updates: readonly PluginUpdate[]) {
  const updated: string[] = [];
  const needsDecision: string[] = [];
  const failed: string[] = [];
  for (const update of updates) {
    try {
      const outcome = await api.update(update.pluginId);
      if (outcome.status === "needs_decision") needsDecision.push(update.name);
      else updated.push(update.name);
    } catch {
      failed.push(update.name);
    }
  }
  return { updated, needsDecision, failed };
}

function announce(api: LawossMarketplaceApi, updates: readonly PluginUpdate[], locale: Language, open: () => void) {
  toast.info(t("lawoss.marketplace.notice.title", locale, { count: String(updates.length) }), {
    description: `${updates.map((update) => `${update.name} ${update.available}`).join(", ")}. ${t("lawoss.marketplace.notice.body", locale)}`,
    duration: Infinity,
    action: {
      label: t("lawoss.marketplace.updates.update_all", locale),
      onClick: () => {
        void updateAllWithoutConflicts(api, updates).then((result) => {
          if (result.updated.length) toast.success(t("lawoss.marketplace.updates.updated", locale, { names: result.updated.join(", ") }));
          if (result.needsDecision.length || result.failed.length) {
            toast.warning(t("lawoss.marketplace.notice.decision", locale, { names: [...result.needsDecision, ...result.failed].join(", ") }), {
              duration: Infinity,
              action: { label: t("lawoss.marketplace.notice.open", locale), onClick: open },
            });
          }
        });
      },
    },
    cancel: { label: t("lawoss.marketplace.notice.open", locale), onClick: open },
  });
}

export function MarketplaceUpdateNotifier({ api: injected }: { api?: LawossMarketplaceApi | null } = {}) {
  const locale = useLocale();
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    let api: LawossMarketplaceApi | null = injected ?? null;
    const open = () => navigate(nativeIntegrationRoute("/marketplace", readActiveWorkspaceId()));
    const poll = async () => {
      api ??= await loadMarketplaceApi().catch(() => null);
      if (!api || cancelled) return;
      const view = await api.view().catch(() => null);
      if (!view || cancelled || view.check?.status !== "ok" || !view.updates.length) return;
      const signature = updatesSignature(view.check.release.tag, view.updates);
      if (alreadyNotified(signature)) return;
      markNotified(signature);
      announce(api, view.updates, locale, open);
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [injected, locale, navigate]);
  return null;
}
