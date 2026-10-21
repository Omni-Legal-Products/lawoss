/**
 * LAWOSS: pripojené priečinky klienta na serveri (MČ 19. 10. 2026).
 *
 * - Spoločný súbor enginu (`OPENCODE_CONFIG`) je jeden pre všetkých klientov, preto do neho žiadne
 *   povolenie `external_directory` pracovného priestoru nejde (`withoutClientFolderGrants`; ostane len
 *   holé `*`, odmietnutia a otázky). Engine priečinky klienta dostane po chatoch: server zapíše vedľa
 *   neho mapu klientov a ich pripojených priečinkov a plugin `lawoss-linked-folders` podľa nej odpovie
 *   na otázku `external_directory` len v chatoch toho klienta.
 * - Natívny zápis zoznamu (Nastavenia, Domov klienta, PATCH konfigurácie) odmietne nový priečinok, ktorý
 *   je relatívny, obsahuje dáta aplikácie, leží v inom registrovanom klientovi alebo ho obsahuje, alebo
 *   leží v praxi (okrem pamäte kancelárie). Mapa aj plugin tie isté pravidlá uplatnia znova, takže ani
 *   položka zapísaná inou cestou (napr. migrácia starej konfigurácie) nič neotvorí.
 */
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ApiError } from "../errors.js";
import { appliedOrgPolicy } from "../org-policy.js";
import { readRuntimeOpencodeConfig, runtimeExternalDirectory, runtimeStorageDir } from "../runtime-opencode-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { canonicalPath, folderOfGrant, LINKED_FOLDERS_MAP_FILE, linkedFolderConflict, type LinkedFolderConflict, type LinkedFoldersMap } from "./linked-folders-rules.js";

export function linkedFoldersMapPath(config: ServerConfig): string {
  return join(runtimeStorageDir(config), LINKED_FOLDERS_MAP_FILE);
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Bez povolení `external_directory` pracovného priestoru v spoločnom súbore: preč ide každé `allow`
 * (`<priečinok>/*`, `/**`, glob, holý priečinok, `~/…`) okrem holého `*`; odmietnutia a otázky ostanú.
 */
export function withoutClientFolderGrants(permission: Record<string, unknown>): Record<string, unknown> {
  const entries = permission.external_directory;
  if (!isRecord(entries)) return permission;
  const kept = Object.fromEntries(Object.entries(entries).filter(([key, value]) => value !== "allow" || key.trim() === "*"));
  const { external_directory: _grants, ...rest } = permission;
  return Object.keys(kept).length ? { ...rest, external_directory: kept } : rest;
}

async function existingCanonical(path: string): Promise<string | null> {
  return path ? await canonicalPath(path).catch(() => null) : null;
}

/** Koreň praxe z profilu onboardingu (ako `agent-client-boundary.ts`); bez profilu `null`. */
async function officeRoot(config: ServerConfig): Promise<string | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(runtimeStorageDir(config), "lawoss-onboarding", "profile.json"), "utf8"));
    const root = raw && typeof raw === "object" && "officeRoot" in raw && typeof raw.officeRoot === "string" ? raw.officeRoot : null;
    return root ? await existingCanonical(root) : null;
  } catch {
    return null;
  }
}

/** Lokálni klienti: bez vzdialených a bez wiki (wiki má vlastné pravidlá prístupu, nie je klient). */
const localWorkspaces = (config: ServerConfig): WorkspaceInfo[] => config.workspaces.filter((workspace) => workspace.workspaceType !== "remote" && workspace.preset !== "wiki" && Boolean(workspace.path));

/** Rozsah pravidiel pre jeden pracovný priestor: jeho koreň, ostatní registrovaní, prax a dáta aplikácie. */
async function conflictScope(config: ServerConfig, workspace: WorkspaceInfo) {
  const others = await Promise.all(localWorkspaces(config).filter((other) => other.id !== workspace.id).map((other) => existingCanonical(other.path)));
  const appData = await existingCanonical(runtimeStorageDir(config)) ?? runtimeStorageDir(config);
  const wikis = await Promise.all(config.workspaces.filter((entry) => entry.preset === "wiki" && entry.workspaceType !== "remote" && entry.path).map((entry) => existingCanonical(entry.path)));
  return {
    contentRoots: wikis.filter((root): root is string => root !== null),
    ownRoot: await existingCanonical(workspace.path),
    otherRoots: others.filter((root): root is string => root !== null),
    officeRoot: await officeRoot(config),
    protectedDirs: [appData],
  };
}

const conflictErrors: Record<LinkedFolderConflict, () => ApiError> = {
  relative: () => new ApiError(400, "linked_folder_relative", "Use an absolute folder path."),
  app_data: () => new ApiError(409, "linked_folder_app_data", "This folder is inside or contains LegalWork application data and cannot be linked."),
  other_client: () => new ApiError(409, "linked_folder_other_client", "This folder belongs to another client and cannot be linked."),
  practice: () => new ApiError(409, "linked_folder_practice", "Folders of the practice cannot be linked. Link a folder outside the practice."),
};

