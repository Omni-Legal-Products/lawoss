import { lstat, realpath } from "node:fs/promises";
import path from "node:path";

const SHARE_ROOT = /^\\\\[^\\]+\\[^\\]+$/;
const DRIVE_ROOT = /^[A-Za-z]:$/;

/**
 * LAWOSS: Windows vracia z natívneho `realpath` koreň zdieľania ako `\\nas\Kancelaria`
 * bez koncovej lomky, `path.resolve()` ten istý priečinok s lomkou (overené na runneri
 * windows-2022 5. 10. 2026). Bez zjednotenia by kontrola `realpath(x) === resolve(x)`
 * odmietla disk `Z:` namapovaný priamo na zdieľanie. Rovnaká funkcia je
 * v `lawoss/okf/src/canonical-path.ts` a `apps/server/src/lawoss/canonical-path.ts`.
 * Koreň disku vrátený ako `C:` (Bun 1.4.2 `fs.promises.realpath`, oven-sh/bun#42581) dostane
 * lomku tiež; v Electrone (Node) sa to neprejaví, funkcia ostáva rovnaká ako na serveri.
 *
 * @param {string} real
 * @param {NodeJS.Platform} [platform]
 */
export function withShareRootSeparator(real, platform = process.platform) {
  return platform === "win32" && (SHARE_ROOT.test(real) || DRIVE_ROOT.test(real)) ? `${real}\\` : real;
}

/** `realpath` s koreňom zdieľania v tvare, aký vracia `path.resolve()`. @param {string} value */
export async function canonicalRealpath(value) {
  return withShareRootSeparator(await realpath(value));
}

/**
 * LAWOSS: kanonický tvar priečinka vybraného v dialógu (iba Windows).
 *
 * Prieskumník vráti priečinok na namapovanom sieťovom disku ako `Z:\Kancelaria`,
 * natívny `realpath` (GetFinalPathNameByHandle) z neho spraví `\\nas\share\Kancelaria`
 * a disk zo `subst` prepíše na cieľový priečinok (nodejs/node#37737). OKF, server aj
 * register pracovných priestorov prijímajú len kanonickú cestu (`realpath(x) === x`),
 * takže kancelária na NAS skončila hneď pri výbere chybou „Choose an existing
 * canonical directory“. Desktopový register ten istý tvar ukladá pri novom pracovnom
 * priestore (`normalizeLocalWorkspacePath`), preto cestu prevedieme naň hneď po výbere.
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
    const canonical = withShareRootSeparator(await fs.realpath(resolved), platform);
    if (!win.isAbsolute(canonical) || !(await fs.lstat(canonical)).isDirectory()) return selected;
    return canonical;
  } catch {
    return selected;
  }
}

/**
 * Výsledok dialógu pre handler `pickDirectory` v `main.mjs`: s voľbou `canonical`
 * prevedie každú cestu, inak ich vráti bez zmeny.
 *
 * @param {string[]} filePaths
 * @param {{ canonical?: boolean }} options
 * @param {(value: string) => Promise<string>} [canonicalize]
 * @returns {Promise<string[]>}
 */
export async function pickedDirectories(filePaths, options, canonicalize = canonicalPickedDirectory) {
  return options?.canonical ? Promise.all(filePaths.map((filePath) => canonicalize(filePath))) : filePaths;
}

/** Dlhšiu cestu server aj tak odmietne (`max(4096)`), na disku ju preto ani nečítame. */
const MAX_TYPED_PATH = 4096;

/**
 * LAWOSS: cesta napísaná alebo vložená do poľa onboardingu (iba Windows).
 *
 * Prieskumník pri „Kopírovať ako cestu“ vloží cestu v úvodzovkách a pri vkladaní často
 * pribudne medzera alebo nový riadok na okraji. Úvodzovky ani riadiace znaky Windows
 * v názve nedovolí a medzery na konci cesty sám zahodí, preto odstránime okraje a jeden
 * pár úvodzoviek. Osamotnú úvodzovku na okraji tiež: tú nechá ručne skrátená cesta
 * v úvodzovkách (`"C:\Klienti`). Inde sú to platné znaky názvu: cesta ostane, ako je.
 * Samotné `Z:` je aktuálny priečinok disku, relatívna cesta, ktorú by sme neprevideli;
 * v poli s priečinkom ním advokát myslí koreň disku, preto dostane lomku (`Z:\`).
 *
 * @param {string} value
 * @param {NodeJS.Platform} [platform]
 * @returns {string}
 */
export function typedDirectoryInput(value, platform = process.platform) {
  if (platform !== "win32") return value;
  const edges = /^[ \t\r\n]+|[ \t\r\n]+$/g;
  const typed = value.replace(edges, "").replace(/^"/, "").replace(/"$/, "").replace(edges, "");
  return /^[A-Za-z]:$/.test(typed) ? `${typed}\\` : typed;
}

/**
 * LAWOSS: napísaná alebo vložená cesta v tom istom kanonickom tvare ako vybraná v dialógu
 * (handler `canonicalDirectoryPath` v `main.mjs`). Na Windows prevedie malé písmeno disku,
 * inú veľkosť písmen, namapovaný disk aj disk zo `subst` na tvar, ktorý prijme OKF, server
 * aj register pracovných priestorov.
 *
 * Odkaz, junction, chýbajúci priečinok či relatívna cesta ostanú (bez úvodzoviek a okrajov)
 * a server ich odmietne ako doteraz. Iný typ než reťazec a príliš dlhú cestu vráti bez zmeny.
 *
 * @param {string} value
 * @param {{ platform?: NodeJS.Platform, fs?: PickedPathFs }} [options]
 * @returns {Promise<string>}
 */
export async function canonicalTypedDirectory(value, options = {}) {
  if (typeof value !== "string" || value.length > MAX_TYPED_PATH) return value;
  return canonicalPickedDirectory(typedDirectoryInput(value, options.platform), options);
}
