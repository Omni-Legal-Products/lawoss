/**
 * #454: spravovaný engine, ktorý po štarte skončí (pád, OOM, kill), sa spustí znova s odstupom a obmedzeným
 * počtom pokusov. Zámerné ukončenie (`close()` pri zatváraní appky alebo pri prepnutí režimu) sem nepríde:
 * handle enginu hlási len neočakávané ukončenie. Počítadlo pokusov sa vynuluje, keď engine pred pádom bežal
 * dlhšie ako `stableMs`. Žiadny nový proces okrem samotného enginu, jeden časovač (RAM 2 GB, #367).
 */
export const ENGINE_RESTART_DELAYS_MS: readonly number[] = [1_000, 3_000, 10_000, 30_000, 60_000];
export const ENGINE_STABLE_MS = 5 * 60_000;

/** Stav pre `/health` (`config.managedEngineStatus`); „ready“ nastaví samotné spustenie enginu. */
export type SupervisedEngineStatus = "starting" | "error";

type Timer = object;

export type EngineSupervisorOptions<Engine> = {
  /** Nahradí ukončený engine novým; zlyhanie vyhodí chybu. Engine medzičasom nahradený inou cestou ignoruje. */
  restart: (exited: Engine) => Promise<void>;
  status: (status: SupervisedEngineStatus) => void;
  log?: (message: string) => void;
  delays?: readonly number[];
  stableMs?: number;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
};

export function createEngineSupervisor<Engine>(options: EngineSupervisorOptions<Engine>) {
  const delays = options.delays ?? ENGINE_RESTART_DELAYS_MS;
  const stableMs = options.stableMs ?? ENGINE_STABLE_MS;
  const now = options.now ?? Date.now;
  const timers = new WeakMap<Timer, ReturnType<typeof setTimeout>>();
  const setTimer = options.setTimer ?? ((run, ms) => { const handle = setTimeout(run, ms); handle.unref?.(); const key = {}; timers.set(key, handle); return key; });
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timers.get(timer)));
  const log = options.log ?? ((message: string) => console.warn(message));
  let attempts = 0, closed = false, startedAt = now();
  let timer: Timer | undefined;

  const schedule = (exited: Engine) => {
    if (closed || timer) return;
    const delay = delays[attempts];
    if (delay === undefined) {
      options.status("error");
      log(`[managed-opencode] engine restart gave up after ${attempts} attempts`);
      return;
    }
    attempts++;
    options.status("starting");
    timer = setTimer(() => { timer = undefined; void run(exited); }, delay);
  };

  const run = async (exited: Engine) => {
    if (closed) return;
    try {
      await options.restart(exited);
      startedAt = now();
    } catch (error) {
      if (closed) return;
      log(`[managed-opencode] engine restart attempt ${attempts} failed: ${error instanceof Error ? error.message : String(error)}`);
      schedule(exited);
    }
  };

  return {
    /** Sleduje engine; vráti ho, aby sa dal zapojiť do reťazca vytvorenia. */
    watch(engine: Engine & { onUnexpectedExit?: (listener: () => void) => () => void }): Engine {
      engine.onUnexpectedExit?.(() => {
        if (closed) return;
        if (now() - startedAt >= stableMs) attempts = 0;
        log(`[managed-opencode] restarting the engine (attempt ${attempts + 1}/${delays.length})`);
        schedule(engine);
      });
      return engine;
    },
    close() {
      closed = true;
      if (timer) clearTimer(timer);
      timer = undefined;
    },
  };
}
