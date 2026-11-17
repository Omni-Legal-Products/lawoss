/**
 * #454: spravovaný engine, ktorý po štarte skončí (pád, OOM, kill), sa spustí znova s odstupom. Zámerné
 * ukončenie (`close()` pri zatváraní appky alebo pri prepnutí režimu) sem nepríde: handle enginu hlási len
 * neočakávané ukončenie. Dozor si pamätá, ktoré enginy skončili; pokus vždy nahradí *aktuálny* engine, ak je
 * mŕtvy, inak nerobí nič. Zlyhaný pokus vždy naplánuje ďalší (čakajúci pokus sa nikdy nezahodí); po rýchlych
 * pokusoch hlási `error` a skúša ďalej pomaly (`slowMs`), aby výpadok nebol konečný. Počítadlo sa vynuluje,
 * keď engine pred pádom bežal dlhšie ako `stableMs`. Žiadny nový proces, jeden časovač (RAM 2 GB, #367).
 */
export const ENGINE_RESTART_DELAYS_MS: readonly number[] = [1_000, 3_000, 10_000, 30_000, 60_000];
export const ENGINE_SLOW_RETRY_MS = 5 * 60_000;
export const ENGINE_STABLE_MS = 5 * 60_000;

/** Stav pre `/health` (`config.managedEngineStatus`); „ready“ nastaví samotné spustenie enginu. */
export type SupervisedEngineStatus = "starting" | "error";

type Timer = object;
type Watchable = { onUnexpectedExit?: (listener: () => void) => () => void };

export type EngineSupervisorOptions<Engine> = {
  /** Aktuálne publikovaný engine (alebo posledný mŕtvy, ak náhrada zlyhala). */
  current: () => Engine | undefined;
  /** Nahradí aktuálny engine novým; zlyhanie vyhodí chybu. */
  restart: () => Promise<void>;
  status: (status: SupervisedEngineStatus) => void;
  log?: (message: string) => void;
  delays?: readonly number[];
  slowMs?: number;
  stableMs?: number;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
};

export function createEngineSupervisor<Engine extends object>(options: EngineSupervisorOptions<Engine>) {
  const delays = options.delays ?? ENGINE_RESTART_DELAYS_MS;
  const slowMs = options.slowMs ?? ENGINE_SLOW_RETRY_MS;
  const stableMs = options.stableMs ?? ENGINE_STABLE_MS;
  const now = options.now ?? Date.now;
  const timers = new WeakMap<Timer, ReturnType<typeof setTimeout>>();
  const setTimer = options.setTimer ?? ((run, ms) => { const handle = setTimeout(run, ms); handle.unref?.(); const key = {}; timers.set(key, handle); return key; });
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timers.get(timer)));
  const log = options.log ?? ((message: string) => console.warn(message));
  const dead = new WeakSet<Engine>();
  let attempts = 0, closed = false, running = false, again = false, startedAt = now();
  let timer: Timer | undefined;

  const currentDead = () => { const engine = options.current(); return engine !== undefined && dead.has(engine); };

  /** Naplánuje ďalší pokus, ak ešte nijaký nečaká ani nebeží; po rýchlych pokusoch pomaly a so stavom `error`. */
  const schedule = () => {
    if (closed) return;
    if (running) { again = true; return; }
    if (timer) return;
    const fast = delays[attempts];
    attempts++;
    if (fast === undefined) {
      options.status("error");
      log(`[managed-opencode] engine restart failed ${attempts - 1} times; retrying every ${Math.round(slowMs / 1000)} s`);
    } else options.status("starting");
    timer = setTimer(() => { timer = undefined; void run(); }, fast ?? slowMs);
  };

  const run = async () => {
    if (closed) return;
    if (!currentDead()) return;
    running = true; again = false;
    let failed = false;
    try {
      await options.restart();
      startedAt = now();
    } catch (error) {
      failed = true;
      log(`[managed-opencode] engine restart attempt ${attempts} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally { running = false; }
    // Zlyhanie alebo pád náhrady počas pokusu: ďalší pokus, nikdy nič nezahodiť.
    if (!closed && (failed || again || currentDead())) schedule();
  };

  return {
    /** Sleduje engine; vráti ho, aby sa dal zapojiť do reťazca vytvorenia. */
    watch<Watched extends Engine & Watchable>(engine: Watched): Watched {
      engine.onUnexpectedExit?.(() => {
        dead.add(engine);
        if (closed || engine !== options.current()) return;
        if (now() - startedAt >= stableMs) attempts = 0;
        log(`[managed-opencode] restarting the engine (attempt ${attempts + 1}/${delays.length})`);
        schedule();
      });
      return engine;
    },
    /**
     * #477: „Skúsiť znova“ v stavovom riadku. Čakajúci pokus sa spustí hneď namiesto po odstupe; pri bežiacom
     * engine alebo počas pokusu nerobí nič (`false`), takže opakované kliknutie nezaradí ďalší pokus.
     */
    retryNow(): boolean {
      if (closed || running || !currentDead()) return false;
      if (timer) clearTimer(timer);
      timer = undefined;
      options.status("starting");
      log("[managed-opencode] engine restart requested by the user");
      void run();
      return true;
    },
    /** Aktuálny engine skončil (pre kontrolu mimo udalosti, napr. po zlyhanom publikovaní). */
    isDead: (engine: Engine) => dead.has(engine),
    close() {
      closed = true;
      if (timer) clearTimer(timer);
      timer = undefined;
    },
  };
}
