import { useEffect, useRef, useState } from "react";
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

/** `null`: server bez spravovaného enginu alebo nedostupný `/health` (ten hlási iný indikátor). */
export function useEngineHealth(client: Pick<LegalworkServerClient, "health"> | null | undefined): EngineHealth | null {
  const [health, setHealth] = useState<EngineHealth | null>(null);
  // The client object can be rebuilt on every render; polling follows the latest one without restarting.
  const current = useRef(client);
  current.current = client;
  const connected = Boolean(client);
  useEffect(() => {
    setHealth(null);
    if (!connected) return;
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
  }, [connected]);
  return health;
}
