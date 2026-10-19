/**
 * LAWOSS-lite pracuje s celou kanceláří. Konverzace nad věcí ale aktivuje složku věci
 * (session route to dělá sama), takže nová věc i Personalizace by jinak
 * běžely nad věcí. Tady se rozsah vrací na kancelář (review PR #100).
 */
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { toSessionTransportDirectory } from "@/app/lib/session-scope";
import { loadOkfConnection, openSessionWithPrompt, type OkfConnection } from "../okf/connection";
import { activateLocalWorkspace } from "../okf/matter-session";
import { activeWorkspace, officeOf, officeWorkspace, OFFICE_SCOPE_RESTORED } from "../okf/read-model";
import { currentUiMode } from "./ui-mode";

let pending: Promise<OkfConnection> | null = null;

/**
 * Je-li aktivní složka uvnitř kanceláře, aktivuje zpět kancelář; jinak nic nedělá.
 * Spojení se načítá vždy znovu - aktivní složku mezitím změnila konverzace a seznam složek nová věc.
 */
export function restoreOfficeScope(): Promise<OkfConnection> {
  pending ??= (async () => {
    const connection = await loadOkfConnection();
    const active = activeWorkspace(connection);
    const office = officeWorkspace(connection);
    if (!connection.client || !office || !active || office.id === active.id) return connection;
    const restored = await activateLocalWorkspace({ ...connection, client: connection.client }, office, connection.workspaces);
    // Stránky načtené během přepínání četly ještě starý stav - ať se načtou znovu.
    window.dispatchEvent(new CustomEvent(OFFICE_SCOPE_RESTORED));
    return restored;
  })().finally(() => { pending = null; });
  return pending;
}

/**
 * „Nový chat“ v priečinku klienta, ktorý leží v registrovanom koreni praxe (jeden priečinok pre všetko,
 * MČ 19. 10. 2026): aktivuje koreň a založí chat s priečinkom konverzácie = priečinok klienta, nikdy nad
 * celou praxou. Server priečinok overí v koreni (ako pri chate vo veci).
 */
export async function openClientFolderChat(workspaceId: string, folder: string): Promise<string> {
  const connection = await loadOkfConnection();
  const workspace = connection.workspaces.find((w) => w.id === workspaceId);
  if (!connection.client || !workspace) throw new Error("client workspace unavailable");
  const active = connection.activeWorkspaceId === workspace.id ? connection : await activateLocalWorkspace({ ...connection, client: connection.client }, workspace, connection.workspaces);
  return openSessionWithPrompt(active, workspace, "", toSessionTransportDirectory(folder));
}

/** Nastavení v lite: složka věci → kancelář (Personalizace je profil kanceláře). `null` = nic neměnit. */
export function liteSettingsWorkspace(selectedId: string, workspaces: readonly RouteWorkspace[]): string | null {
  if (currentUiMode() !== "lite") return null;
  const office = officeOf(workspaces, workspaces.find((w) => w.id === selectedId) ?? null);
  return office && office.id !== selectedId ? office.id : null;
}
