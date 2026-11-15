/**
 * LAWOSS (#418): Nastavenia sú samostatná trasa, takže po ich zatvorení sa trasa chatu pripojí nanovo a jej stav
 * začína prázdny: bočný panel na chvíľu nemá klientov a stavový riadok píše „Príprava pracovného priestoru“.
 * Posledný načítaný zoznam priečinkov so spojením, ktoré ho načítalo, preto prežije opätovné pripojenie trasy
 * a použije sa ako počiatočný stav, kým obnovenie beží na pozadí. Platí len pre to isté spojenie: uložené
 * nastavenia servera (synchrónny odtlačok) musia byť rovnaké ako pri uložení a po zistení spojenia trasa
 * zoznam iného spojenia hneď zahodí (`connectionKey`). Jeden záznam, žiadne čítanie navyše.
 */
import type { LegalworkServerClient, LegalworkServerSettings } from "@/app/lib/legalwork-server";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";

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
};

let last: WorkspaceRouteSnapshot | null = null;

/** The connection identity the route already uses for its server client. */
export const workspaceConnectionKey = (baseUrl: string, token: string, hostToken: string): string => JSON.stringify([baseUrl, token, hostToken]);

/** Synchronous fingerprint of the stored server connection (address, port, tokens). */
export const storedSettingsKey = (settings: LegalworkServerSettings): string =>
  JSON.stringify([settings.urlOverride ?? "", settings.portOverride ?? null, settings.token ?? "", settings.hostToken ?? ""]);

/** Keeps the last loaded list (`null` forgets it, e.g. when the server is disconnected). */
export function rememberWorkspaceRoute(snapshot: WorkspaceRouteSnapshot | null): void {
  last = snapshot;
}

/** The kept list for a remount with unchanged settings; not when the address names a folder the list does not know. */
export function workspaceRouteForRemount(settingsKey: string, routeWorkspaceId: string): WorkspaceRouteSnapshot | null {
  if (!last || last.settingsKey !== settingsKey) return null;
  if (routeWorkspaceId && !last.workspaces.some((workspace) => workspace.id === routeWorkspaceId)) return null;
  return last;
}

/** The route's initial state: the kept list as loaded (no "preparing" status), otherwise empty and loading. */
export function initialWorkspaceRouteState(snapshot: WorkspaceRouteSnapshot | null) {
  return {
    loading: !snapshot,
    hasLoadedServerWorkspaces: Boolean(snapshot),
    workspaces: snapshot?.workspaces ?? [],
    client: snapshot?.client ?? null,
    baseUrl: snapshot?.baseUrl ?? "",
    token: snapshot?.token ?? "",
    hostToken: snapshot?.hostToken ?? "",
    // The chats of each client load again in the background, as after a refresh: shown as loading, not "not found".
    retryingWorkspaceIds: snapshot?.workspaces.map((workspace) => workspace.id) ?? [],
    connection: snapshot ? { key: snapshot.connectionKey, client: snapshot.client } : null,
  };
}
