/**
 * LAWOSS: rozpočet RAM 2 GB (issue #367).
 *
 * Engine OpenCode 2.1.4 drží služby jednej lokácie (adresára) spolu: pluginy aj MCP
 * sú `makeLocationNode`. Prvá požiadavka viazaná na lokáciu (`location[directory]`,
 * `x-opencode-directory` alebo priečinok chatu) ju postaví a spustí všetky jej
 * zapnuté MCP servery; engine ich drží bez obmedzenia (`idleTimeToLive: infinity`).
 * Každý MCP z LAWOSS Marketplace sú dva procesy `node`, takže každý otvorený
 * klient stojí stovky MB.
 *
 * Tento modul eviduje lokácie s aktívnym MCP („otvorení klienti“), drží ich
 * najviac `limit` a nečinné (bez rozpracovaného chatu) uvoľní cez
 * `DELETE /api/debug/location` (server.ts). Ďalšia požiadavka lokáciu znovu postaví.
 */

import { isAbsolute, relative } from "node:path";

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
  /**
   * Rýchla kontrola pre zastaraný neotvorený priečinok: `true` len pri jasnej odpovedi „beží chat“.
   * Neotvorený priečinok nemôže mať chat spustený cez LAWOSS (každý chat ho otvorí v rozpočte), preto
   * nevypovedaná odpoveď (inštancia ešte štartuje) uvoľnenie nezdrží. Bez nej sa použije `busy`.
   */
  staleBusy?: (scope: EngineScope) => Promise<boolean>;
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
  /** Poradie posledného otvorenia MCP. Koniec dlhej požiadavky (beh chatu) ho na rozdiel od `lastUsed` neposunie. */
  opened: number;
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
  /**
   * Klient a jeho prípady (`root` a jeho podpriečinky) sú pre čítanie stavu MCP jedno miesto: priečinok
   * bez MCP zastúpi priečinok klienta, ktorý ich má spustené, aby čítanie nespustilo druhú sadu procesov.
   */
  residentWithin(scope: EngineScope, root: string): string | null;
  /**
   * Aktivácia klienta: engine má znova prečítať jeho konfiguráciu. Uvoľní inštanciu v poradí prijímania, aby
   * nasledujúci dotyk MCP počkal; bežiaci chat nepreruší (vráti `false`). MCP sa spustia až pri ďalšom použití.
   */
  reset(scope: EngineScope): Promise<boolean>;
  /**
   * Konfigurácia neotvoreného priečinka sa zmenila (Marketplace, SystemOne, politika firmy). Inštancia bez MCP
   * sa neuvoľní hneď (bočný panel by ju o chvíľu postavil znova); uvoľní sa až pred ďalším prijatím MCP.
   */
  markStale(scope: EngineScope): void;
  /** Pred akoukoľvek požiadavkou do priečinka: zastaranú inštanciu uvoľní (bežiaci chat nepreruší). */
  refreshIfStale(scope: EngineScope): Promise<void>;
  /** Iná požiadavka do adresára predĺži jeho životnosť, ak je aktívny. */
  touch(scope: EngineScope): void;
  /** Inštanciu uvoľnil niekto iný (reload); prestane sa evidovať. */
  forget(scope: EngineScope): void;
  /** Uvoľní nečinné inštancie po `idleMs`. */
  sweep(): Promise<void>;
  activeDirectories(): string[];
  close(): void;
};

const MCP_SESSION_ACTION = /^(?:\/api)?\/session\/([^/]+)\/(?:prompt|command|synthetic|shell|compact|fork|generate|skill)$/;

/**
 * Chat, ktorý požiadavka spúšťa. Engine ho spustí v priečinku chatu, nie v priečinku požiadavky: chat
 * prípadu z frontu správ prichádza cez koreň klienta, MCP a stav behu sú však v priečinku prípadu.
 */
export function engineSessionAction(method: string, path: string): string | null {
  return method.toUpperCase() === "POST" ? path.match(MCP_SESSION_ACTION)?.[1] ?? null : null;
}

