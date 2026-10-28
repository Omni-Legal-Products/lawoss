/**
 * LAWOSS: presunutá alebo premenovaná prax či klient (N-A7-1, test A10, 28. 10. 2026).
 *
 * Klient je pracovný priestor so stabilným id; cesta na disku je len jeho aktuálny koreň. Keď advokát
 * prax premenuje, appka nesmie klientov pridať druhýkrát (nové id = nové chaty a nastavenia), ale prepojiť
 * existujúce id na nové miesto existujúcim `POST /workspace/:id/reconnect`.
 *
 * Identita: OKF nemá trvalý identifikátor klienta. Najspoľahlivejší znak je značka, ktorú appka zapíše do
 * priečinka klienta pri prvom otvorení (`.opencode/legalwork.json`, `authorizedRoots` s pôvodnou cestou).
 * Ak sedí s pôvodnou cestou priestoru (alebo jeho staršou cestou), ide o `marker`; inak sa zhoduje len
 * meno (`name`, relatívna cesta v praxi alebo meno priečinka/názov z karty). Rozhoduje vždy advokát:
 * náhľad nič nezapisuje a pri zhode len podľa mena to výslovne povie, stráž pri „Pridať klienta“ sa len opýta.
 *
 * - `previewMovedFolder`: k chýbajúcemu priestoru a vybranému priečinku nájde, ktorých chýbajúcich klientov
 *   tam vie spoznať. Iných klientov nového priečinka (napr. ešte nepridaných) sa netýka. Nič nezapisuje.
 * - `syncOfficeGrant`: po každom prepojení klienta zruší povolenie pamäte kancelárie, ktorej priečinok už nie je,
 *   a ak klient také mal, povolí aktuálnu pamäť kancelárie jeho praxe (aj pred dokončením presunu praxe).
 * - `rebaseOfficeGrants`: pri presune praxe presunie povolenia do starého koreňa u klientov v novom koreni,
 *   ostatným priestorom ich odoberie (historická cesta nie je povolenie).
 * - `inferPracticeMove`: prax z profilu chýba, ale jej klienti sú už prepojení v novom koreni: appka ponúkne
 *   „Dokončiť presun praxe“ (prerušené alebo zlyhané dokončenie sa dá zopakovať).
 * - `movedClientOf`: „Pridať klienta“ pri priečinku, ktorý môže byť zaregistrovaný klient s chýbajúcim priečinkom.
 */
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { ApiError } from "../errors.js";
import { readRuntimeOpencodeConfig, runtimeExternalDirectory, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { realpath } from "./canonical-path.js";
import { clientCardTitle } from "./client-card-title.js";
import { clientWorkspaces } from "./linked-folders.js";
import { assertClientFolderNotNested } from "./nested-client.js";
import { inspectCardLevel } from "./onboarding-runtime.js";
import { isPathWithin } from "./path-within.js";

/** `marker`: priečinok nesie značku appky s pôvodnou cestou priestoru; `name`: zhoduje sa len meno. */
export type MovedFolderEvidence = "marker" | "name";
export type MovedFolderRef = { workspaceId: string; name: string };
export type MovedFolderMatch = MovedFolderRef & { expectedPath: string; folderPath: string; evidence: MovedFolderEvidence };
export type MovedFolderPreview = {
  /** `practice`: chýba celá prax z profilu; `client`: chýba len priečinok jedného klienta. */
  kind: "practice" | "client";
  /** Pôvodný koreň: prax z profilu alebo cesta klienta. */
  previousRoot: string;
  folderPath: string;
  /** Klienti, ktorých appka v novom priečinku spoznala; prepojí ich len po potvrdení advokáta. */
  matches: MovedFolderMatch[];
  /** Chýbajúci klienti, ktorých v novom priečinku nespoznala; ostanú nedostupní, nič sa im nezmení. */
  notFound: MovedFolderRef[];
};
export type MovedClient = MovedFolderRef & { expectedPath: string; evidence: MovedFolderEvidence };

const OFFICE_DIRS = ["Office", "_kancelaria"];
const MAX_MARKER_BYTES = 64 * 1024;
const refOf = (workspace: WorkspaceInfo): MovedFolderRef => ({ workspaceId: workspace.id, name: workspace.displayName?.trim() || workspace.name });
const sameName = (a: string, b: string): boolean => a.trim().normalize("NFC").toLocaleLowerCase() === b.trim().normalize("NFC").toLocaleLowerCase();
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Priečinok na disku nie je (ani cesta k nemu). Iná chyba (prístup) nie je dôkaz presunu. */
export async function folderGone(path: string): Promise<boolean> {
  try { await lstat(path); return false; }
  catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return true;
    throw new ApiError(422, "project_folder_unavailable", "Unable to verify the original folder");
  }
}
const goneQuietly = (path: string): Promise<boolean> => folderGone(path).catch(() => false);

