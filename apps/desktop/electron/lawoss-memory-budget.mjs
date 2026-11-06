// LAWOSS: rozpočet RAM 2 GB pre celú aplikáciu (issue #367).
//
// Renderer (okno appky, karta prehliadača, náhľad) má bez limitu haldy V8
// strop daný veľkosťou RAM počítača; únik alebo obrovský dokument ho nechá
// rásť, kým systém nezačne swapovať. S limitom renderer pri vyčerpaní
// skončí s `render-process-gone: oom` a okno sa znovu načíta, ostatné
// procesy (engine, rozpracované chaty) bežia ďalej.
//
// Hlavný proces Electronu (a v ňom vložený server) týmto prepínačom
// obmedziť nejde: `js-flags` platia pre hlavný proces len z príkazového
// riadka pri spustení. Na to je potrebné server vyčleniť do vlastného procesu.

export const DEFAULT_RENDERER_HEAP_MB = 512;

/** Limit haldy rendererov v MB; `LAWOSS_RENDERER_HEAP_MB=0` ho vypne. */
export function rendererHeapLimitMb(env = process.env) {
  const raw = String(env.LAWOSS_RENDERER_HEAP_MB ?? "").trim();
  if (!raw) return DEFAULT_RENDERER_HEAP_MB;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return DEFAULT_RENDERER_HEAP_MB;
  // Pod 128 MB by appka nenaštartovala; taký údaj je preklep.
  return value === 0 ? 0 : Math.max(128, value);
}

/**
 * Pridá `--max-old-space-size` k `js-flags` rendererov. Explicitný limit
 * (napr. z ELECTRON_EXTRA_LAUNCH_ARGS) má prednosť. Volať pred `app.whenReady()`.
 *
 * @param {{ commandLine: { getSwitchValue(name: string): string, appendSwitch(name: string, value?: string): void } }} app
 * @returns {number | null} použitý limit alebo null
 */
export function applyRendererHeapLimit(app, env = process.env) {
  const limit = rendererHeapLimitMb(env);
  if (limit === 0) return null;
  const existing = String(app.commandLine.getSwitchValue("js-flags") ?? "").trim();
  if (/--max-old-space-size(?:=|\s|$)/.test(existing)) return null;
  app.commandLine.appendSwitch("js-flags", [existing, `--max-old-space-size=${limit}`].filter(Boolean).join(" "));
  return limit;
}
