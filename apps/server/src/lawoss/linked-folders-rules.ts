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
import { basename, dirname, join } from "node:path";
import { isPathWithin } from "./path-within.js";

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
  return trimmed.slice(0, -2).replace(/[\\/]+$/, "") || null;
}

/** Pamäť kancelárie, ktorú pripojil onboarding: `Office/` alebo `_kancelaria/` priamo v koreni praxe. */
export function isOfficeMemoryFolder(folder: string, officeRoot: string | null): boolean {
  return Boolean(officeRoot) && dirname(folder) === officeRoot && OFFICE_MEMORY.has(basename(folder).toLowerCase());
}

const overlaps = (a: string, b: string): boolean => isPathWithin(a, b) || isPathWithin(b, a);

/**
 * Prečo priečinok nepatrí k pripojeným priečinkom klienta (všetko kanonicky):
 * leží v inom klientovi alebo ho obsahuje, alebo leží v praxi či ju obsahuje (okrem pamäte kancelárie).
 * Podpriečinok vlastného klienta prekáža nikomu. Registrovaný priečinok, ktorý klienta obsahuje
 * (koreň praxe), nie je „iný klient“; prax pokrýva pravidlo koreňa praxe.
 */
export function linkedFolderConflict(folder: string, scope: { ownRoot: string | null; otherRoots: readonly string[]; officeRoot: string | null }): "other_client" | "practice" | null {
  if (isOfficeMemoryFolder(folder, scope.officeRoot)) return null;
  if (scope.ownRoot && isPathWithin(scope.ownRoot, folder)) return null;
  const others = scope.otherRoots.filter((root) => !(scope.ownRoot && isPathWithin(root, scope.ownRoot)));
  if (others.some((root) => overlaps(root, folder))) return "other_client";
  if (scope.officeRoot && overlaps(scope.officeRoot, folder)) return "practice";
  return null;
}

/** Klient chatu: najhlbší registrovaný koreň, v ktorom priečinok chatu leží. */
export function ownerOf(map: LinkedFoldersMap, directory: string): LinkedFoldersClient | null {
  return [...map.clients].sort((a, b) => b.root.length - a.root.length).find((client) => isPathWithin(client.root, directory)) ?? null;
}

/**
 * Kam smie chat bez otázky: koreň svojho klienta (aj z chatu prípadu) a jeho pripojené priečinky,
 * ktoré nekolidujú s iným klientom ani s praxou. Registrovaný koreň praxe (obsahuje koreň praxe)
 * nie je klient: jeho koreň sa nepovolí, chaty v ňom ostanú pri bežnej otázke.
 */
export function allowedFolders(map: LinkedFoldersMap, directory: string): string[] {
  if (map.firmManaged) return [];
  const owner = ownerOf(map, directory);
  if (!owner) return [];
  const otherRoots = map.clients.filter((client) => client !== owner).map((client) => client.root);
  const practiceContainer = Boolean(map.officeRoot && isPathWithin(owner.root, map.officeRoot));
  const folders = owner.folders.filter((folder) => linkedFolderConflict(folder, { ownRoot: owner.root, otherRoots, officeRoot: map.officeRoot }) === null);
  return [...(practiceContainer ? [] : [owner.root]), ...folders];
}

/** Priečinok zo vzoru otázky enginu (`<priečinok>/*`); iný tvar sa nerozhoduje. */
export function patternDirectory(pattern: string): string | null {
  if (!/[\\/]\*$/.test(pattern)) return null;
  return pattern.slice(0, -2) || "/";
}

/** Povoliť bez otázky, len ak každý cieľ leží v povolenom priečinku chatu. */
export function externalDirectoryAllowed(map: LinkedFoldersMap, directory: string, targets: readonly (string | null)[]): boolean {
  if (targets.length === 0 || targets.some((target) => target === null)) return false;
  const allowed = allowedFolders(map, directory);
  return targets.every((target) => target !== null && allowed.some((folder) => isPathWithin(folder, target)));
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
