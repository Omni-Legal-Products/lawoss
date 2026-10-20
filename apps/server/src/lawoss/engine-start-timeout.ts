/**
 * LAWOSS: ako dlho server čaká, kým sa engine (OpenCode) ohlási a odpovie na
 * `/global/health`. Upstream čaká natvrdo 15 s, čo na macOS stačí.
 *
 * Na Windows to nestačí. Test IR 19. 10. 2026 (Windows 11, Intel i5-1334U,
 * Avast): samotný `opencode --version` zo sidecaru (171 MB) trval 11 až 19 s
 * a `opencode serve` 28 až 46 s, pričom väčšina času uplynula ešte pred prvým
 * riadkom logu enginu (antivírus kontroluje binárku pri každom spustení). Ani
 * s výnimkou v antivíruse sa engine počas štartu appky nezmestil do 15 s.
 * Appka potom engine zabila a ukázala „Timeout waiting for OpenCode server
 * after 15000ms“ (lawoss#185).
 *
 * Na Windows preto čakáme dlhšie. Pomalší štart počká, zaseknutý engine sa
 * stále ukončí. `LAWOSS_ENGINE_START_TIMEOUT_MS` limit prepíše na každej
 * platforme (pomalý stroj, diagnostika); neplatná hodnota sa ignoruje.
 */

/** Celé milisekundy, napr. `120000`. */
export const ENGINE_START_TIMEOUT_ENV = "LAWOSS_ENGINE_START_TIMEOUT_MS";

/** Pôvodný limit upstreamu (`managed-opencode.ts`). */
export const DEFAULT_ENGINE_START_TIMEOUT_MS = 15_000;

/** Približne dvojnásobok najhoršieho nameraného štartu na Windows (46 s). */
export const WINDOWS_ENGINE_START_TIMEOUT_MS = 90_000;

const MIN_OVERRIDE_MS = 1_000;
const MAX_OVERRIDE_MS = 600_000;

export type EngineStartTimeoutOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
};

export function engineStartTimeoutMs(options: EngineStartTimeoutOptions = {}): number {
  const { platform = process.platform, env = process.env } = options;
  const raw = env[ENGINE_START_TIMEOUT_ENV]?.trim() ?? "";
  if (/^\d+$/.test(raw)) {
    const value = Number(raw);
    if (value >= MIN_OVERRIDE_MS && value <= MAX_OVERRIDE_MS) return value;
  }
  return platform === "win32" ? WINDOWS_ENGINE_START_TIMEOUT_MS : DEFAULT_ENGINE_START_TIMEOUT_MS;
}
