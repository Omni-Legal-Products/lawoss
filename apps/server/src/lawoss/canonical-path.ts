import { realpath as nativeRealpath } from "node:fs/promises";

const SHARE_ROOT = /^\\\\[^\\]+\\[^\\]+$/;

/**
 * Windows: natívny realpath vracia koreň zdieľania ako `\\nas\Kancelaria` bez koncovej
 * lomky, `resolve()` ten istý priečinok ako `\\nas\Kancelaria\` (overené na runneri
 * windows-2022 5. 10. 2026). Kontroly `realpath(x) === resolve(x)` by preto odmietli
 * kanceláriu na disku `Z:` namapovanom priamo na zdieľanie. Rovnaká funkcia je
 * v `lawoss/okf/src/canonical-path.ts` (OKF sa do servera balí zvlášť).
 */
export function withShareRootSeparator(real: string, platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" && SHARE_ROOT.test(real) ? `${real}\\` : real;
}

/** `realpath` z `node:fs/promises` s koreňom zdieľania v tvare, aký vracia `resolve()`. */
export async function realpath(path: string): Promise<string> {
  return withShareRootSeparator(await nativeRealpath(path));
}
