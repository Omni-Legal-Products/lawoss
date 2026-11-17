import { statSync } from "node:fs";

/** @param {string} directory */
function isExistingDirectory(directory) {
  try {
    return statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

/**
 * LAWOSS: náhradný klient, keď štart vybraného klienta zlyhá. Len lokálny klient iný ako vybraný,
 * ktorého priečinok na disku existuje: chýbajúci (presunutý alebo zmazaný) priečinok by štart
 * odmietol tiež („Project folder is unavailable“). Taký klient ostáva zaregistrovaný na obnovenie.
 * Typ prvku zostane typom volajúceho (main.mjs číta z neho `id` a `appFiles`).
 * @template T
 * @param {readonly T[]} workspaces
 * @param {string} failedRoot
 * @param {(directory: string) => boolean} [isDirectory]
 * @returns {T | undefined}
 */
export function pickBootFallbackWorkspace(workspaces, failedRoot, isDirectory = isExistingDirectory) {
  return workspaces.find((item) => {
    const entry = /** @type {{ path?: unknown, workspaceType?: unknown } | null | undefined} */ (item);
    const candidatePath = String(entry?.path ?? "").trim();
    return entry?.workspaceType !== "remote" && Boolean(candidatePath) && candidatePath !== failedRoot && isDirectory(candidatePath);
  });
}
