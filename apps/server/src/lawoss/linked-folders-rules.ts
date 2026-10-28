/**
 * LAWOSS: pripojené priečinky klienta (MČ 19. 10. 2026). Pravidlá zdieľa server (zápis natívneho zoznamu,
 * súbor pre engine) aj plugin enginu `lawoss-linked-folders`, ktorý pri otázke `external_directory`
 * rozhodne podľa chatu: chat patrí najhlbšiemu registrovanému priečinku klienta, ktorý obsahuje jeho
 * priečinok, a bez otázky smie len do koreňa tohto klienta a do jeho pripojených priečinkov.
 *
 * Cesty sa porovnávajú kanonicky: `realpath` (symbolický odkaz do iného klienta sa vyrieši) a NFC
 * (diakritika z macOS). Modul nemá stav; plugin ho dostane zabalený do svojho súboru.
 */
import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import { foldedPath, isPathWithin } from "./path-within.js";

export const LINKED_FOLDERS_MAP_FILE = "lawoss-linked-folders.json";

export type LinkedFoldersClient = { root: string; folders: string[] };
export type LinkedFoldersMap = {
  version: 1;
  /** Koreň praxe z profilu (kanonický), ak je. */
  officeRoot: string | null;
  clients: LinkedFoldersClient[];
  /** Priečinky mimo projektu určuje firma: plugin nerozhoduje nič. */
  firmManaged: boolean;
};

const OFFICE_MEMORY = new Set(["office", "_kancelaria"]);

/** Kanonická cesta: `realpath` najbližšieho existujúceho predka + zvyšok, potom NFC. */
export async function canonicalPath(path: string): Promise<string> {
  const resolved = await realpath(path).catch(() => null);
  if (resolved) return resolved.normalize("NFC");
  const parent = dirname(path);
  if (parent === path) return path.normalize("NFC");
  return join(await canonicalPath(parent), basename(path)).normalize("NFC");
}

/** Priečinok z kľúča natívneho zoznamu (`<priečinok>/*` s `allow`); iné položky nie sú pripojené priečinky. */
export function folderOfGrant(key: string, value: unknown): string | null {
  if (value !== "allow") return null;
  const trimmed = key.trim();
  if (trimmed === "/*") return "/";
  if (trimmed === "*" || !/[\\/]\*$/.test(trimmed)) return null;
  const folder = trimmed.slice(0, -2).replace(/[\\/]+$/, "");
  return /^[A-Za-z]:$/.test(folder) ? `${folder}/` : folder || null;
}

/** Pamäť kancelárie, ktorú pripojil onboarding: `Office/` alebo `_kancelaria/` priamo v koreni praxe. */
export function isOfficeMemoryFolder(folder: string, officeRoot: string | null): boolean {
  return Boolean(officeRoot) && dirname(folder) === officeRoot && OFFICE_MEMORY.has(basename(folder).toLowerCase());
}

const overlaps = (a: string, b: string): boolean => isPathWithin(a, b) || isPathWithin(b, a);

export type LinkedFolderConflict = "relative" | "app_data" | "other_client" | "practice";

/**
 * Prečo priečinok nepatrí k pripojeným priečinkom klienta (všetko kanonicky):
 * - relatívna cesta (nevie sa, voči čomu);
 * - obsahuje dáta aplikácie alebo v nich leží (súbor enginu, mapa, kód pluginov): agent by si nimi vedel rozšíriť prístup;
 * - leží v inom registrovanom klientovi alebo ho obsahuje (overí sa aj pre podpriečinok vlastného koreňa,
 *   takže registrovaný kontajner praxe nepripojí koreň klienta, ktorý obsahuje);
 * - leží v praxi alebo ju obsahuje (okrem pamäte kancelárie).
 * Registrovaný priečinok, ktorý klienta obsahuje (koreň praxe), nie je „iný klient“; prax pokrýva pravidlo praxe.
 */
export function linkedFolderConflict(folder: string, scope: {
  ownRoot: string | null; otherRoots: readonly string[]; officeRoot: string | null; protectedDirs?: readonly string[];
  /** Obsah wiki, ktorý upstream predvolene ukladá v priečinku aplikácie: nie je to kód ani konfigurácia. */
  contentRoots?: readonly string[];
}): LinkedFolderConflict | null {
  if (!isAbsolute(folder)) return "relative";
  const content = (scope.contentRoots ?? []).some((root) => isPathWithin(root, folder));
  if ((scope.protectedDirs ?? []).some((dir) => isPathWithin(folder, dir) || (isPathWithin(dir, folder) && !content))) return "app_data";
  if (isOfficeMemoryFolder(folder, scope.officeRoot)) return null;
  const others = scope.otherRoots.filter((root) => !(scope.ownRoot && isPathWithin(root, scope.ownRoot)));
  if (others.some((root) => overlaps(root, folder))) return "other_client";
  if (scope.ownRoot && isPathWithin(scope.ownRoot, folder)) return null;
  if (scope.officeRoot && overlaps(scope.officeRoot, folder)) return "practice";
  return null;
}

/** Klient chatu: najhlbší registrovaný koreň, v ktorom priečinok chatu leží. */
export function ownerOf(map: LinkedFoldersMap, directory: string): LinkedFoldersClient | null {
  return [...map.clients].sort((a, b) => b.root.length - a.root.length).find((client) => isPathWithin(client.root, directory)) ?? null;
}

/**
 * Kam smie chat bez otázky: koreň svojho klienta (aj z chatu prípadu) a jeho pripojené priečinky,
 * ktoré nekolidujú s iným klientom, praxou ani dátami aplikácie. Registrovaný koreň praxe (obsahuje
 * koreň praxe) nie je klient: jeho koreň sa nepovolí. Koreň, ktorý obsahuje dáta aplikácie, tiež nie.
 */
