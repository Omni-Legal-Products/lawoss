/**
 * #425: priečinky klientov, ktoré advokát vložil do kancelárie ručne (napr. `Klienti/Novák`) a ktoré nie sú
 * registrovaným klientom. Bočný panel stavia len z registrovaných priečinkov; obrazovka Dnes ich preto ponúkne na
 * zavedenie. Len čítanie: zoznam priečinkov podľa vzoru `client_path` z `Office/okf.config` (predvolený `Klienti/*`,
 * rovnako ako návrh úrovne v `lawoss/okf/src/onboarding/suggest.ts`). Obsah súborov klienta sa nečíta.
 */
import { readdir, readFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { realpath } from "./canonical-path.js";

export type UnadoptedClientFolder = { path: string; name: string };

const OFFICE_DIRS = ["Office", "_kancelaria"];
const DEFAULT_PATTERN = "Klienti/*";
/** Vzor kancelárie má pár úrovní; dlhší alebo s `..` sa nečíta. */
const MAX_SEGMENTS = 4;
/** Horná hranica výsledku; registrovaní klienti sa odfiltrujú skôr, takže neskorý vložený priečinok nevypadne. */
const MAX_FOLDERS = 500;

const missing = (error: unknown) => error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");

/** `client_path` z prvého čitateľného `okf.config` kancelárie, inak `Klienti/*`. */
async function clientPattern(officeRoot: string): Promise<string> {
  for (const office of OFFICE_DIRS) {
    const config = await readFile(join(officeRoot, office, "okf.config"), "utf8").catch(() => null);
    if (config === null) continue;
    return /^client_path:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(config)?.[1] ?? DEFAULT_PATTERN;
  }
  return DEFAULT_PATTERN;
}

/** Priame podpriečinky (bez skrytých, priečinkov kancelárie a symbolických odkazov); chýbajúci priečinok je prázdny. */
async function childDirectories(parent: string): Promise<string[]> {
  try {
    const entries = await readdir(parent, { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory() && !entry.name.startsWith(".") && !OFFICE_DIRS.includes(entry.name))
      .map(entry => entry.name).sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if (missing(error)) return [];
    throw error;
  }
}

async function canonical(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

const inside = (root: string, path: string) => { const rel = relative(root, path); return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`)); };

/**
 * Priečinky zodpovedajúce vzoru klientov kancelárie, ktoré nie sú koreňom žiadneho registrovaného priečinka ani ho
 * neobsahujú (vonkajší priečinok registrovaného klienta by zavedenie odmietlo ako vnoreného klienta). Porovnáva
 * kanonické cesty; koreň kancelárie sám nie je klient.
 */
export async function unadoptedClientFolders(officeRoot: string, registeredPaths: readonly string[]): Promise<UnadoptedClientFolder[]> {
  const office = await canonical(officeRoot);
  const segments = (await clientPattern(office)).split("/").filter(Boolean);
  if (!segments.length || segments.length > MAX_SEGMENTS || segments.some(segment => segment === "." || segment === "..")) return [];
  let level = [office];
  for (const segment of segments) {
    const next: string[] = [];
    for (const parent of level) {
      const names = segment === "*" ? await childDirectories(parent) : (await childDirectories(parent)).filter(name => name === segment);
      for (const name of names) next.push(join(parent, name));
    }
    level = next;
  }
  // Po jednom, nie Promise.all nad všetkými priečinkami (limit RAM, AGENTS.md).
  const registered: string[] = [];
  for (const path of registeredPaths) registered.push(await canonical(path));
  const folders: UnadoptedClientFolder[] = [];
  for (const candidate of level) {
    if (folders.length >= MAX_FOLDERS) break;
    const real = await canonical(candidate);
    if (real === office || !inside(office, real)) continue;
    if (registered.some(path => inside(real, path))) continue;
    folders.push({ path: candidate, name: basename(candidate) });
  }
  return folders;
}
