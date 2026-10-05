/**
 * LAWOSS: engine (OpenCode) sa sám nespája s katalógom modelov, so zdieľaním
 * ani s aktualizáciou. Rozhodnutie MČ 5. 10. 2026: Eigenwelt nesmie byť aktívne
 * pripojený na appku; upstream predvolene sťahoval katalóg zo zrkadla
 * Eigenweltu pri každom štarte a potom každú hodinu.
 *
 * OpenCode 1.18.29 (overené v binárke aj izolovaným behom): katalóg číta najprv
 * z `OPENCODE_MODELS_PATH`, potom zo snapshotu zabudovaného v binárke. Popri tom
 * ho hneď po štarte a potom každú hodinu obnovuje zo siete; to vypína
 * `OPENCODE_DISABLE_MODELS_FETCH`. Vynútenú obnovu volajú len príkazy CLI
 * `auth login` a `models --refresh`, nie `serve`, ktorý appka spúšťa.
 *
 * Katalóg je pribalený v `lawoss/models-catalog/api.json`, obnovuje ho
 * `lawoss/scripts/update-models-catalog.mjs` (postup v `docs/upstream-sync-checklist.md`).
 * Keď súbor chýba (napr. samostatná binárka servera), engine použije svoj zabudovaný
 * snapshot, stále bez siete.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Prepíše cestu ku katalógu (testy, vlastný katalóg firmy). */
export const LAWOSS_MODELS_CATALOG_ENV = "LAWOSS_MODELS_CATALOG";

/** Cieľ `extraResources` v `apps/desktop/electron-builder.yml`. */
export const PACKAGED_CATALOG_DIR = "lawoss-models";
export const CATALOG_FILE = "api.json";

function resourcesPathFromAppAsar(path: string): string | null {
  const match = /[\\/]app\.asar(?:[\\/]|$)/.exec(path);
  return match ? path.slice(0, match.index) : null;
}

/**
 * Pribalený katalóg: v zabalenej appke vedľa `app.asar` (engine je samostatný
 * proces a do asar archívu nevidí), pri vývoji a testoch priamo z repozitára
 * (`apps/server/{src,dist}/lawoss` je o štyri úrovne nižšie ako koreň).
 */
export function bundledModelsCatalogPath(
  env: NodeJS.ProcessEnv = process.env,
  here: string = dirname(fileURLToPath(import.meta.url)),
): string | null {
  const override = env[LAWOSS_MODELS_CATALOG_ENV]?.trim();
  const resources = resourcesPathFromAppAsar(here);
  const candidates = [
    ...(override ? [override] : []),
    ...(resources ? [join(resources, PACKAGED_CATALOG_DIR, CATALOG_FILE)] : []),
    join(here, "..", "..", "..", "..", "lawoss", "models-catalog", CATALOG_FILE),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/**
 * Premenné prostredia pre každý engine, ktorý spúšťa server. Ide do prostredia
 * ako posledné, takže ich neprepíše ani `OPENCODE_MODELS_URL` z volajúceho.
 */
export function lawossEngineEnv(
  env: NodeJS.ProcessEnv = process.env,
  here?: string,
): Record<string, string> {
  const catalog = bundledModelsCatalogPath(env, here);
  return {
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    OPENCODE_DISABLE_SHARE: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    ...(catalog ? { OPENCODE_MODELS_PATH: catalog } : {}),
  };
}
