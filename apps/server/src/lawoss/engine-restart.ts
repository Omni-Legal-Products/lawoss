/**
 * LAWOSS #454: obnova enginu po neočakávanom skončení (pád, OOM, kill).
 *
 * Rozpočet tvoria reštarty, ktoré engine neprežil aspoň `stableMs`. Engine, ktorý potom beží
 * dlhšie, dostane pri ďalšom páde celý rozpočet znova; engine, ktorý padá hneď po štarte,
 * sa po vyčerpaní rozpočtu nechá zastavený a server hlási `error`.
 */
export type EngineExit = { code: number | null; signal: NodeJS.Signals | null };

export type EngineRestartOptions = {
  /** Čakanie pred jednotlivými pokusmi; ich počet je limit pokusov. */
  delaysMs: readonly number[];
  /** Ako dlho musí engine bežať, aby sa jeho pád počítal ako nový výpadok. */
  stableMs: number;
};

export const ENGINE_RESTART_DEFAULTS: EngineRestartOptions = { delaysMs: [1_000, 4_000, 15_000], stableMs: 60_000 };

export function createEngineRestartBudget(options: EngineRestartOptions = ENGINE_RESTART_DEFAULTS, now: () => number = Date.now) {
  let used = 0;
  let startedAt = now();
  return {
    /** Engine je pripravený a zverejnený. */
    started() { startedAt = now(); },
    /** Engine skončil sám; ak bežal dosť dlho, ide o nový výpadok. */
    exited() { if (now() - startedAt >= options.stableMs) used = 0; },
    /** Čakanie pred ďalším pokusom, alebo `null`, keď je rozpočet vyčerpaný. */
    nextDelay(): number | null {
      const delay = options.delaysMs[used];
      if (delay === undefined) return null;
      used += 1;
      return delay;
    },
  };
}

export function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    timer.unref?.();
    signal.addEventListener("abort", done, { once: true });
  });
}