/** Existujúci kanonický priečinok (ako `canonicalDirectory` onboardingu), inak `null`. */
async function existingDirectory(path: string): Promise<string | null> {
  try {
    const resolved = resolve(path);
    if (!isAbsolute(path) || !(await lstat(resolved)).isDirectory() || await realpath(resolved) !== resolved) return null;
    return resolved;
  } catch { return null; }
}

/** Je to priečinok, ktorý ešte nepatrí inému zaregistrovanému priestoru? */
const registeredElsewhere = (config: ServerConfig, folder: string, owner: string): boolean =>
  config.workspaces.some((workspace) => workspace.id !== owner && workspace.workspaceType !== "remote" && workspace.path && resolve(workspace.path) === folder);

/** Cesty zo značky appky v priečinku (`.opencode/legalwork.json`, `authorizedRoots`); bez odkazov, malý súbor. */
async function markerRoots(folder: string): Promise<string[]> {
  try {
    const path = join(folder, ".opencode", "legalwork.json");
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_MARKER_BYTES) return [];
      const raw: unknown = JSON.parse(await handle.readFile("utf8"));
      const roots = isRecord(raw) && Array.isArray(raw.authorizedRoots) ? raw.authorizedRoots : [];
      return roots.filter((root): root is string => typeof root === "string" && isAbsolute(root)).map((root) => resolve(root));
    } finally { await handle.close(); }
  } catch { return []; }
}

/** Značka v priečinku nesie aktuálnu alebo staršiu cestu priestoru: ten istý klient, len presunutý. */
async function evidenceOf(workspace: WorkspaceInfo, folder: string): Promise<MovedFolderEvidence> {
  const known = new Set([workspace.path, ...(workspace.previousPaths ?? [])].map((path) => resolve(path)));
  return (await markerRoots(folder)).some((root) => known.has(root)) ? "marker" : "name";
}

/** Klient sa nesmie prepojiť do priečinka iného klienta ani na priečinok s inými klientmi (N-A3-1). */
const notNested = (config: ServerConfig, folder: string): Promise<boolean> => assertClientFolderNotNested(config, folder).then(() => true, () => false);

