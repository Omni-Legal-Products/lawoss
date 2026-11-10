/**
 * LAWOSS: izolovaný domov spravovaného enginu (rozhodnutie MČ 10. 11. 2026).
 *
 * Konfigurácia (`engine-home/config`), stav (`engine-home/state`) a databáza enginu
 * (`opencode-engine-v2.db`) už ležia v úložisku enginu aplikácie (`engineStorageDir`).
 * Dáta (`XDG_DATA_HOME`: `auth.json`, `mcp-auth.json`, logy, `tool-output`, snapshoty)
 * a cache (`XDG_CACHE_HOME`) však engine dedil z prostredia servera, v produkcii teda
 * globálne `~/.local/share/opencode` a `~/.cache/opencode` vlastného OpenCode CLI
 * používateľa. Odteraz ich engine dostane pod `engine-home/{data,cache}` vo vývoji aj
 * v produkcii (jeden pomocník pre `embedded.ts` aj `cli.ts`).
 *
 * Kým engine prvý raz naštartuje v izolovanom domove, raz sa skopírujú prihlásenia
 * z doterajšieho dátového priečinka enginu: `auth.json` (natívna migrácia v1 a
 * `legacy-provider-credentials.ts` ho čítajú z `XDG_DATA_HOME` enginu) a `mcp-auth.json`.
 * Kopírujú sa len bajty, obsah sa nečíta ani nezapisuje do logu. Originály ostávajú
 * nezmenené; existujúci cieľ sa neprepíše. Kópia ide cez dočasný súbor a premenovanie,
 * značka importu sa zapíše až nakoniec, takže prerušený import sa pri ďalšom štarte
 * dokončí a dokončený sa už neopakuje.
 *
 * Databázy (`opencode*.db*`) sa nekopírujú: história má vlastnú bránu so zálohou
 * (`managed-opencode-db.ts`), globálna DB patrí CLI používateľa.
 */
import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { chmod, copyFile, lstat, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** Súbory prihlásení, ktoré sa raz prenesú z doterajšieho dátového priečinka enginu. */
export const ENGINE_DATA_IMPORT_FILES = ["auth.json", "mcp-auth.json"] as const;
/** Značka dokončeného importu v `engine-home` (len mená a výsledky, nikdy obsah). */
export const ENGINE_DATA_IMPORT_MARKER = "lawoss-data-import.json";
const TEMPORARY_INFIX = ".lawoss-import-";

type ImportFile = (typeof ENGINE_DATA_IMPORT_FILES)[number];
type ImportOutcome = "copied" | "kept" | "missing";
export type EngineDataImport =
  | { status: "done"; source: string; files: Record<ImportFile, ImportOutcome> }
  | { status: "already-imported" }
  | { status: "same-directory" };

const paths = (platform: NodeJS.Platform) => (platform === "win32" ? path.win32 : path.posix);
const missing = (error: unknown) => error instanceof Error && "code" in error && error.code === "ENOENT";

/** Prostredie, ktoré engine dostane navyše: dáta a cache pod `engine-home`. */
export function isolatedEngineXdgEnv(engineHome: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): { XDG_DATA_HOME: string; XDG_CACHE_HOME: string } {
  const p = paths(platform);
  return {
    // Výslovné presmerovanie samostatného servera (`cli.ts`) ostáva v platnosti.
    XDG_DATA_HOME: env.LEGALWORK_ENGINE_DATA_HOME?.trim() || p.join(engineHome, "data"),
    XDG_CACHE_HOME: p.join(engineHome, "cache"),
  };
}

/**
 * Dátový priečinok, ktorý engine používal doteraz: dedené `XDG_DATA_HOME` servera,
 * inak `<domov>/.local/share` (rovnaký vzorec ako `legacy-provider-credentials.ts`).
 */
export function previousEngineDataDirectory(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = homedir()): string {
  const p = paths(platform);
  const profileHome = (platform === "win32" ? env.USERPROFILE : env.HOME)?.trim() || home;
  return p.join(env.XDG_DATA_HOME?.trim() || p.join(profileHome, ".local", "share"), "opencode");
}

function samePath(left: string, right: string, platform: NodeJS.Platform): boolean {
  const p = paths(platform);
  const a = p.resolve(left), b = p.resolve(right);
  return platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; }
  catch (error) { if (missing(error)) return false; throw error; }
}

