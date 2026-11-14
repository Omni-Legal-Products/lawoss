/**
 * Bočný panel bežného režimu (alfa 14): čisté pravidlá bez Reactu pre počet lehôt pri „Lehoty a úlohy“, stav
 * registrov dole v paneli a odkaz na hlásenie chyby. Pokročilý režim tieto riadky nemá.
 */
import type { McpStatusMap } from "@/app/types";
import type { Language } from "@/i18n";
import { MARKETPLACE_MCP_SERVERS } from "../domains/marketplace/mcp-servers";
import type { OkfReadResult } from "../okf/read-model";

/**
 * Počet lehôt po termíne a do 7 dní z už prečítaného prehľadu praxe (súčty z `buildOverview`, žiadne ďalšie čítanie).
 * Bez prehľadu `null` (riadok nič netvrdí); nula sa tiež neukazuje.
 */
export function deadlineAttentionCount(data: Pick<OkfReadResult, "totals"> | undefined): number | null {
  if (!data) return null;
  const count = data.totals.overdue + data.totals.deadlinesWithin7Days;
  return count > 0 ? count : null;
}

/**
 * Stav registrov (konektory doplnkov z LAWOSS Marketplace) z mapy stavov MCP, ktorú appka už číta pre vybraný
 * priečinok. Vypnutý konektor sa nepočíta. `unknown`: mapa ešte nie je alebo nie je nainštalovaný žiadny register.
 */
export type RegistersSummary =
  | { state: "unknown" }
  | { state: "ready"; ready: number; total: number }
  | { state: "starting"; ready: number; total: number }
  | { state: "failing"; failing: number; total: number };

const FAILING: ReadonlySet<string> = new Set(["failed", "needs_auth", "needs_client_registration"]);

export function registersSummary(statuses: McpStatusMap | null): RegistersSummary {
  if (!statuses) return { state: "unknown" };
  const installed = MARKETPLACE_MCP_SERVERS.flatMap((name) => {
    const status = Object.hasOwn(statuses, name) ? statuses[name]?.status : undefined;
    return status && status !== "disabled" ? [status] : [];
  });
  const total = installed.length;
  if (!total) return { state: "unknown" };
  const failing = installed.filter((status) => FAILING.has(status)).length;
  if (failing) return { state: "failing", failing, total };
  const ready = installed.filter((status) => status === "connected").length;
  return ready === total ? { state: "ready", ready, total } : { state: "starting", ready, total };
}

const REPORT_SITE = "https://lawoss.app";

/** Formulár hlásenia chyby alebo nápadu na webe v jazyku appky: sk → sk, cs → cz, ostatné → en. */
export function feedbackPageUrl(locale: Language): string {
  const site = locale === "sk" ? "sk" : locale === "cs" ? "cz" : "en";
  return `${REPORT_SITE}/${site}/alfa/hlasenie`;
}