export async function previewMovedFolder(config: ServerConfig, practiceRoot: string | undefined, input: { workspaceId: string; folderPath: string }): Promise<MovedFolderPreview> {
  const target = config.workspaces.find((workspace) => workspace.id === input.workspaceId);
  if (!target || target.workspaceType === "remote" || !target.path) throw new ApiError(404, "workspace_not_found", "Workspace not found");
  if (!(await folderGone(target.path))) throw new ApiError(409, "project_folder_available", "The original project folder is still present");
  const folder = await existingDirectory(input.folderPath);
  if (!folder) throw new ApiError(400, "invalid_path", "Choose an existing canonical directory.");

  const practice = practiceRoot && isPathWithin(practiceRoot, target.path) && await folderGone(practiceRoot) ? resolve(practiceRoot) : null;
  if (practice) {
    // Nový koreň musí byť kancelária OKF, nie hocijaký priečinok s podobnými menami.
    if ((await inspectCardLevel(folder)).level !== "office") throw new ApiError(409, "moved_folder_not_practice", "The chosen folder is not the moved practice. Nothing was changed.");
    const matches: MovedFolderMatch[] = [];
    const notFound: MovedFolderRef[] = [];
    for (const workspace of await clientWorkspaces(config)) {
      if (!isPathWithin(practice, workspace.path) || !(await folderGone(workspace.path))) continue;
      const candidate = await existingDirectory(join(folder, relative(practice, workspace.path)));
      const level = candidate ? (await inspectCardLevel(candidate)).level : null;
      // Koreň praxe zaregistrovaný ako jeden priečinok je kancelária, ostatní klienti majú kartu klienta.
      const expected = resolve(workspace.path) === practice ? "office" : "client";
      if (candidate && level === expected && !registeredElsewhere(config, candidate, workspace.id) && (expected === "office" || await notNested(config, candidate)))
        matches.push({ ...refOf(workspace), expectedPath: workspace.path, folderPath: candidate, evidence: await evidenceOf(workspace, candidate) });
      else notFound.push(refOf(workspace));
    }
    return { kind: "practice", previousRoot: practice, folderPath: folder, matches, notFound };
  }

  // Jeden klient: vybraný priečinok musí byť klient podľa karty a buď nesie značku tohto priestoru, alebo sa
  // zhoduje meno priečinka či názov z karty. Priečinok v inom klientovi sa odmietne vetou N-A3-1.
  const registered = refOf(target);
  const level = (await inspectCardLevel(folder)).level;
  await assertClientFolderNotNested(config, folder);
  const evidence = await evidenceOf(target, folder);
  const title = await clientCardTitle(folder);
  const sameClientName = sameName(basename(folder), basename(target.path)) || (title !== undefined && (sameName(title, registered.name) || sameName(title, basename(target.path))));
  const recognized = level === "client" && (evidence === "marker" || sameClientName) && !registeredElsewhere(config, folder, target.id);
  return {
    kind: "client", previousRoot: target.path, folderPath: folder,
    matches: recognized ? [{ ...registered, expectedPath: target.path, folderPath: folder, evidence }] : [],
    notFound: recognized ? [] : [registered],
  };
}

/** Priečinok pravidla `<priečinok>/*`, ak je to absolútna cesta; iné pravidlá sa nemenia. */
const ruleDirectory = (pattern: string): string | null => {
  const directory = pattern.endsWith("/*") ? pattern.slice(0, -2) : null;
  return directory && isAbsolute(directory) ? directory : null;
};
const permissionOf = (current: Record<string, unknown>): Record<string, unknown> => isRecord(current.permission) ? current.permission : {};
async function writeExternalDirectory(config: ServerConfig, workspaceId: string, next: Record<string, unknown>): Promise<void> {
  await writeRuntimeOpencodeConfig(config, workspaceId, (current) => ({ ...current, permission: { ...permissionOf(current), external_directory: next } }));
}

/** Platný priečinok pamäte kancelárie praxe (`Office` alebo `_kancelaria`), inak `null`. */
async function officeMemoryDir(officeRoot: string | undefined): Promise<string | null> {
  if (!officeRoot) return null;
  for (const name of OFFICE_DIRS) {
    const directory = await existingDirectory(join(officeRoot, name));
    if (directory && (await inspectCardLevel(directory)).level === "office") return directory;
  }
  return null;
}

/**
 * Po prepojení jedného klienta: povolenie pamäte kancelárie, ktorej priečinok už nie je, zanikne. Ak ho klient mal
 * a leží v praxi z profilu (pri nedokončenom presune praxe v jej novom koreni) s platnou kanceláriou, dostane
 * povolenie na jej aktuálnu pamäť. Povolenie sa tak presunie pri každom prepojení. Opakovanie nič nemení.
 */
export async function syncOfficeGrant(config: ServerConfig, workspaceId: string, officeRoot: string | undefined): Promise<boolean> {
  const workspace = config.workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace || workspace.workspaceType === "remote" || !workspace.path) throw new ApiError(404, "workspace_not_found", "Workspace not found");
  const rules = runtimeExternalDirectory(await readRuntimeOpencodeConfig(config, workspace.id));
  const next: Record<string, unknown> = {};
  let stale: unknown;
  for (const [pattern, value] of Object.entries(rules)) {
    const directory = ruleDirectory(pattern);
    if (directory && OFFICE_DIRS.includes(basename(directory)) && !isPathWithin(workspace.path, directory) && await goneQuietly(directory)) { stale = value; continue; }
    next[pattern] = value;
  }
  if (stale === undefined) return false;
  // Prax z profilu, alebo kým presun praxe nie je dokončený, jej nový koreň odvodený z prepojených klientov.
  const root = officeRoot && !(await goneQuietly(officeRoot)) ? officeRoot : (await inferPracticeMove(config, officeRoot))?.folderPath;
  const office = root && isPathWithin(root, workspace.path) ? await officeMemoryDir(root) : null;
  if (office) next[`${office}/*`] = stale;
  await writeExternalDirectory(config, workspace.id, next);
  return true;
}

