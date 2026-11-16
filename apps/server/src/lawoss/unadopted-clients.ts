/**
 * #425: priečinky klientov, ktoré advokát vložil do kancelárie ručne (napr. `Klienti/Novák`) a ktoré nie sú
 * registrovaným klientom. Bočný panel stavia len z registrovaných priečinkov; obrazovka Dnes ich preto ponúkne na
 * zavedenie. Len čítanie: zoznam priečinkov podľa vzoru `client_path` z `Office/okf.config` (predvolený `Klienti/*`,
 * rovnako ako návrh úrovne v `lawoss/okf/src/onboarding/suggest.ts`). Obsah súborov klienta sa nečíta.
 */
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { realpath } from "./canonical-path.js";

export type UnadoptedClientFolder = { path: string; name: string };

const OFFICE_DIRS = ["Office", "_kancelaria"];
const DEFAULT_PATTERN = "Klienti/*";
/** Vzor kancelárie má pár úrovní; dlhší alebo s `..` sa nečíta. */
const MAX_SEGMENTS = 4;
/** Horná hranica výsledku; registrovaní klienti sa odfiltrujú skôr, takže neskorý vložený priečinok nevypadne. */
const MAX_FOLDERS = 500;

/**
 * Koreň praxe z `officeRoot` profilu. Sprievodca ukladá priečinok kancelárie (`<prax>/Office` alebo `_kancelaria`),
 * iné toky koreň praxe; `Klienti` leží vždy v koreni praxe vedľa kancelárie (ako `clientsFolderOf` v appke).
 */
export function practiceRootOf(officeRoot: string): string {
  const office = resolve(officeRoot);
  return OFFICE_DIRS.some(name => name.toLowerCase() === basename(office).toLowerCase()) ? dirname(office) : office;
}

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

/** #443: súbežné zisťovanie skutočných ciest (NAS, cloudový disk) a ako dlho platí zistená cesta. */
const CANONICAL_CONCURRENCY = 8;
const CANONICAL_TTL_MS = 30_000;
const MAX_CANONICAL_PATHS = 4_096;

/**
 * #443: skutočná cesta priečinka s krátkou pamäťou. Dnes sa číta pri každom zobrazení a návrate do okna; priečinky
 * klientov sa medzi dvoma zobrazeniami nemenia, takže `realpath` každého z nich na NAS netreba opakovať. Pamätá si len
 * zistenú cestu (nie zlyhanie, to sa skúsi znova), najviac `maxPaths` ciest a každú najviac `ttlMs`; výsledok je ten
 * istý ako bez pamäte. Volania bežia najviac po `concurrency` naraz, nie všetky naraz (limit RAM, AGENTS.md).
 */
export function createCanonicalPaths(options: { realpath?: (path: string) => Promise<string>; now?: () => number; ttlMs?: number; maxPaths?: number; concurrency?: number } = {}) {
  const resolveReal = options.realpath ?? realpath, now = options.now ?? Date.now;
  const ttl = options.ttlMs ?? CANONICAL_TTL_MS, maxPaths = options.maxPaths ?? MAX_CANONICAL_PATHS, concurrency = options.concurrency ?? CANONICAL_CONCURRENCY;
  const known = new Map<string, { real: string; at: number }>();
  const one = async (path: string): Promise<string> => {
    const hit = known.get(path);
    if (hit && now() - hit.at < ttl) return hit.real;
    known.delete(path);
    let real: string;
    try { real = await resolveReal(path); } catch { return resolve(path); }
    known.set(path, { real, at: now() });
    for (const oldest of known.keys()) { if (known.size <= maxPaths) break; known.delete(oldest); }
    return real;
  };
  /** Skutočné cesty v poradí vstupu. */
  const many = async (paths: readonly string[]): Promise<string[]> => {
    const out = new Array<string>(paths.length);
    let next = 0;
    const worker = async (): Promise<void> => { while (next < paths.length) { const index = next++; out[index] = await one(paths[index]!); } };
    await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
    return out;
  };
  return { one, many, get size() { return known.size; } };
}

const canonicalPaths = createCanonicalPaths();
const canonical = canonicalPaths.one;

const inside = (root: string, path: string) => { const rel = relative(root, path); return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`)); };

/**
 * Priečinky zodpovedajúce vzoru klientov kancelárie, ktoré nie sú koreňom žiadneho registrovaného priečinka ani ho
 * neobsahujú (vonkajší priečinok registrovaného klienta by zavedenie odmietlo ako vnoreného klienta). Porovnáva
 * kanonické cesty; koreň kancelárie sám nie je klient. `officeRoot` môže byť koreň praxe aj jej `Office`/`_kancelaria`.
 */
export async function unadoptedClientFolders(officeRoot: string, registeredPaths: readonly string[]): Promise<UnadoptedClientFolder[]> {
  const office = await canonical(practiceRootOf(officeRoot));
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
  // #443: s obmedzenou súbežnosťou a krátkou pamäťou ciest, nie Promise.all nad všetkými priečinkami (limit RAM).
  const registered = await canonicalPaths.many(registeredPaths);
  const folders: UnadoptedClientFolder[] = [];
  for (let start = 0; start < level.length && folders.length < MAX_FOLDERS; start += CANONICAL_CONCURRENCY * 8) {
    const batch = level.slice(start, start + CANONICAL_CONCURRENCY * 8);
    const reals = await canonicalPaths.many(batch);
    for (const [index, candidate] of batch.entries()) {
      if (folders.length >= MAX_FOLDERS) break;
      const real = reals[index]!;
      if (real === office || !inside(office, real)) continue;
      if (registered.some(path => inside(real, path))) continue;
      folders.push({ path: candidate, name: basename(candidate) });
    }
  }
  return folders;
}
