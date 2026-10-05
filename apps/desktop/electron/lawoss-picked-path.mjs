import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

/**
 * LAWOSS: kanonický tvar priečinka vybraného v dialógu (iba Windows).
 *
 * Prieskumník vráti priečinok na namapovanom sieťovom disku ako `Z:\Kancelaria`,
 * natívny `realpath` (GetFinalPathNameByHandle) z neho spraví `\\nas\share\Kancelaria`
 * a disk zo `subst` prepíše na cieľový priečinok (nodejs/node#37737). OKF, server aj
 * register pracovných priestorov prijímajú len kanonickú cestu (`realpath(x) === x`),
 * takže kancelária na NAS skončila hneď pri výbere chybou „Choose an existing
 * canonical directory“. Upstream ten istý tvar ukladá pri novom pracovnom priestore
 * (`normalizeLocalWorkspacePath`), preto cestu prevedieme naň hneď po výbere.
 *
 * Cesta so symbolickým odkazom alebo junction sa nemení: ďalšia kontrola ju odmietne
 * ako doteraz. Bez zmeny ostane aj pri akejkoľvek chybe a mimo Windows.
 *
 * @typedef {{ isSymbolicLink(): boolean, isDirectory(): boolean }} PickedPathStats
 * @typedef {{ lstat(path: string): Promise<PickedPathStats>, realpath(path: string): Promise<string> }} PickedPathFs
 * @param {string} selected
 * @param {{ platform?: NodeJS.Platform, fs?: PickedPathFs }} [options]
 * @returns {Promise<string>}
 */
export async function canonicalPickedDirectory(selected, { platform = process.platform, fs = { lstat, realpath } } = {}) {
  if (platform !== "win32" || typeof selected !== "string") return selected;
  const win = path.win32;
  if (!win.isAbsolute(selected)) return selected;
  try {
    const resolved = win.resolve(selected);
    const { root } = win.parse(resolved);
    let current = root;
    for (const part of resolved.slice(root.length).split(win.sep).filter(Boolean)) {
      current = win.join(current, part);
      if ((await fs.lstat(current)).isSymbolicLink()) return selected;
    }
    const canonical = await fs.realpath(resolved);
    if (!win.isAbsolute(canonical) || !(await fs.lstat(canonical)).isDirectory()) return selected;
    return canonical;
  } catch {
    return selected;
  }
}