/** Mapa pre plugin: kanonický koreň každého lokálneho klienta a jeho pripojené priečinky bez kolízií. */
export async function buildLinkedFoldersMap(config: ServerConfig): Promise<LinkedFoldersMap> {
  const firm = await appliedOrgPolicy(config, "tools.permissions").catch(() => null);
  if (firm?.value.external_directory !== undefined) return { version: 1, officeRoot: null, clients: [], firmManaged: true };
  const clients = [];
  for (const workspace of localWorkspaces(config)) {
    const scope = await conflictScope(config, workspace);
    if (!scope.ownRoot) continue;
    const grants = runtimeExternalDirectory(await readRuntimeOpencodeConfig(config, workspace.id));
    const candidates = Object.entries(grants).flatMap(([key, value]) => {
      const folder = folderOfGrant(key, value);
      return folder ? [folder] : [];
    });
    const folders: string[] = [];
    for (const folder of candidates) {
      if (linkedFolderConflict(folder, scope) === "relative") continue;
      const canonical = await canonicalPath(folder);
      if (linkedFolderConflict(canonical, scope) === null) folders.push(canonical);
    }
    clients.push({ root: scope.ownRoot, folders });
  }
  return { version: 1, officeRoot: await officeRoot(config), clients, firmManaged: false };
}

// Zápisy mapy idú za sebou a obsah sa skladá až v rade: staršie zostavenie nikdy nepremenuje posledné.
const mapWrites = new Map<string, Promise<void>>();

/** Atomický zápis mapy vedľa súboru enginu (plugin ju číta pri každej otázke). */
export async function writeLinkedFoldersMap(config: ServerConfig): Promise<void> {
  const path = linkedFoldersMapPath(config);
  const job = async () => {
    const content = JSON.stringify(await buildLinkedFoldersMap(config));
    await mkdir(runtimeStorageDir(config), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
  };
  const next = (mapWrites.get(path) ?? Promise.resolve()).then(job, job);
  mapWrites.set(path, next);
  try { await next; }
  finally { if (mapWrites.get(path) === next) mapWrites.delete(path); }
}

/**
 * Obnova mapy pri registrácii, odobratí či presune klienta (háčik `onWorkspacesChanged`). Len ak mapu
 * už zapísal engine tohto servera; prebiehajúce zápisy počká zastavenie servera.
 */
export function linkedFoldersMapRefresher(config: ServerConfig): { refresh: () => void; stop: () => Promise<void> } {
  const pending = new Set<Promise<void>>();
  let stopped = false;
  return {
    refresh: () => {
      if (stopped) return;
      const job = access(linkedFoldersMapPath(config)).then(() => writeLinkedFoldersMap(config), () => undefined).catch(() => undefined);
      pending.add(job);
      void job.finally(() => pending.delete(job));
    },
    stop: async () => {
      stopped = true;
      await Promise.all(pending);
    },
  };
}

/** Natívny zápis zoznamu: nový priečinok nesmie byť relatívny ani zasahovať do iného klienta, praxe či dát aplikácie. */
export async function requireLinkableFolders(config: ServerConfig, workspace: WorkspaceInfo, folders: readonly string[], existing: readonly string[]): Promise<void> {
  const added = folders.filter((folder) => !existing.includes(folder));
  if (added.length === 0) return;
  const scope = await conflictScope(config, workspace);
  for (const folder of added) {
    const relative = linkedFolderConflict(folder, scope);
    if (relative === "relative") throw conflictErrors.relative();
    const conflict = linkedFolderConflict(await canonicalPath(folder), scope);
    if (conflict) throw conflictErrors[conflict]();
  }
}

/**
 * PATCH konfigurácie pracovného priestoru: nové `allow` v `external_directory` smie byť len holé `*`
 * alebo `<absolútny priečinok>/*`, ktorý prejde tými istými pravidlami ako natívny zoznam.
 */
export async function requireLinkableExternalDirectory(config: ServerConfig, workspace: WorkspaceInfo, update: unknown, existing: Record<string, unknown>): Promise<void> {
  if (!isRecord(update)) return;
  const folders: string[] = [];
  for (const [key, value] of Object.entries(update)) {
    if (value !== "allow" || existing[key] === "allow" || key.trim() === "*") continue;
    const folder = folderOfGrant(key, value);
    if (!folder) throw new ApiError(400, "linked_folder_pattern", "Folder access can only be granted as <absolute folder>/*.");
    folders.push(folder);
  }
  await requireLinkableFolders(config, workspace, folders, []);
}

/** Priečinky klienta na zdieľanie do sandboxu: len tie, ktoré pravidlá pripojených priečinkov dovolia. */
export async function linkableFolders(config: ServerConfig, workspace: WorkspaceInfo, folders: readonly string[]): Promise<string[]> {
  // Wiki nie je klient: jej povolenia projektov majú vlastné pravidlá (wiki/access.ts).
  if (workspace.preset === "wiki") return [...folders];
  const scope = await conflictScope(config, workspace);
  const kept: string[] = [];
  for (const folder of folders) {
    if (linkedFolderConflict(folder, scope) === "relative") continue;
    if (linkedFolderConflict(await canonicalPath(folder), scope) === null) kept.push(folder);
  }
  return kept;
}
