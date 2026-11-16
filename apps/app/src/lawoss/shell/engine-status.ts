/**
 * #454: zdravie spravovaného enginu z `/health` servera (pole `engine.status`). Stavový riadok podľa neho
 * neukáže „pripravené“, kým engine po páde nebeží. Hodnotu zapisuje existujúca kontrola zdravia servera
 * (každých 10 s, kým sa engine spúšťa každé 2 s; legalwork-server-store.ts); žiadne ďalšie dopytovanie.
 */
import { useSyncExternalStore } from "react";

export type EngineHealth = "starting" | "migrating" | "ready" | "error";

let current: EngineHealth | null = null;
const listeners = new Set<() => void>();

/** `null`: server stav enginu nehlási (externý engine alebo server nedostupný). */
export function reportEngineHealth(status: EngineHealth | null | undefined): void {
  const next = status ?? null;
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

/** Engine sa ešte spúšťa: kontrola zdravia sa vtedy opakuje skôr (2 s), aby riadok nezaostával o 10 s. */
export function engineHealthPending(): boolean {
  return current === "starting" || current === "migrating";
}

export function useEngineHealth(): EngineHealth | null {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => current,
    () => current,
  );
}

/** Text stavového riadka, keď engine nie je pripravený; `null` = bežný stav. Kľúče sú v lawoss/i18n/shell.ts. */
export function engineStatusText(status: EngineHealth | null): { label: string; hint: string; failed: boolean } | null {
  if (status === null || status === "ready") return null;
  return status === "error"
    ? { label: "lawoss.engine.unavailable", hint: "lawoss.engine.unavailable_hint", failed: true }
    : { label: "lawoss.engine.starting", hint: "lawoss.engine.starting_hint", failed: false };
}
