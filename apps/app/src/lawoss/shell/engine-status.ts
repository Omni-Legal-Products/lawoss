/**
 * #454: zdravie spravovaného enginu z `/health` servera (pole `engine.status`). Stavový riadok podľa neho
 * neukáže „pripravené“, kým engine po páde nebeží. Hodnotu zapisuje existujúca kontrola zdravia servera
 * (každých 10 s, kým sa engine spúšťa každé 2 s; legalwork-server-store.ts); žiadne ďalšie dopytovanie.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { LegalworkServerClient } from "../../app/lib/legalwork-server";

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

/**
 * #477: odstup ďalšej kontroly zdravia servera. Kým engine nebeží, /health odpovedá, ale kontrola schopností
 * servera zlyhá a store by odstup zdvojnásoboval až na 60 s; riadok by potom ešte minútu hlásil nedostupného
 * agenta, hoci už beží. Pri hlásenom výpadku enginu sa preto kontroluje krátko a stálo.
 */
export function engineHealthPollDelay(healthy: boolean, previousMs: number): number {
  if (engineHealthPending()) return 2_000;
  if (current === "error") return 5_000;
  return healthy ? 10_000 : Math.min(previousMs * 2, 60_000);
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

type EngineHealthClient = Pick<LegalworkServerClient, "health"> & Partial<Pick<LegalworkServerClient, "restartEngine">>;

/**
 * #477: stavový riadok si zdravie enginu pýta sám. Store servera (legalwork-server-store.ts) kontroluje /health
 * len kým je otvorená trasa Nastavení; v chate by inak riadok ukazoval posledný stav z Nastavení (napr. ešte
 * minútu „Agent nie je dostupný“ po obnove) a pri výpadku by sa „Skúsiť znova“ neukázalo. Odstup podľa
 * `engineHealthPollDelay`, pri skrytom okne sa nepýta.
 */
export function useEngineHealthPolling(client: EngineHealthClient | null | undefined): void {
  const latest = useRef(client);
  latest.current = client;
  const connected = Boolean(client);
  useEffect(() => {
    if (!connected) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 10_000;
    const run = async () => {
      const current = latest.current;
      if (current && (typeof document === "undefined" || document.visibilityState !== "hidden")) {
        let healthy = true;
        try {
          const status = (await current.health()).engine?.status;
          if (stopped) return;
          reportEngineHealth(status, current.restartEngine ? () => current.restartEngine!() : undefined);
        } catch {
          if (stopped) return;
          healthy = false;
          // #527: server nedostupný – riadok nesmie ďalej ukazovať posledný známy stav enginu ani „Skúsiť znova“.
          reportEngineHealth(null);
        }
        delay = engineHealthPollDelay(healthy, delay);
      }
      timer = setTimeout(() => void run(), delay);
    };
    void run();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [connected]);
}
