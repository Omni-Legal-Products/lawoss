import { revalidateScopeTarget } from "../okf/scope-target";
/**
 * LAWOSS-lite pracuje s celou kanceláří. Konverzace nad věcí ale aktivuje složku věci
 * (session route to dělá sama), takže nová věc, „Zeptat se“ i Personalizace by jinak
 * běžely nad věcí. Tady se rozsah vrací na kancelář (review PR #100).
 */
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { loadOkfConnection, openSessionWithPrompt, type OkfConnection } from "../okf/connection";
import { activateLocalWorkspace } from "../okf/matter-session";
import { activeWorkspace, officeOf, officeWorkspace, type OkfScope, OFFICE_SCOPE_RESTORED } from "../okf/read-model";
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

/** „Zeptat se“: nová konverzace v kanceláři, bez věci - ne poslední konverzace naposledy otevřené věci. */
export async function openOfficeChat(): Promise<string> {
  const connection = await restoreOfficeScope();
  const office = officeWorkspace(connection);
  if (!office) throw new Error("no office workspace");
  return openSessionWithPrompt(connection, office, "");
}

/** „Opýtať sa“ v praxi: nová konverzácia v priečinku vybraného klienta, nikdy nad celou praxou (prehľad praxe). */
export async function openClientChat(workspaceId: string, expectedScope: OkfScope | null, expectedConnection: OkfConnection | null): Promise<string> {
  if (!expectedConnection) throw new Error("client_workspace_unavailable");
  const { connection, workspace } = await revalidateScopeTarget(expectedScope,expectedConnection,workspaceId);
  const active = connection.activeWorkspaceId === workspace.id ? connection : await activateLocalWorkspace({ ...connection, client: connection.client }, workspace, connection.workspaces);
  return openSessionWithPrompt(active, workspace, "");
}

/** Nastavení v lite: složka věci → kancelář (Personalizace je profil kanceláře). `null` = nic neměnit. */
export function liteSettingsWorkspace(selectedId: string, workspaces: readonly RouteWorkspace[]): string | null {
  if (currentUiMode() !== "lite") return null;
  const office = officeOf(workspaces, workspaces.find((w) => w.id === selectedId) ?? null);
  return office && office.id !== selectedId ? office.id : null;
}
