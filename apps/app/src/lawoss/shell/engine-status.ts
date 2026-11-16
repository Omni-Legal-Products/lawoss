/**
 * #454: zdravie spravovaného enginu z `/health` servera (pole `engine.status`). Stavový riadok podľa neho
 * neukáže „pripravené“, kým engine po páde nebeží. Hodnotu zapisuje existujúca kontrola zdravia servera
 * (každých 10 s, kým sa engine spúšťa každé 2 s; legalwork-server-store.ts); žiadne ďalšie dopytovanie.
 */
import { useSyncExternalStore } from "react";

export type EngineHealth = "starting" | "migrating" | "ready" | "error";

/** #477: požiadavka na okamžitý nový pokus (`POST /engine/restart`) cez klienta poslednej kontroly zdravia. */
export type EngineRetry = () => Promise<{ restarting: boolean; engine: { status: EngineHealth } }>;

let current: EngineHealth | null = null;
let retry: EngineRetry | undefined;
let retrying: Promise<void> | undefined;
const listeners = new Set<() => void>();

/** `null`: server stav enginu nehlási (externý engine alebo server nedostupný). `request` chýba bez tokenu klienta. */
export function reportEngineHealth(status: EngineHealth | null | undefined, request?: EngineRetry): void {
  const next = status ?? null;
  const changed = next !== current || Boolean(request) !== Boolean(retry);
  current = next;
  retry = request;
  if (changed) for (const listener of listeners) listener();
}

/** „Skúsiť znova“: kým požiadavka beží, ďalší klik nepošle druhú. Stav z odpovede sa ukáže hneď. */
export function retryEngine(): Promise<void> {
  const request = retry;
  if (!request) return Promise.resolve();
  retrying ??= request()
    .then((result) => { reportEngineHealth(result.engine.status, request); })
    .finally(() => { retrying = undefined; });
  return retrying;
}

/** Engine sa ešte spúšťa: kontrola zdravia sa vtedy opakuje skôr (2 s), aby riadok nezaostával o 10 s. */
export function engineHealthPending(): boolean {
  return current === "starting" || current === "migrating";
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useEngineHealth(): EngineHealth | null {
  return useSyncExternalStore(subscribe, () => current, () => current);
}

/** Server vie agenta znova spustiť na požiadanie (klient s tokenom). */
export function useEngineRetryAvailable(): boolean {
  return useSyncExternalStore(subscribe, () => Boolean(retry), () => Boolean(retry));
}

/** Text stavového riadka, keď engine nie je pripravený; `null` = bežný stav. Kľúče sú v lawoss/i18n/shell.ts. */
export function engineStatusText(status: EngineHealth | null, canRetry = false): { label: string; hint: string; failed: boolean } | null {
  if (status === null || status === "ready") return null;
  return status === "error"
    ? { label: "lawoss.engine.unavailable", hint: canRetry ? "lawoss.engine.unavailable_retry_hint" : "lawoss.engine.unavailable_hint", failed: true }
    : { label: "lawoss.engine.starting", hint: "lawoss.engine.starting_hint", failed: false };
}
