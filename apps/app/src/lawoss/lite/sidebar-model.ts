/**
 * Bočný panel bežného režimu (alfa 14): čisté pravidlá bez Reactu pre počet lehôt pri „Lehoty a úlohy“, stav
 * registrov dole v paneli a odkaz na hlásenie chyby. Pokročilý režim tieto riadky nemá.
 */
import type { McpStatusMap } from "@/app/types";
import type { Language } from "@/i18n";
import { MARKETPLACE_MCP_SERVERS } from "../domains/marketplace/mcp-servers";
import type { OkfReadResult } from "../okf/read-model";
import { LEHOTY_PATH } from "./links";
import type { UiMode } from "./ui-mode";

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

/** Segment cesty ako ID projektu (`workspaceViewRoute` ho kóduje); poškodený segment ostane, ako je. */
function decodeSegment(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
}

/**
 * Projekt, ktorému patrí trasa bežného režimu mimo stromu klienta: natívne stránky projektu (`/workspace/<id>/…`:
 * Prehľad, Dokumenty, Chaty, chat) a lehoty jedného klienta (`/lehoty?klient=<id>`). Ostatné trasy (Dnes, Lehoty
 * a úlohy, Klienti, Na zaradenie, Nastavenia aj s ID projektu…) sú globálne: `null`.
 */
export function routeProject(pathname: string, search: string): string | null {
  // Nastavenia (aj `/workspace/<id>/settings/…`, kam vedie riadok Nastavenia dole v paneli) nepatria klientovi.
  const workspace = /^\/workspace\/([^/]+)(?:\/(?!settings(?:\/|$))|$)/.exec(pathname)?.[1];
  if (workspace) return decodeSegment(workspace);
  return pathname === LEHOTY_PATH ? new URLSearchParams(search).get("klient") : null;
}

/**
 * Riadok klienta je aktívny (zlatá glazúra v bežnom režime). Trasa vo veci, klientovi alebo chate stromu (`focused`)
 * rozhoduje v oboch režimoch. Inak Pokročilý režim natívne podľa vybraného projektu; bežný len vtedy, keď trasa
 * patrí tomuto projektu: na globálnej stránke (Dnes, Lehoty a úlohy) ostane klient rozbalený, ale nie aktívny,
 * aby nesvietili dve položky naraz. Keď je aktívna položka pod klientom, glazúru riadku klienta stlmí CSS
 * (`lawoss.css`, bežný režim).
 */
export function clientRowActive(input: { mode: UiMode; projectId: string; isSelected: boolean; focused?: string | null; pathname: string; search: string }): boolean {
  if (input.focused) return input.focused === input.projectId;
  if (input.mode !== "lite") return input.isSelected;
  return routeProject(input.pathname, input.search) === input.projectId;
}
