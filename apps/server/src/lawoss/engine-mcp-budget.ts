/**
 * LAWOSS: rozpočet RAM 2 GB (issue #367).
 *
 * Engine OpenCode drží jednu inštanciu na adresár a pri prvom dotyku MCP stavu
 * (GET /mcp, GET /command, prompt…) v nej spustí všetky zapnuté MCP servery.
 * Každý MCP z LAWOSS Marketplace sú dva procesy `node`, takže každý otvorený
 * klient stojí stovky MB. Inštancie engine sám nikdy neuvoľní.
 *
 * Tento modul eviduje adresáre s aktívnym MCP („otvorení klienti“), drží ich
 * najviac `limit` a nečinné (bez rozpracovaného chatu) uvoľní cez
 * `POST /instance/dispose`. Ďalšia požiadavka inštanciu znovu postaví; MCP sa
 * spustia až pri ďalšom skutočnom použití.
 */

export type EngineScope = {
  baseUrl: string;
  authHeader: string | null;
  directory: string;
};

export type EngineMcpBudgetOptions = {
  /** Najviac súčasne aktívnych inštancií s MCP; 0 = bez limitu (pôvodné správanie). */
  limit: number;
  /** Po koľkých ms bez použitia sa nečinná inštancia uvoľní; 0 = nikdy. */
  idleMs: number;
  /** Beží v adresári chat? Neznáma odpoveď musí vrátiť true. */
  busy: (scope: EngineScope) => Promise<boolean>;
  /** Uvoľní inštanciu enginu (a tým aj jej MCP procesy). */
  dispose: (scope: EngineScope) => Promise<void>;
  /** Spustí sa raz po prijatí nového adresára (napr. registrácia MCP klienta). */
  initialize?: (scope: EngineScope) => Promise<void>;
  now?: () => number;
  log?: (message: string, fields: Record<string, string | number>) => void;
};

type Entry = {
  scope: EngineScope;
  lastUsed: number;
  inflight: number;
  ready: Promise<void>;
};

export type EngineMcpBudget = {
  readonly limit: number;
  /** Je adresár medzi aktívnymi (alebo je limit vypnutý)? */
  isActive(scope: EngineScope): boolean;
  /** Pred požiadavkou, ktorá v engine spustí MCP. Vráti uvoľnenie „in-flight“. */
  admit(scope: EngineScope): Promise<() => void>;
  /** Explicitný reload priečinka: otvorí ho v rozpočte bez `initialize` (reload MCP obnoví sám). */
  adopt(scope: EngineScope): Promise<void>;
  /** Iná požiadavka do adresára predĺži jeho životnosť, ak je aktívny. */
  touch(scope: EngineScope): void;
  /** Inštanciu uvoľnil niekto iný (reload); prestane sa evidovať. */
  forget(scope: EngineScope): void;
  /** Uvoľní nečinné inštancie po `idleMs`. */
  sweep(): Promise<void>;
  activeDirectories(): string[];
  close(): void;
};

const MCP_SESSION_ACTION = /^(?:\/api)?\/session\/[^/]+\/(?:message|prompt|prompt_async|command|shell|summarize|init)$/;

/** Engine cesty, ktoré inicializujú MCP stav inštancie (opencode v1.18.29). */
export function initializesEngineMcp(method: string, path: string): boolean {
  const verb = method.toUpperCase();
  if (path === "/mcp" || path.startsWith("/mcp/")) return true;
  if (verb === "GET" && path === "/command") return true;
  if (path.startsWith("/experimental/tool") || path.startsWith("/experimental/resource")) return true;
  return verb === "POST" && MCP_SESSION_ACTION.test(path);
}