/**
 * Engine v2 (2.1.4, `protocol/src/groups/*.ts`): cesty bez strednej vrstvy lokácie. Žiadna z nich
 * nepostaví služby lokácie, a teda ani jej MCP: informácie o serveri, udalosti, zoznam, vytvorenie,
 * presun, zmazanie a čítanie chatov a ich správ, stav behu, migrácia histórie, ladenie, prihlasovacie údaje.
 */
const LOCATION_FREE: Record<string, RegExp> = {
  GET: /^\/(?:info|event|session|session\/active|experimental\/session\/stats|experimental\/migration\/v1|session\/[^/]+(?:\/(?:context|diff|inbox|message(?:\/[^/]+)?))?|experimental\/session\/[^/]+\/export|debug\/.+|credential(?:\/.+)?|experimental\/persistent-pty\/.+)$/,
  POST: /^\/(?:session|experimental\/session\/import|session\/[^/]+\/(?:move|interrupt)|credential(?:\/.+)?)$/,
  DELETE: /^\/(?:session\/[^/]+|session\/[^/]+\/inbox\/[^/]+|debug\/location|credential\/.+)$/,
  PATCH: /^\/credential\/.+$/,
};

/** Cesta bez prefixu `/api`, ako ju vidí proxy aj klient enginu. */
export function enginePath(path: string): string {
  return path.replace(/^\/api(?=\/|$)/, "") || "/";
}

/** Engine v2: požiadavka postaví lokáciu (pluginy a všetky jej MCP), ak nejde o cestu mimo lokácie. */
export function initializesEngineMcp(method: string, path: string): boolean {
  const verb = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();
  return !LOCATION_FREE[verb]?.test(enginePath(path));
}

/** Engine cesty, ktorých odpoveď závisí od konfigurácie lokácie (poskytovatelia, modely, agenti, skilly). */
export function readsEngineConfig(path: string): boolean {
  return /^\/(?:provider|config|agent|skill|model|command)(?:\/|$)/.test(enginePath(path));
}

export function scopeKey(scope: Pick<EngineScope, "baseUrl" | "directory">): string {
  return JSON.stringify([scope.baseUrl.replace(/\/+$/, ""), scope.directory]);
}

/**
 * Poradie zmien MCP stavu v jednom priečinku: uvoľnenie lokácie čaká na rozbehnutú zmenu MCP
 * a zmena MCP na rozbehnuté uvoľnenie, aby proces MCP neprežil uvoľnenú lokáciu.
 */
export function createEngineDirectoryLanes() {
  const lanes = new Map<string, Promise<void>>();
  return <T>(scope: Pick<EngineScope, "baseUrl" | "directory">, run: () => Promise<T>): Promise<T> => {
    const key = scopeKey(scope);
    const result = (lanes.get(key) ?? Promise.resolve()).then(run);
    const tail = result.then(() => undefined, () => undefined).then(() => {
      if (lanes.get(key) === tail) lanes.delete(key);
    });
    lanes.set(key, tail);
    return result;
  };
}

/**
 * Počká na prácu najviac `ms`. Skorá chyba sa vráti volajúcemu, neskorá už nemá komu, preto ide do `onLate`.
 * Nikdy sa nezamietne, takže výsledok sa môže prevziať aj neskôr.
 */
export function settleWithin(work: Promise<unknown>, ms: number, onLate: (error: unknown) => void): Promise<{ error?: unknown }> {
  return new Promise((resolve) => {
    let answered = false;
    const timer = setTimeout(() => { answered = true; resolve({}); }, ms);
    work.then(
      () => { clearTimeout(timer); resolve({}); },
      (error: unknown) => {
        clearTimeout(timer);
        if (answered) onLate(error);
        else resolve({ error });
      },
    );
  });
}

