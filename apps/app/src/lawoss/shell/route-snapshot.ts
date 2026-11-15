/**
 * LAWOSS (#418): Nastavenia sú samostatná trasa, takže po ich zatvorení sa trasa chatu pripojí nanovo a jej stav
 * začína prázdny: bočný panel na chvíľu nemá klientov a stavový riadok píše „Príprava pracovného priestoru“.
 * Posledný načítaný zoznam priečinkov so spojením, ktoré ho načítalo, preto prežije opätovné pripojenie trasy
 * a použije sa ako počiatočný stav, kým obnovenie beží na pozadí. Platí len pre to isté spojenie: uložené
 * nastavenia servera (synchrónny odtlačok) musia byť rovnaké ako pri uložení a po zistení spojenia trasa
 * zoznam iného spojenia hneď zahodí (`connectionKey`). Jeden záznam, žiadne čítanie navyše.
 */
import type { LegalworkServerClient, LegalworkServerSettings } from "@/app/lib/legalwork-server";
import type { RouteSession, RouteWorkspace } from "@/react-app/shell/route-workspaces";
import type { OkfConnection } from "@/lawoss/okf/connection";

export type WorkspaceRouteSnapshot = {
  /** Stored server settings when the list was kept: a remount with other settings starts empty. */
  settingsKey: string;
  /** The resolved connection that loaded the list (`workspaceConnectionKey`). */
  connectionKey: string;
  client: LegalworkServerClient;
  baseUrl: string;
  token: string;
  hostToken: string;
  workspaces: RouteWorkspace[];
  /** Chats already loaded per client: a remount shows them and spins only for clients never loaded. */
  sessionsByWorkspaceId?: Record<string, RouteSession[]>;
};

let last: WorkspaceRouteSnapshot | null = null;

/**
 * #418: the last resolved OKF connection (pages, side panel, Today) with the same identity rules as the list: the
 * same stored settings, forgotten when another connection resolves or the server is disconnected. A remount starts
 * from it, so the overview of that connection is served from its cache at once and only revalidated.
 */
type OkfConnectionSnapshot = { settingsKey: string; connectionKey: string; connection: OkfConnection };
let lastOkf: OkfConnectionSnapshot | null = null;

/** Keeps the connection a page just resolved (`null` forgets it). */
export function rememberOkfConnection(snapshot: OkfConnectionSnapshot | null): void {
  lastOkf = snapshot?.connection.client ? snapshot : null;
}

/** The kept OKF connection when the stored settings are unchanged; otherwise `null` (the page reads it as before). */
export function okfConnectionForRemount(settingsKey: string): OkfConnection | null {
  return lastOkf?.settingsKey === settingsKey ? lastOkf.connection : null;
}

/** The connection identity the route already uses for its server client. */
export const workspaceConnectionKey = (baseUrl: string, token: string, hostToken: string): string => JSON.stringify([baseUrl, token, hostToken]);

/** Synchronous fingerprint of the stored server connection (address, port, tokens). */
export const storedSettingsKey = (settings: LegalworkServerSettings): string =>
  JSON.stringify([settings.urlOverride ?? "", settings.portOverride ?? null, settings.token ?? "", settings.hostToken ?? ""]);

/** Keeps the last loaded list (`null` forgets it, e.g. when the server is disconnected). */
export function rememberWorkspaceRoute(snapshot: WorkspaceRouteSnapshot | null): void {
  last = snapshot;
  // A disconnected server forgets the OKF connection too.
  if (!snapshot) lastOkf = null;
}

/**
 * Every resolved connection checks the kept list: another connection forgets it. The default desktop connection has
 * no stored settings (constant `storedSettingsKey`) and its identity is known only after the async resolution, so the
 * route cannot check it at mount; the resolver runs on other routes too (Settings, listeners), and a change it sees
 * while the chat route is away forgets the list before the remount could show another connection's clients.
 */
export function noteResolvedConnection(baseUrl: string, token: string, hostToken: string): void {
  const key = workspaceConnectionKey(baseUrl, token, hostToken);
  if (last && last.connectionKey !== key) last = null;
  if (lastOkf && lastOkf.connectionKey !== key) lastOkf = null;
}

/** The kept list for a remount with unchanged settings; not when the address names a folder the list does not know. */
export function workspaceRouteForRemount(settingsKey: string, routeWorkspaceId: string): WorkspaceRouteSnapshot | null {
  if (!last || last.settingsKey !== settingsKey) return null;
  if (routeWorkspaceId && !last.workspaces.some((workspace) => workspace.id === routeWorkspaceId)) return null;
  return last;
}

/** The route's initial state: the kept list as loaded (no "preparing" status), otherwise empty and loading. */
export function initialWorkspaceRouteState(snapshot: WorkspaceRouteSnapshot | null) {
  const sessions = snapshot?.sessionsByWorkspaceId ?? {};
  const known = snapshot?.workspaces.filter((workspace) => sessions[workspace.id] !== undefined) ?? [];
  return {
    loading: !snapshot,
    hasLoadedServerWorkspaces: Boolean(snapshot),
    workspaces: snapshot?.workspaces ?? [],
    client: snapshot?.client ?? null,
    baseUrl: snapshot?.baseUrl ?? "",
    token: snapshot?.token ?? "",
    hostToken: snapshot?.hostToken ?? "",
    // Chats already loaded stay visible and refresh quietly; only a client whose chats were never loaded shows as
    // loading (not "not found") until its first list arrives.
    sessionsByWorkspaceId: Object.fromEntries(known.map((workspace) => [workspace.id, sessions[workspace.id] ?? []])),
    retryingWorkspaceIds: snapshot?.workspaces.flatMap((workspace) => sessions[workspace.id] === undefined ? [workspace.id] : []) ?? [],
    connection: snapshot ? { key: snapshot.connectionKey, client: snapshot.client } : null,
  };
}

/** Chat lists that finished loading; a client still loading is left out, so a remount shows it as loading. */
export function settledSessions<T>(sessions: Record<string, T>, loading: readonly string[]): Record<string, T> {
  return loading.length ? Object.fromEntries(Object.entries(sessions).filter(([id]) => !loading.includes(id))) : sessions;
}

/**
 * After a failed refresh the chats the remount seeded as loading are loading no more: the stale list stays, the route
 * error shows, and no client keeps spinning. Ids another refresh marked as loading stay.
 */
export const withoutRemountRetrying = (current: string[], seeded: readonly string[]): string[] =>
  seeded.length ? current.filter((id) => !seeded.includes(id)) : current;