export function allowedFolders(map: LinkedFoldersMap, directory: string, protectedDirs: readonly string[] = []): string[] {
  if (map.firmManaged) return [];
  const owner = ownerOf(map, directory);
  if (!owner) return [];
  const otherRoots = map.clients.filter((client) => client !== owner).map((client) => client.root);
  const practiceContainer = Boolean(map.officeRoot && isPathWithin(owner.root, map.officeRoot));
  const rootUsable = !practiceContainer && !protectedDirs.some((dir) => overlaps(dir, owner.root));
  const folders = owner.folders.filter((folder) => linkedFolderConflict(folder, { ownRoot: owner.root, otherRoots, officeRoot: map.officeRoot, protectedDirs }) === null);
  return [...(rootUsable ? [owner.root] : []), ...folders];
}

/** Priečinok zo vzoru otázky enginu (`<priečinok>/*`); iný tvar sa nerozhoduje. */
export function patternDirectory(pattern: string): string | null {
  if (!/[\\/]\*$/.test(pattern)) return null;
  return pattern.slice(0, -2) || "/";
}

/**
 * Povoliť bez otázky, len ak každý cieľ leží v povolenom priečinku chatu a nepatrí inému klientovi:
 * najhlbší registrovaný priečinok cieľa je klient chatu, jeho kontajner (koreň praxe) alebo žiadny.
 * Klient zaregistrovaný vnútri iného tak ostane oddelený aj od chatov vonkajšieho.
 */
export function externalDirectoryAllowed(map: LinkedFoldersMap, directory: string, targets: readonly (string | null)[], protectedDirs: readonly string[] = []): boolean {
  if (targets.length === 0 || targets.some((target) => target === null)) return false;
  const owner = ownerOf(map, directory);
  if (!owner) return false;
  const allowed = allowedFolders(map, directory, protectedDirs);
  return targets.every((target) => {
    if (target === null || !allowed.some((folder) => isPathWithin(folder, target))) return false;
    // Nič v dátach aplikácie (súbor enginu, mapa, kód pluginov) sa nepovolí bez otázky.
    if (protectedDirs.some((dir) => isPathWithin(dir, target))) return false;
    const targetOwner = ownerOf(map, target);
    return !targetOwner || targetOwner === owner || isPathWithin(targetOwner.root, owner.root);
  });
}

const GLOB_CHARS = /[*?]/;
const segmentsOf = (path: string): string[] => path.split(/[\\/]+/).filter(Boolean);

/** Jeden segment vzoru (`C002*`, `C00?`) ako regulárny výraz; `[`, `{` a ostatné znaky sú doslovné (aj v menách priečinkov). */
const segmentPattern = (segment: string): RegExp =>
  new RegExp(`^${segment.replace(/[.+^$|()[\]{}\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "su");

/**
 * Môže sa priečinok zo vzoru (s `*` alebo `?`) rozvinúť na `root` alebo priečinok v ňom? Porovnáva
 * po segmentoch; `**` pokryje všetko pod sebou. Priečinok, ktorý `root` len obsahuje (je jeho predkom), nie.
 */
function patternReaches(pattern: string, root: string): boolean {
  const wanted = segmentsOf(foldedPath(pattern));
  const segments = segmentsOf(foldedPath(root));
  for (let index = 0; index < segments.length; index++) {
    const segment = wanted[index];
    if (segment === undefined) return false;
    if (segment === "**") return true;
    if (GLOB_CHARS.test(segment) ? !segmentPattern(segment).test(segments[index]!) : segment !== segments[index]) return false;
  }
  return true;
}

/**
 * N-A7-14 (test E2): požiadavka chatu klienta smeruje do priečinka iného registrovaného klienta tej istej mapy.
 * Cieľ v ňom leží (najhlbší registrovaný priečinok cieľa je iný klient, aj klient zaregistrovaný vnútri klienta
 * chatu), alebo vzor s `*` sa naň rozvinie (`…/Klienti/C002*`). Klient chatu ani jeho kontajner (koreň praxe)
 * nie sú iný klient; pripojený priečinok mimo praxe nepatrí nikomu (E1), takže sa tu nikdy neodmietne. Chat
 * kontajnera praxe ani bez klienta sa nerozhoduje (ostane karta), firemné pravidlá tiež nie.
 */
export function externalDirectoryOtherClient(map: LinkedFoldersMap, directory: string, targets: readonly (string | null)[]): boolean {
  if (map.firmManaged) return false;
  const owner = ownerOf(map, directory);
  if (!owner || (map.officeRoot && isPathWithin(owner.root, map.officeRoot))) return false;
  const others = map.clients.filter((client) => client !== owner && !isPathWithin(client.root, owner.root));
  return targets.some((target) => {
    if (target === null) return false;
    if (GLOB_CHARS.test(target)) return others.some((client) => patternReaches(target, client.root));
    const targetOwner = ownerOf(map, target);
    return targetOwner !== null && others.includes(targetOwner);
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === "string");

/** Súbor od servera; čokoľvek iné = žiadne rozhodnutie (engine sa spýta ako vždy). */
export function parseLinkedFoldersMap(value: unknown): LinkedFoldersMap | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.clients)) return null;
  const officeRoot = typeof value.officeRoot === "string" ? value.officeRoot : null;
  const clients: LinkedFoldersClient[] = [];
  for (const client of value.clients) {
    if (!isRecord(client) || typeof client.root !== "string" || !isStringArray(client.folders)) return null;
    clients.push({ root: client.root, folders: client.folders });
  }
  return { version: 1, officeRoot, clients, firmManaged: value.firmManaged === true };
}
