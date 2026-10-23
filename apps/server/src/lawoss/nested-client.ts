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

/** Zaregistrovaní klienti s kanonickým, zjednoteným koreňom; kontajner praxe medzi nimi nie je. */
async function registeredClients(config: ServerConfig): Promise<RegisteredClient[]> {
  const practice = await officeRoot(config);
  const office = practice ? foldedPath(practice) : null;
  const clients = await Promise.all((await clientWorkspaces(config)).map(async (workspace) => ({ root: foldedPath(await canonicalPath(workspace.path)), ref: refOf(workspace) })));
  return clients.filter((client) => !office || !isPathWithin(client.root, office));
}

/** Bez I/O: koreň klienta a zaregistrovaní klienti už kanonicky a zjednotene. */
export function nestedClientConflict(candidate: string, clients: readonly { root: string; ref: NestedClientRef }[]): NestedClientConflict | null {
  const outer = [...clients].sort((left, right) => right.root.length - left.root.length).find((client) => strictlyWithin(client.root, candidate));
  if (outer) return { kind: "nested", outer: outer.ref };
  // Už zaregistrovaný priečinok sa týmto nezaregistruje znova; starý stav s klientom vnútri ostane voliteľný.
  if (clients.some((client) => client.root === candidate)) return null;
  const inner = clients.filter((client) => strictlyWithin(candidate, client.root));
  return inner.length ? { kind: "contains", clients: inner.map((client) => client.ref) } : null;
}

/** Odmietne priečinok ako klienta, ak leží v inom zaregistrovanom klientovi alebo nejakého obsahuje. Nič nezapisuje. */
export async function assertClientFolderNotNested(config: ServerConfig, folder: string): Promise<void> {
  const conflict = nestedClientConflict(foldedPath(await canonicalPath(folder)), await registeredClients(config));
  if (conflict?.kind === "nested")
    throw new ApiError(409, "onboarding_client_nested", "This folder belongs to another client. A client cannot be inside another client. Nothing was changed.", conflict.outer);
  if (conflict?.kind === "contains")
    throw new ApiError(409, "onboarding_client_contains_clients", "This folder holds the folders of other clients. Choose the folder of one client. Nothing was changed.", { clients: conflict.clients });
}

/** Je priečinok sám zaregistrovaný klient mimo kontajnera praxe? (hranica nástrojov agenta) */
export async function isRegisteredClientRoot(config: ServerConfig, folder: string): Promise<boolean> {
  const candidate = foldedPath(await canonicalPath(folder));
  return (await registeredClients(config)).some((client) => client.root === candidate);
}
