import type { ServerConfig } from "../types.js";

/**
 * LAWOSS: zabudované súbory upstreamu (skilly `legalwork-help`, `pdf-tools`, `docx-edit` a ďalšie, príkazy a agenti,
 * spolu ~7 MB) majú jednu kópiu v profile appky (`managed-core-library.ts`). Engine ich odtiaľ dostane v oboch režimoch:
 * skilly cez `skills` z `resolveCapabilityLibrary(…, coreRoot)`, príkazy a agentov cez `managedCoreConfiguration()`.
 * Kópia do `.opencode/` každého klienta bola navyše: test pred spustením alfy 12. 11. 2026 ju našiel v 24 klientoch
 * (~200 MB, na cloudovom disku alebo NAS sa synchronizuje). Kópie z predchádzajúcich zostáv ostávajú, nič sa nemaže.
 */
export const copiesBundledCoreIntoWorkspace = (_config: ServerConfig): boolean => false;
