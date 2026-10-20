/**
 * LAWOSS: pripojené priečinky klienta na serveri (MČ 19. 10. 2026).
 *
 * - Spoločný súbor enginu (`OPENCODE_CONFIG`) je jeden pre všetkých klientov, preto do neho povolenia
 *   priečinkov klienta nejdú (`withoutClientFolderGrants`). Engine ich dostane po chatoch: server zapíše
 *   vedľa neho mapu klientov a ich pripojených priečinkov a plugin `lawoss-linked-folders` podľa nej
 *   odpovie na otázku `external_directory` len v chatoch toho klienta.
 * - Natívny zápis zoznamu (Nastavenia aj Domov klienta) odmietne nový priečinok, ktorý leží v inom
 *   registrovanom klientovi alebo ho obsahuje, alebo leží v praxi (okrem pamäte kancelárie).
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ApiError } from "../errors.js";
import { appliedOrgPolicy } from "../org-policy.js";
import { readRuntimeOpencodeConfig, runtimeExternalDirectory, runtimeStorageDir } from "../runtime-opencode-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { canonicalPath, folderOfGrant, LINKED_FOLDERS_MAP_FILE, linkedFolderConflict, type LinkedFoldersMap } from "./linked-folders-rules.js";

export function linkedFoldersMapPath(config: ServerConfig): string {
  return join(runtimeStorageDir(config), LINKED_FOLDERS_MAP_FILE);
}

/** Bez povolení priečinkov klienta (`<priečinok>/*: allow`); ostatné položky (napr. odmietnutia, `*`) ostanú. */
export function withoutClientFolderGrants(permission: Record<string, unknown>): Record<string, unknown> {
  const entries = permission.external_directory;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) return permission;
  const kept = Object.fromEntries(Object.entries(entries).filter(([key, value]) => folderOfGrant(key, value) === null));
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

const localWorkspaces = (config: ServerConfig): WorkspaceInfo[] => config.workspaces.filter((workspace) => workspace.workspaceType !== "remote" && Boolean(workspace.path));

/** Mapa pre plugin: kanonický koreň každého lokálneho klienta a jeho pripojené priečinky. */
export async function buildLinkedFoldersMap(config: ServerConfig): Promise<LinkedFoldersMap> {
  const firm = await appliedOrgPolicy(config, "tools.permissions").catch(() => null);
  if (firm?.value.external_directory !== undefined) return { version: 1, officeRoot: null, clients: [], firmManaged: true };
  const clients = [];
  for (const workspace of localWorkspaces(config)) {
    const root = await existingCanonical(workspace.path);
    if (!root) continue;
    const grants = runtimeExternalDirectory(await readRuntimeOpencodeConfig(config, workspace.id));
    const folders = await Promise.all(Object.entries(grants).flatMap(([key, value]) => {
      const folder = folderOfGrant(key, value);
      return folder ? [canonicalPath(folder)] : [];
    }));
    clients.push({ root, folders });
  }
  return { version: 1, officeRoot: await officeRoot(config), clients, firmManaged: false };
}

/** Atomický zápis mapy vedľa súboru enginu (plugin ju číta pri každej otázke). */
export async function writeLinkedFoldersMap(config: ServerConfig): Promise<void> {
  const path = linkedFoldersMapPath(config);
  await mkdir(runtimeStorageDir(config), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(await buildLinkedFoldersMap(config)), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

/** Natívny zápis zoznamu: nový priečinok nesmie zasahovať do iného klienta ani do praxe. */
export async function requireLinkableFolders(config: ServerConfig, workspace: WorkspaceInfo, folders: readonly string[], existing: readonly string[]): Promise<void> {
  const added = folders.filter((folder) => !existing.includes(folder));
  if (added.length === 0) return;
  const ownRoot = await existingCanonical(workspace.path);
  const others = await Promise.all(localWorkspaces(config).filter((other) => other.id !== workspace.id).map((other) => existingCanonical(other.path)));
  const scope = { ownRoot, otherRoots: others.filter((root): root is string => root !== null), officeRoot: await officeRoot(config) };
  for (const folder of added) {
    const conflict = linkedFolderConflict(await canonicalPath(folder), scope);
    if (conflict === "other_client") throw new ApiError(409, "linked_folder_other_client", "This folder belongs to another client and cannot be linked.");
    if (conflict === "practice") throw new ApiError(409, "linked_folder_practice", "Folders of the practice cannot be linked. Link a folder outside the practice.");
  }
}
