import { resolve } from "node:path";
import { runCli } from "../okf-pamat/src/cli.ts";
import { findClientDir, findOfficeDir, findSubjectDir } from "../okf-pamat/src/store.ts";
import { readWorkspaceMemory, renderWorkspaceMemory } from "../okf-pamat/src/workspace-memory.ts";
import { workspaceProfilePresent } from "./workspace-checkpoint.mjs";

/** Limity ohraničeného čítania (okf-pamat `safe-read.ts`): súbor a jeden adresár `memory/`. */
export { FILE_BYTE_LIMIT, STORE_BYTE_LIMIT } from "../okf-pamat/src/safe-read.ts";

/**
 * LAWOSS (alfa 2, N-A3-3, MČ 23. 10. 2026): čítanie pamäte spisu bez shellu a bez karty.
 * Ten istý kód ako `okf-memory preamble|read`, v procese servera, bez podprocesu a bez zápisu.
 * Zápisy (`write`, `init`, `sync`, `retrofit`, `workspace-save`) tu zámerne nie sú: idú ďalej cez CLI so schválením.
 */

/** Priečinky mimo spisu, ktoré `read`/`preamble` prečíta (klient, subjekt, kancelária); hranicu overí volajúci. */
export function matterMemoryScope(directory) {
  // Rovnaké pravidlo ako `readScope`: kancelária, ktorou je sám spis, sa nečíta druhýkrát.
  const found = findOfficeDir(directory);
  const officeDir = found && resolve(found) !== resolve(directory) ? found : undefined;
  try {
    const clientDir = findClientDir(directory);
    return { clientDir, subjectDir: clientDir ? findSubjectDir(directory) : undefined, officeDir };
  } catch {
    // Nečitateľný konfig kancelárie: `readScope` vtedy klienta nečíta a ohlási problém.
    return { officeDir };
  }
}

/**
 * `preamble` alebo `read` ako CLI; pamäť s profilom číta `read` s koreňmi od hostiteľa.
 * `office: false`: hostiteľ kanceláriu nad spisom nepotvrdil; jej pamäť sa nečíta a čítanie je neúplné.
 */
export function readMatterMemory(action, directory, { allowedRoots = [], office = true } = {}) {
  if (action === "read" && workspaceProfilePresent(directory)) {
    const report = readWorkspaceMemory(directory, { allowedRoots });
    return { code: report.complete ? 0 : 1, out: renderWorkspaceMemory(report) };
  }
  return runCli([action, directory], { office });
}
