/**
 * LAWOSS: presunutá alebo premenovaná prax či klient (N-A7-1, test A10, 28. 10. 2026).
 *
 * Klient je pracovný priestor so stabilným id; cesta na disku je len jeho aktuálny koreň. Keď advokát
 * prax premenuje, appka nesmie klientov pridať druhýkrát (nové id = nové chaty a nastavenia), ale prepojiť
 * existujúce id na nové miesto existujúcim `POST /workspace/:id/reconnect`.
 *
 * - `previewMovedFolder`: k chýbajúcemu priestoru a vybranému priečinku nájde, ktorých chýbajúcich klientov
 *   tam vie spoľahlivo spoznať. Pri chýbajúcej praxi z profilu: rovnaká relatívna cesta v novom koreni,
 *   nový koreň je kancelária OKF a priečinok je klient podľa karty. Pri jednom klientovi: karta klienta
 *   a rovnaké meno priečinka alebo názov z karty. Iných klientov nového priečinka (napr. ešte nepridaných)
 *   sa netýka. Nič nezapisuje.
 * - `rebaseOfficeGrants`: po prepojení presunie povolenie pamäte kancelárie (`<prax>/Office/*`) na nový koreň;
 *   historická cesta ostať povolená nesmie.
 * - `assertClientNotMoved`: „Pridať klienta“ neprijme priečinok, ktorý je zjavne ten istý klient ako
 *   zaregistrovaný klient s chýbajúcim priečinkom; advokát ho má prepojiť, nie pridať znova.
 */
import { lstat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { ApiError } from "../errors.js";
import { readRuntimeOpencodeConfig, runtimeExternalDirectory, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { realpath } from "./canonical-path.js";
import { clientCardTitle } from "./client-card-title.js";
import { clientWorkspaces } from "./linked-folders.js";
import { inspectCardLevel } from "./onboarding-runtime.js";
import { isPathWithin } from "./path-within.js";

export type MovedFolderRef = { workspaceId: string; name: string };
export type MovedFolderMatch = MovedFolderRef & { expectedPath: string; folderPath: string };
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

const refOf = (workspace: WorkspaceInfo): MovedFolderRef => ({ workspaceId: workspace.id, name: workspace.displayName?.trim() || workspace.name });
const sameName = (a: string, b: string): boolean => a.trim().normalize("NFC").toLocaleLowerCase() === b.trim().normalize("NFC").toLocaleLowerCase();

/** Priečinok na disku nie je (ani cesta k nemu). Iná chyba (prístup) nie je dôkaz presunu. */
export async function folderGone(path: string): Promise<boolean> {
  try { await lstat(path); return false; }
  catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) return true;
    throw new ApiError(422, "project_folder_unavailable", "Unable to verify the original folder");
  }
}

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
      if (candidate && level === expected && !registeredElsewhere(config, candidate, workspace.id)) matches.push({ ...refOf(workspace), expectedPath: workspace.path, folderPath: candidate });
      else notFound.push(refOf(workspace));
    }
    return { kind: "practice", previousRoot: practice, folderPath: folder, matches, notFound };
  }

  // Jeden klient: vybraný priečinok musí byť klient podľa karty a zjavne ten istý (meno priečinka alebo názov z karty).
  const registered = refOf(target);
  const level = (await inspectCardLevel(folder)).level;
  const title = await clientCardTitle(folder);
  const same = sameName(basename(folder), basename(target.path)) || (title !== undefined && (sameName(title, registered.name) || sameName(title, basename(target.path))));
  const recognized = level === "client" && same && !registeredElsewhere(config, folder, target.id);
  return {
    kind: "client", previousRoot: target.path, folderPath: folder,
    matches: recognized ? [{ ...registered, expectedPath: target.path, folderPath: folder }] : [],
    notFound: recognized ? [] : [registered],
  };
}

/**
 * Povolenia priestorov v novom koreni, ktoré mieria do starého koreňa praxe (pamäť kancelárie), presunie na nový
 * koreň; ak tam priečinok nie je, povolenie zanikne. Ostatné povolenia ostanú. Vráti počet zmenených priestorov.
 */
export async function rebaseOfficeGrants(config: ServerConfig, previousRoot: string, folder: string): Promise<number> {
  let changed = 0;
  for (const workspace of config.workspaces) {
    if (workspace.workspaceType === "remote" || !workspace.path || !isPathWithin(folder, workspace.path)) continue;
    const rules = runtimeExternalDirectory(await readRuntimeOpencodeConfig(config, workspace.id));
    const next: Record<string, unknown> = {};
    let touched = false;
    for (const [pattern, value] of Object.entries(rules)) {
      const directory = pattern.endsWith("/*") ? pattern.slice(0, -2) : null;
      if (!directory || !isAbsolute(directory) || !isPathWithin(previousRoot, directory)) { next[pattern] = value; continue; }
      touched = true;
      const moved = await existingDirectory(join(folder, relative(previousRoot, directory)));
      if (moved) next[`${moved}/*`] = value;
    }
    if (!touched) continue;
    await writeRuntimeOpencodeConfig(config, workspace.id, (current) => ({ ...current, permission: { ...(current.permission && typeof current.permission === "object" && !Array.isArray(current.permission) ? current.permission : {}), external_directory: next } }));
    changed += 1;
  }
  return changed;
}

/**
 * Odmietne pridanie priečinka ako nového klienta, ak je zaregistrovaný klient s rovnakým menom priečinka alebo
 * rovnakým názvom z karty, ktorého priečinok chýba (presunutý, premenovaný). Nič nezapisuje.
 */
export async function assertClientNotMoved(config: ServerConfig, folder: string): Promise<void> {
  const candidate = resolve(folder);
  const title = await clientCardTitle(candidate);
  for (const workspace of await clientWorkspaces(config)) {
    // Nedostupný iný klient (napr. bez prístupu) pridanie nového klienta neblokuje; rozhoduje len chýbajúci priečinok.
    if (resolve(workspace.path) === candidate || !(await folderGone(workspace.path).catch(() => false))) continue;
    const ref = refOf(workspace);
    if (sameName(basename(candidate), basename(workspace.path)) || (title !== undefined && sameName(title, ref.name)))
      throw new ApiError(409, "onboarding_client_moved", "This client is already registered, but its folder was not found. Reconnect the moved folder instead. Nothing was changed.", ref);
  }
}
