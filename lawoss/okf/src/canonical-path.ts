import { realpath as nativeRealpath } from "node:fs/promises";

const SHARE_ROOT = /^\\\\[^\\]+\\[^\\]+$/;
const DRIVE_ROOT = /^[A-Za-z]:$/;

/**
 * Windows: natívny realpath vracia koreň zdieľania ako `\\nas\Kancelaria` bez koncovej
 * lomky, `resolve()` ten istý priečinok ako `\\nas\Kancelaria\` (overené na runneri
 * windows-2022 5. 10. 2026). Kontroly `realpath(x) === resolve(x)` by preto odmietli
 * kanceláriu na disku `Z:` namapovanom priamo na zdieľanie. Iný rozdiel tu nie je:
 * symlinky a junctiony sa rozbalia a odmietnu ako doteraz, mimo Windows bez zmeny.
 * Bun 1.4.2 navyše vracia z `fs.promises.realpath` koreň disku ako `C:` bez lomky
 * (oven-sh/bun#42581, Node `C:\`); `C:` je cesta relatívna k aktuálnemu priečinku disku,
 * preto sa doplní lomka aj jemu. V bundli OKF (Node) sa to neprejaví.
 */
export function withShareRootSeparator(real: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" && (SHARE_ROOT.test(real) || DRIVE_ROOT.test(real)) ? `${real}\\` : real;
}

/** `realpath` z `node:fs/promises` s koreňom zdieľania v tvare, aký vracia `resolve()`. */
export async function realpath(path: string): Promise<string> {
  return withShareRootSeparator(await nativeRealpath(path));
}