function containsDirectory(root: string, directory: string): boolean {
  const path = relative(root, directory);
  return path.split(/[\\/]/)[0] !== ".." && !isAbsolute(path);
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
  const stale = new Set<string>();
  const staleBusy = (scope: EngineScope) => (options.staleBusy ?? options.busy)(scope).catch(() => false);
  let openings = 0;
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

  // Uvoľňuje najdlhšie neotvorené, kým ostane najviac `keep` aktívnych. `sparing` nechá
  // najnovšie otvorených: práve otvorený klient ostáva, aj keď je starší nad limitom zaneprázdnený.
  const makeRoom = async (keep: number, sparing = 0) => {
    if (options.limit === 0) return;
    const candidates = [...active.entries()].sort((a, b) => a[1].opened - b[1].opened).slice(0, sparing ? -sparing : undefined);
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
        existing.opened = ++openings;
        await existing.ready.catch(() => undefined);
        return release(existing);
      }
      return serialized(async () => {
        const current = active.get(key);
        if (current) {
          current.inflight += 1;
          current.lastUsed = now();
          current.opened = ++openings;
          return release(current);
        }
        await makeRoom(options.limit - 1);
        // Zastaraná inštancia (zmena konfigurácie, kým bol klient neotvorený) sa pred MCP postaví znova.
        if (stale.has(key) && !(await staleBusy(scope)) && stale.delete(key)) {
          await options.dispose(scope).catch(() => undefined);
          options.log?.("Engine instance released", { "engine.directory": scope.directory, "engine.reason": "stale" });
        }
        const entry: Entry = { scope, lastUsed: now(), opened: ++openings, inflight: 1, ready: Promise.resolve() };
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
      stale.delete(key);
      return serialized(async () => {
        const current = active.get(key);
        if (current) { current.lastUsed = now(); current.opened = ++openings; return; }
        await makeRoom(options.limit - 1);
        active.set(key, { scope, lastUsed: now(), opened: ++openings, inflight: 0, ready: Promise.resolve() });
      });
    },
    residentWithin(scope, root) {
      if (options.limit === 0 || active.has(scopeKey(scope))) return null;
      const server = scope.baseUrl.replace(/\/+$/, "");
      const residents = [...active.values()]
        .filter((entry) => entry.scope.baseUrl.replace(/\/+$/, "") === server && containsDirectory(root, entry.scope.directory))
        .sort((a, b) => b.lastUsed - a.lastUsed);
      return residents[0]?.scope.directory ?? null;
    },
    reset(scope) {
      const key = scopeKey(scope);
      return serialized(async () => {
        const entry = active.get(key);
        if (entry && entry.inflight > 0) return false;
        if (await options.busy(scope).catch(() => true)) return false;
        if (active.get(key) !== entry || (entry && entry.inflight > 0)) return false;
        active.delete(key);
        stale.delete(key);
        try {
          await options.dispose(scope);
        } catch (error) {
          if (entry && !active.has(key)) active.set(key, entry);
          throw error;
        }
        options.log?.("Engine instance released", { "engine.directory": scope.directory, "engine.reason": "reset" });
        return true;
      });
    },
    markStale(scope) {
      const key = scopeKey(scope);
      if (!active.has(key)) stale.add(key);
    },
    refreshIfStale(scope) {
      const key = scopeKey(scope);
      if (!stale.has(key)) return Promise.resolve();
      return serialized(async () => {
        if (!stale.has(key) || active.has(key)) { stale.delete(key); return; }
        // Bežiaci chat sa nepreruší; obnoví sa pri ďalšej požiadavke po jeho dobehnutí.
        if (await staleBusy(scope)) return;
        if (!stale.delete(key)) return;
        await options.dispose(scope).catch(() => undefined);
        options.log?.("Engine instance released", { "engine.directory": scope.directory, "engine.reason": "stale" });
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
        if (options.limit > 0 && active.size > options.limit) await makeRoom(options.limit, options.limit);
      });
    },
    activeDirectories() {
      return [...active.values()].map((entry) => entry.scope.directory);
    },
    close() {
      active.clear();
      stale.clear();
    },
  };
}
