import { useCallback, useEffect, useRef, useState } from "react";
import type { LegalworkServerClient } from "../../app/lib/legalwork-server";

/**
 * LAWOSS #454: stav enginu pre stavový riadok. Spojenie so serverom LegalWork ešte neznamená,
 * že engine beží: server ho po páde spúšťa znova a `/health` medzitým hlási `starting`,
 * po vyčerpaní pokusov `error`.
 */
export type EngineHealth = "ready" | "restarting" | "unavailable";

type ServerEngineStatus = "starting" | "migrating" | "ready" | "error";

const READY_POLL_MS = 10_000;
const OUTAGE_POLL_MS = 2_000;

export function engineHealthFromStatus(status: ServerEngineStatus | undefined): EngineHealth | null {
  if (status === undefined) return null;
  if (status === "ready") return "ready";
  return status === "error" ? "unavailable" : "restarting";
}

type EngineHealthClient = Pick<LegalworkServerClient, "health"> & Partial<Pick<LegalworkServerClient, "restartEngine">>;

/**
 * `health` je `null` pri serveri bez spravovaného enginu alebo nedostupnom `/health` (ten hlási iný indikátor).
 * `retry` (len keď ho klient vie): po vyčerpaní automatických reštartov požiada server o nový pokus.
 */
export function useEngineHealth(client: EngineHealthClient | null | undefined): { health: EngineHealth | null; retry?: () => Promise<void> } {
  const [health, setHealth] = useState<EngineHealth | null>(null);
  // Bumped by `retry` so polling restarts at once at the outage pace.
  const [round, setRound] = useState(0);
  // The client object can be rebuilt on every render; polling follows the latest one without restarting.
  const current = useRef(client);
  current.current = client;
  const connected = Boolean(client);
  const canRetry = Boolean(client?.restartEngine);
  useEffect(() => {
    if (!connected) { setHealth(null); return; }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      let next: EngineHealth | null = null;
      if (typeof document === "undefined" || document.visibilityState !== "hidden") {
        try { next = engineHealthFromStatus((await current.current?.health())?.engine?.status); } catch { next = null; }
        if (stopped) return;
        setHealth(next);
      }
      timer = setTimeout(() => void poll(), next === "ready" || next === null ? READY_POLL_MS : OUTAGE_POLL_MS);
    };
    void poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [connected, round]);
  const retry = useCallback(async () => {
    const result = await current.current?.restartEngine?.();
    if (result?.restarting) setHealth("restarting");
    setRound(value => value + 1);
  }, []);
  return canRetry ? { health, retry } : { health };
}