export function scopeKey(scope: Pick<EngineScope, "baseUrl" | "directory">): string {
  return JSON.stringify([scope.baseUrl.replace(/\/+$/, ""), scope.directory]);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Predvolene 1 aktívny klient a 10 min nečinnosti. `LAWOSS_ENGINE_MCP_INSTANCES=0`
 * vypne limit (napr. pre stroj s dostatkom RAM alebo diagnostiku).
 */
export function engineMcpBudgetSettings(env: Record<string, string | undefined> = process.env) {
  return {
    limit: positiveInteger(env.LAWOSS_ENGINE_MCP_INSTANCES, 1),
    idleMs: positiveInteger(env.LAWOSS_ENGINE_MCP_IDLE_MS, 10 * 60_000),
  };
}

export function createEngineMcpBudget(options: EngineMcpBudgetOptions): EngineMcpBudget {
  const now = options.now ?? Date.now;
  const active = new Map<string, Entry>();
  // Prijímanie a uvoľňovanie ide postupne, aby dva súbežné prvé dotyky
  // nepostavili dve inštancie nad limit.
  let lane: Promise<void> = Promise.resolve();
  const serialized = <T>(run: () => Promise<T>): Promise<T> => {
    const result = lane.then(run, run);
    lane = result.then(() => undefined, () => undefined);
    return result;
  };

  const release = (entry: Entry) => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.inflight = Math.max(0, entry.inflight - 1);
      entry.lastUsed = now();
    };
  };

  const disposeEntry = async (key: string, entry: Entry, reason: string): Promise<boolean> => {
    if (entry.inflight > 0) return false;
    if (await options.busy(entry.scope).catch(() => true)) return false;
    // Medzitým mohla prísť nová požiadavka.
    if (entry.inflight > 0 || active.get(key) !== entry) return false;
    active.delete(key);
    try {
      await options.dispose(entry.scope);
      options.log?.("Engine instance released", { "engine.directory": entry.scope.directory, "engine.reason": reason });
      return true;
    } catch {
      // Inštancia ostala; pri ďalšom kole sa skúsi znova.
      if (!active.has(key)) active.set(key, entry);
      return false;
    }
  };

  // Uvoľňuje najdlhšie nepoužité, kým ostane najviac `keep` aktívnych.
  const makeRoom = async (keep: number) => {
    if (options.limit === 0) return;
    const candidates = [...active.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key, entry] of candidates) {
      if (active.size <= keep) return;
      await disposeEntry(key, entry, "limit");
    }
  };

  return {
    limit: options.limit,
    isActive(scope) {
      return options.limit === 0 || active.has(scopeKey(scope));
    },
    async admit(scope) {
      const key = scopeKey(scope);
      const existing = active.get(key);
      if (existing) {
        existing.inflight += 1;
        existing.lastUsed = now();
        await existing.ready.catch(() => undefined);
        return release(existing);
      }
      return serialized(async () => {
        const current = active.get(key);
        if (current) {
          current.inflight += 1;
          current.lastUsed = now();
          return release(current);
        }
        await makeRoom(options.limit - 1);
        const entry: Entry = { scope, lastUsed: now(), inflight: 1, ready: Promise.resolve() };
        active.set(key, entry);
        if (active.size > options.limit && options.limit > 0) {
          options.log?.("Engine instance budget exceeded by busy instances", { "engine.active": active.size, "engine.limit": options.limit });
        }
        entry.ready = options.initialize ? options.initialize(scope).catch(() => undefined) : Promise.resolve();
        await entry.ready;
        return release(entry);
      });
    },
    adopt(scope) {
      const key = scopeKey(scope);
      return serialized(async () => {
        const current = active.get(key);
        if (current) { current.lastUsed = now(); return; }
        await makeRoom(options.limit - 1);
        active.set(key, { scope, lastUsed: now(), inflight: 0, ready: Promise.resolve() });
      });
    },
    touch(scope) {
      const entry = active.get(scopeKey(scope));
      if (entry) entry.lastUsed = now();
    },
    forget(scope) {
      active.delete(scopeKey(scope));
    },
    sweep() {
      return serialized(async () => {
        if (options.idleMs === 0) return;
        const cutoff = now() - options.idleMs;
        for (const [key, entry] of [...active.entries()]) {
          if (entry.lastUsed <= cutoff) await disposeEntry(key, entry, "idle");
        }
        // Nad limitom (napr. všetci boli zaneprázdnení) skús znova.
        if (options.limit > 0 && active.size > options.limit) await makeRoom(options.limit);
      });
    },
    activeDirectories() {
      return [...active.values()].map((entry) => entry.scope.directory);
    },
    close() {
      active.clear();
    },
  };
}
