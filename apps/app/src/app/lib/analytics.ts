/**
 * Product analytics for the LegalWork desktop app (upstream: zero-dependency event batches).
 *
 * LAWOSS: analytika je natrvalo vypnutá (rozhodnutie MČ 5. 10. 2026). Modul
 * nemá kľúč, adresu ani sieťové volanie; udalosti len zrkadlí do lokálneho
 * inšpektora (`window.__legalwork.record("analytics.<event>")`), aby upstream
 * evaly a testy inštrumentácie fungovali. Uložená stará voľba „zapnuté“ ani
 * prepis z Office panela nič neodošlú. Exporty ostávajú kvôli volajúcim.
 * Stráži to `lawoss/scripts/check-no-eigenwelt.mjs`.
 */
import { recordInspectorEvent } from "./app-inspector";
import { isOfficeAddinRuntime } from "./runtime-env";
import { officeHostName } from "@/word-addin/office";

const PREFS_STORAGE_KEY = "legalwork.preferences";
// Earlier builds persisted the distinct id here; initAnalytics cleans it up.
const LEGACY_DISTINCT_ID_STORAGE_KEY = "legalwork.analytics.distinctId";

export type AnalyticsProperties = Record<string, string | number | boolean | null | readonly string[]>;

let initialized = false;

/** The stored consent choice, or null when the user never made one. */
export function getStoredAnalyticsConsent(): boolean | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "analyticsEnabled" in parsed) {
      const value = (parsed as { analyticsEnabled?: unknown }).analyticsEnabled;
      return typeof value === "boolean" ? value : null;
    }
    return null;
  } catch {
    return null;
  }
}

// The Office pane mirrors the desktop's consent (adopted from the server
// bootstrap, refreshed by polling — see word-addin/index.tsx). LAWOSS: ignored.
export function setAnalyticsConsentOverride(_enabled: boolean): void {}

/** LAWOSS: vždy `false`, nech je uložená voľba alebo prepis z panela akýkoľvek. */
export function isAnalyticsEnabled(): boolean {
  return false;
}

/** True when a capture would actually be sent — lets callers skip enrichment work. */
export function isAnalyticsSending(): boolean {
  return false;
}

// Per-launch analytics id: minted in memory on first use, never persisted.
// Normally replaced by the server's launch id via setAnalyticsDistinctId.
let runtimeDistinctId = "";

export function getAnalyticsDistinctId(): string {
  if (runtimeDistinctId) return runtimeDistinctId;
  try {
    runtimeDistinctId = crypto.randomUUID();
  } catch {
    runtimeDistinctId = `lw.${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
  }
  return runtimeDistinctId;
}

/** Adopt the server's per-launch id so desktop + pane count as one user. */
export function setAnalyticsDistinctId(id: string): void {
  const trimmed = id.trim();
  if (trimmed) runtimeDistinctId = trimmed;
}

/**
 * Where an event was triggered: the desktop app, or a specific Office add-in
 * pane. NOT a base property — attached explicitly to the events that can fire
 * inside the pane.
 */
export type AnalyticsSurface = "desktop" | "word" | "excel" | "powerpoint" | "office";
export function analyticsSurface(): AnalyticsSurface {
  if (!isOfficeAddinRuntime()) return "desktop";
  const host = officeHostName();
  return host === "word" || host === "excel" || host === "powerpoint" ? host : "office";
}

/**
 * Record an analytics event in the local inspector only. LAWOSS: nothing is
 * queued and nothing leaves the machine.
 */
export function captureAnalyticsEvent(event: string, properties: AnalyticsProperties = {}) {
  try {
    recordInspectorEvent(`analytics.${event}`, properties);
  } catch {
    // Inspector unavailable (non-browser context).
  }
}

/** Kept for callers; there is never a pending queue to drop. */
export function discardPendingAnalytics(): void {}

/** Kept for callers; LAWOSS sends nothing. */
export async function flushAnalytics(): Promise<void> {}

// Task run duration tracking: sendDraft marks the start, the session.idle
// sync event takes it. Also acts as a dedupe guard so idle events that do
// not correspond to an instrumented run (or arrive from a second workspace
// sync) emit nothing.
const taskRunStarts = new Map<string, number>();

export function markTaskRunStart(sessionId: string) {
  if (sessionId.trim()) taskRunStarts.set(sessionId, Date.now());
}

export function takeTaskRunStart(sessionId: string): number | null {
  const startedAt = taskRunStarts.get(sessionId);
  if (startedAt === undefined) return null;
  taskRunStarts.delete(sessionId);
  return startedAt;
}

/**
 * One-time setup. Mounted from AppRoot. LAWOSS: no flush loop, only cleanup
 * of the id persisted by earlier builds.
 */
export function initAnalytics() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  // Remove the distinct id persisted by earlier builds.
  try {
    window.localStorage.removeItem(LEGACY_DISTINCT_ID_STORAGE_KEY);
  } catch {
    // Storage unavailable.
  }
}

export function disposeAnalytics() {
  initialized = false;
}
