/**
 * LAWOSS: klient nesmie byť vnútri iného klienta (N-A3-1, test V10c, rozhodnutie MČ 23. 10. 2026).
 *
 * Priečinok vnútri zaregistrovaného klienta už patrí tomu klientovi; ako samostatný klient by zapísal
 * pomocné súbory do cudzieho klienta a profil s takým klientom zablokoval nástroje agenta vonkajšieho
 * klienta. Priečinok, ktorý zaregistrovaných klientov obsahuje, tiež nie je jeden klient.
 *
 * Klienti sú lokálne pracovné priestory bez wiki a bez domovského priestoru appky (`clientWorkspaces`).
 * Registrovaný kontajner praxe (rovná sa koreňu praxe z profilu alebo ho obsahuje) nie je klient: klienti
 * v ňom sú bežná prax. Cesty sa porovnávajú kanonicky (`realpath` + NFC) a na macOS a Windows bez ohľadu
 * na veľkosť písmen, ako `file-operations.ts`.
 *
 * Odmietnutie nesie id a meno klienta v `details`; tie číta len hostiteľská appka (trasy onboardingu
 * sú `host`). Veta správy ostáva bez mien.
 */
import { ApiError } from "../errors.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { clientWorkspaces, officeRoot } from "./linked-folders.js";
import { canonicalPath } from "./linked-folders-rules.js";
import { foldedPath, isPathWithin } from "./path-within.js";

export type NestedClientRef = { workspaceId: string; name: string };
export type NestedClientConflict =
  | { kind: "nested"; outer: NestedClientRef }
  | { kind: "contains"; clients: NestedClientRef[] };

type RegisteredClient = { root: string; ref: NestedClientRef };

const refOf = (workspace: WorkspaceInfo): NestedClientRef => ({ workspaceId: workspace.id, name: workspace.displayName?.trim() || workspace.name });
const strictlyWithin = (root: string, candidate: string) => root !== candidate && isPathWithin(root, candidate);

/** Všetky lokálne pracovné priestory klientov (aj kontajnery) s kanonickým, zjednoteným koreňom. */
async function localClientRoots(config: ServerConfig): Promise<RegisteredClient[]> {
  return Promise.all((await clientWorkspaces(config)).map(async (workspace) => ({ root: foldedPath(await canonicalPath(workspace.path)), ref: refOf(workspace) })));
}
/** Zaregistrovaní klienti; kontajner praxe (rovná sa koreňu praxe alebo ho obsahuje) medzi nimi nie je. */
async function registeredClients(config: ServerConfig, all?: readonly RegisteredClient[]): Promise<RegisteredClient[]> {
  const practice = await officeRoot(config);
  const office = practice ? foldedPath(practice) : null;
  return (all ?? await localClientRoots(config)).filter((client) => !office || !isPathWithin(client.root, office));
}

/**
 * Bez I/O: koreň klienta a zaregistrovaní klienti už kanonicky a zjednotene. `inPlace`: priečinok sa použije
 * na mieste (úprava, mapovanie, výber v profile); už zaregistrovaný sa tým nezaregistruje znova a starý stav
 * s klientom vnútri ostane voliteľný. Kópia (originál skúšobného klonu) výnimku nemá: skopírovala by aj klienta vo vnútri.
 */
export function nestedClientConflict(candidate: string, clients: readonly { root: string; ref: NestedClientRef }[], inPlace = true): NestedClientConflict | null {
  const outer = [...clients].sort((left, right) => right.root.length - left.root.length).find((client) => strictlyWithin(client.root, candidate));
  if (outer) return { kind: "nested", outer: outer.ref };
  if (inPlace && clients.some((client) => client.root === candidate)) return null;
  const inner = clients.filter((client) => strictlyWithin(candidate, client.root));
  return inner.length ? { kind: "contains", clients: inner.map((client) => client.ref) } : null;
}

/**
 * Odmietne priečinok ako klienta, ak leží v inom zaregistrovanom klientovi alebo nejakého obsahuje. Nič nezapisuje.
 * `use: "copy"` pre originál skúšobnej kópie (pozri `nestedClientConflict`).
 */
export async function assertClientFolderNotNested(config: ServerConfig, folder: string, use: "in_place" | "copy" = "in_place"): Promise<void> {
  const conflict = nestedClientConflict(foldedPath(await canonicalPath(folder)), await registeredClients(config), use === "in_place");
  if (conflict?.kind === "nested")
    throw new ApiError(409, "onboarding_client_nested", "This folder belongs to another client. A client cannot be inside another client. Nothing was changed.", conflict.outer);
  if (conflict?.kind === "contains")
    throw new ApiError(409, "onboarding_client_contains_clients", "This folder holds the folders of other clients. Choose the folder of one client. Nothing was changed.", { clients: conflict.clients });
}

/**
 * Hranica nástrojov agenta: priečinok je zaregistrovaný klient mimo kontajnera praxe a nie je v ňom zaregistrovaný
 * žiadny iný pracovný priestor (ako `nestedClientRoots`). Kontajner s klientmi (aj vnútri praxe) tak výnimku nedostane.
 */
export async function isStandaloneClientRoot(config: ServerConfig, folder: string): Promise<boolean> {
  const candidate = foldedPath(await canonicalPath(folder));
  const all = await localClientRoots(config);
  return (await registeredClients(config, all)).some((client) => client.root === candidate) && !all.some((client) => strictlyWithin(candidate, client.root));
}
