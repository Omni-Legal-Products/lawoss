/**
 * LAWOSS: zdroj integrácií „LegalWork“ (rozhodnutie MČ 5. 10. 2026, alfa 1).
 *
 * Integrácie majú tri zdroje:
 * - LAWOSS (predvolený, vždy zapnutý): náš katalóg a pribalené nástroje;
 * - LegalWork (voliteľný, predvolene vypnutý): upstream konektory (vzdialené MCP
 *   tretích strán, Computer Use, LegalWork UI, vstavaný Google Workspace) a LegalQuants;
 * - vlastné: Pridať MCP, import z GitHubu a import skills, bez zmeny.
 *
 * Voľba je lokálna pre zariadenie ako režim zobrazenia (`lite/ui-mode.ts`) a
 * experimenty (`experiments/store.ts`): localStorage, nikdy workspace ani server.
 * Zapnutie len odkryje položky v UI; samo nič nepripája a nič nesťahuje.
 *
 * Modul nemá importy: číta ho `feature-flags.ts`, ktorý importuje `app/constants.ts`.
 */

export const LEGALWORK_SOURCE_STORAGE_KEY = "lawoss.integrations.legalworkSource";

/** Jediná hodnota, ktorá zdroj zapína. Chýbajúca, poškodená alebo iná hodnota = vypnuté. */
const ENABLED_VALUE = "on";

const listeners = new Set<() => void>();

/** `globalThis` namiesto `window`, aby modul fungoval aj v testoch pod bun. */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(): boolean {
  try {
    return storage()?.getItem(LEGALWORK_SOURCE_STORAGE_KEY) === ENABLED_VALUE;
  } catch {
    return false;
  }
}

let enabled = read();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Je zapnutý zdroj LegalWork? Predvolene nie. */
export function isLegalworkSourceEnabled(): boolean {
  return enabled;
}

/** Uloží voľbu advokáta. Nevolá sieť ani server. */
export function setLegalworkSourceEnabled(next: boolean): void {
  if (next === enabled) return;
  enabled = next;
  try {
    if (next) storage()?.setItem(LEGALWORK_SOURCE_STORAGE_KEY, ENABLED_VALUE);
    else storage()?.removeItem(LEGALWORK_SOURCE_STORAGE_KEY);
  } catch {
    // Voľba platí aspoň pre túto reláciu.
  }
  notify();
}

export function subscribeLegalworkSource(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam: znovu načíta úložisko ako pri štarte appky. */
export function reloadLegalworkSourceFromStorage(): void {
  enabled = read();
  notify();
}
