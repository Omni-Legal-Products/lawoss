/**
 * LAWOSS #530: engine nečíta ani nesleduje konfiguráciu nadradených priečinkov klienta.
 *
 * OpenCode 2.1.4 (`packages/core/src/config/discovery.ts`) prechádza od priečinka lokácie všetky nadradené
 * priečinky až po koreň disku a z každého načíta a sleduje `.opencode` a `opencode.json(c)` (skilly, agenti,
 * pluginy, príkazy, MCP). Engine má vlastný domov, takže skutočný domov používateľa (napr. `~/.opencode`)
 * je preň obyčajný nadradený priečinok klienta. Derivát `2.1.4-legalwork.lawoss-project-stop.1`
 * (`docs/patches/opencode-2.1.4-lawoss-project-stop.patch`) pridal premennú `OPENCODE_CONFIG_PROJECT_STOP`:
 * JSON zoznam koreňov, prechod každej lokácie skončí na najdlhšom koreni, ktorý ju obsahuje (koreň sa ešte
 * prehľadá), a lokácia mimo všetkých koreňov sa prehľadá len sama.
 *
 * Korene sú všetky miestne pracovné priestory (klienti, domovský priestor appky, wiki), koreň praxe
 * a pracovný priečinok enginu. Prípad vo vnútri klienta tak stále dostane `.opencode` klienta a nový
 * klient založený v praxi po štarte enginu skončí najneskôr na koreni praxe. Korene sa počítajú pri
 * každom (re)štarte enginu (`createConfiguredManagedEngine`). Prechod je lexikálny, preto každý koreň
 * ide v pôvodnom zápise aj ako skutočná cesta.
 */
import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import type { ServerConfig } from "../types.js";
import { canonicalPath } from "./linked-folders-rules.js";
import { officeRoot } from "./linked-folders.js";
import { practiceRootOf } from "./unadopted-clients.js";

/** Premenná derivátu: JSON pole absolútnych koreňov, na ktorých končí prechod konfigurácie projektu. */
export const ENGINE_PROJECT_STOP_ENV = "OPENCODE_CONFIG_PROJECT_STOP";

/** Pôvodný zápis, skutočná cesta a jej NFC tvar; neexistujúci priečinok ostane v pôvodnom zápise. */
async function spellings(path: string): Promise<string[]> {
  const real = await realpath(path).catch(() => null);
  return [path, ...(real ? [real] : []), await canonicalPath(path)];
}

/** Korene prechodu konfigurácie: miestne pracovné priestory, koreň praxe a pracovný priečinok enginu. */
export async function engineProjectStopRoots(config: ServerConfig, engineCwd?: string): Promise<string[]> {
  const office = await officeRoot(config);
  const roots = [
    ...config.workspaces.flatMap((workspace) => (workspace.path ? [workspace.path] : [])),
    ...(office ? [practiceRootOf(office)] : []),
    ...(engineCwd ? [engineCwd] : []),
  ].filter((root) => isAbsolute(root));
  return [...new Set((await Promise.all(roots.map(spellings))).flat())];
}

/** Premenná pre engine; ide do `env` každého spusteného enginu. */
export async function engineProjectStopEnv(config: ServerConfig, engineCwd?: string): Promise<Record<string, string>> {
  return { [ENGINE_PROJECT_STOP_ENV]: JSON.stringify(await engineProjectStopRoots(config, engineCwd)) };
}