/**
 * Presun praxe: povolenia do starého koreňa presunie na nový koreň u priestorov v novom koreni (ak tam priečinok je);
 * všetkým ostatným priestorom ich odoberie. Ostatné povolenia ostanú. Vráti počet zmenených priestorov.
 */
export async function rebaseOfficeGrants(config: ServerConfig, previousRoot: string, folder: string): Promise<number> {
  let changed = 0;
  for (const workspace of config.workspaces) {
    if (workspace.workspaceType === "remote" || !workspace.path) continue;
    const moved = isPathWithin(folder, workspace.path);
    const rules = runtimeExternalDirectory(await readRuntimeOpencodeConfig(config, workspace.id));
    const next: Record<string, unknown> = {};
    let touched = false;
    for (const [pattern, value] of Object.entries(rules)) {
      const directory = ruleDirectory(pattern);
      if (!directory || !isPathWithin(previousRoot, directory)) { next[pattern] = value; continue; }
      touched = true;
      const target = moved ? await existingDirectory(join(folder, relative(previousRoot, directory))) : null;
      if (target) next[`${target}/*`] = value;
    }
    if (!touched) continue;
    await writeExternalDirectory(config, workspace.id, next);
    changed += 1;
  }
  return changed;
}

/**
 * Prax z profilu chýba, ale aspoň jeden jej klient je už prepojený do iného koreňa (jeho staršia cesta leží v praxi
 * a nová cesta je rovnaká relatívna cesta v novom koreni). Jediný taký koreň s kanceláriou OKF = cieľ presunu.
 */
export async function inferPracticeMove(config: ServerConfig, officeRoot: string | undefined): Promise<{ previousRoot: string; folderPath: string } | null> {
  if (!officeRoot || !(await goneQuietly(officeRoot))) return null;
  const practice = resolve(officeRoot);
  const roots = new Set<string>();
  for (const workspace of await clientWorkspaces(config)) {
    for (const previous of workspace.previousPaths ?? []) {
      if (!isPathWithin(practice, previous)) continue;
      const root = resolve(workspace.path, relative(previous, practice));
      if (resolve(root, relative(practice, previous)) === resolve(workspace.path) && root !== practice) roots.add(root);
    }
  }
  if (roots.size !== 1) return null;
  const [root] = [...roots];
  const folder = root ? await existingDirectory(root) : null;
  return folder && (await inspectCardLevel(folder)).level === "office" ? { previousRoot: officeRoot, folderPath: folder } : null;
}

/**
 * Zaregistrovaný klient s chýbajúcim priečinkom, ktorý môže byť tým istým klientom ako `folder` (značka, rovnaké meno
 * priečinka alebo názov z karty). Ak je `folder` už zaregistrovaný priestor, nič (nový klient nevzniká). Nič nezapisuje.
 */
export async function movedClientOf(config: ServerConfig, folder: string): Promise<MovedClient | null> {
  const candidate = resolve(folder);
  if (config.workspaces.some((workspace) => workspace.workspaceType !== "remote" && workspace.path && resolve(workspace.path) === candidate)) return null;
  const title = await clientCardTitle(candidate);
  for (const workspace of await clientWorkspaces(config)) {
    // Nedostupný iný klient (napr. bez prístupu) pridanie nového klienta neblokuje; rozhoduje len chýbajúci priečinok.
    if (!(await goneQuietly(workspace.path))) continue;
    const ref = refOf(workspace);
    const evidence = await evidenceOf(workspace, candidate);
    if (evidence === "marker" || sameName(basename(candidate), basename(workspace.path)) || (title !== undefined && sameName(title, ref.name)))
      return { ...ref, expectedPath: workspace.path, evidence };
  }
  return null;
}