async function writeAtomically(file: string, content: string): Promise<void> {
  const temporary = `${file}${TEMPORARY_INFIX}${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

async function copyOne(source: string, destination: string): Promise<ImportOutcome> {
  if (await exists(destination)) return "kept";
  let info;
  try { info = await stat(source); }
  catch (error) { if (missing(error)) return "missing"; throw error; }
  if (!info.isFile()) return "missing";
  const temporary = `${destination}${TEMPORARY_INFIX}${randomUUID()}.tmp`;
  try {
    await copyFile(source, temporary, fsConstants.COPYFILE_EXCL);
    await chmod(temporary, 0o600);
    // Súbor mohol medzičasom vzniknúť (engine sa ešte nespustil, ale opatrne): neprepisovať.
    if (await exists(destination)) return "kept";
    await rename(temporary, destination);
    return "copied";
  } finally { await rm(temporary, { force: true }); }
}

/**
 * Jednorazový import prihlásení do izolovaného dátového priečinka enginu.
 * Volá sa pred prvým štartom enginu; chyba kopírovania zastaví štart (značka sa
 * nezapíše, ďalší štart to skúsi znova), aby engine nenaštartoval bez prihlásení.
 */
export async function importPreviousEngineData(options: {
  engineHome: string;
  dataHome: string;
  sourceDirectory: string;
  platform?: NodeJS.Platform;
  now?: () => Date;
}): Promise<EngineDataImport> {
  const platform = options.platform ?? process.platform;
  const marker = path.join(options.engineHome, ENGINE_DATA_IMPORT_MARKER);
  if (await exists(marker)) return { status: "already-imported" };
  const destinationDirectory = path.join(options.dataHome, "opencode");
  await mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
  if (samePath(options.sourceDirectory, destinationDirectory, platform)) {
    await writeAtomically(marker, JSON.stringify({ version: 1, importedAt: (options.now?.() ?? new Date()).toISOString(), sameDirectory: true }, null, 2) + "\n");
    return { status: "same-directory" };
  }
  // Pozostatky prerušeného importu (dočasné súbory) sa odstránia; skopírované súbory ostávajú.
  for (const entry of await readdir(destinationDirectory)) {
    if (ENGINE_DATA_IMPORT_FILES.some(name => entry.startsWith(`${name}${TEMPORARY_INFIX}`) && entry.endsWith(".tmp"))) {
      await rm(path.join(destinationDirectory, entry), { force: true });
    }
  }
  const files: Record<ImportFile, ImportOutcome> = { "auth.json": "missing", "mcp-auth.json": "missing" };
  for (const name of ENGINE_DATA_IMPORT_FILES) {
    try {
      files[name] = await copyOne(path.join(options.sourceDirectory, name), path.join(destinationDirectory, name));
    } catch (error) {
      const code = error instanceof Error && "code" in error ? ` (${String(error.code)})` : "";
      throw new Error(`Uložené prihlásenia enginu (${name}) sa nepodarilo preniesť do jeho priečinka${code}. Originál ostal nezmenený, import sa zopakuje pri ďalšom štarte.`, { cause: error });
    }
  }
  await writeAtomically(marker, JSON.stringify({
    version: 1,
    importedAt: (options.now?.() ?? new Date()).toISOString(),
    source: options.sourceDirectory,
    files,
  }, null, 2) + "\n");
  return { status: "done", source: options.sourceDirectory, files };
}

/**
 * Háčik pre `embedded.ts` a `cli.ts`: pripraví izolované dáta enginu (vrátane
 * jednorazového importu) a vráti prostredie, ktoré engine dostane.
 */
export async function prepareIsolatedEngineHome(engineHome: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Promise<{ XDG_DATA_HOME: string; XDG_CACHE_HOME: string }> {
  const engineEnv = isolatedEngineXdgEnv(engineHome, env, platform);
  // Výslovne zvolený dátový priečinok samostatného servera sa nenapĺňa z globálneho profilu.
  if (env.LEGALWORK_ENGINE_DATA_HOME?.trim()) {
    await mkdir(engineEnv.XDG_CACHE_HOME, { recursive: true, mode: 0o700 });
    return engineEnv;
  }
  await importPreviousEngineData({ engineHome, dataHome: engineEnv.XDG_DATA_HOME, sourceDirectory: previousEngineDataDirectory(env, platform), platform });
  await mkdir(engineEnv.XDG_CACHE_HOME, { recursive: true, mode: 0o700 });
  return engineEnv;
}
