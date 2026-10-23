import { runCli } from "../okf-pamat/src/cli.ts";
import { findClientDir, findSubjectDir } from "../okf-pamat/src/store.ts";
import { readWorkspaceMemory, renderWorkspaceMemory } from "../okf-pamat/src/workspace-memory.ts";
import { workspaceProfilePresent } from "./workspace-checkpoint.mjs";

/**
 * LAWOSS (alfa 2, N-A3-3, MČ 23. 10. 2026): čítanie pamäte spisu bez shellu a bez karty.
 * Ten istý kód ako `okf-memory preamble|read`, v procese servera, bez podprocesu a bez zápisu.
 * Zápisy (`write`, `init`, `sync`, `retrofit`, `workspace-save`) tu zámerne nie sú: idú ďalej cez CLI so schválením.
 */

/** Priečinky nad spisom, ktoré `read`/`preamble` prečíta okrem spisu a kancelárie; hranicu overí volajúci. */
export function matterMemoryScope(directory) {
  try {
    const clientDir = findClientDir(directory);
    return { clientDir, subjectDir: clientDir ? findSubjectDir(directory) : undefined };
  } catch {
    // Nečitateľný konfig kancelárie: `readScope` vtedy klienta nečíta a ohlási problém.
    return {};
  }
}

/** `preamble` alebo `read` ako CLI; pamäť s profilom číta `read` s koreňmi od hostiteľa. */
export function readMatterMemory(action, directory, { allowedRoots = [] } = {}) {
  if (action === "read" && workspaceProfilePresent(directory)) {
    const report = readWorkspaceMemory(directory, { allowedRoots });
    return { code: report.complete ? 0 : 1, out: renderWorkspaceMemory(report) };
  }
  return runCli([action, directory]);
}
