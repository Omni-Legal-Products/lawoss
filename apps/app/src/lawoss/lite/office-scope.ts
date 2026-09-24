/**
 * LAWOSS-lite pracuje s celou kanceláří. Konverzace nad věcí ale aktivuje složku věci
 * (session route to dělá sama), takže nová věc, „Zeptat se“ i Personalizace by jinak
 * běžely nad věcí. Tady se rozsah vrací na kancelář (review PR #100).
 */
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { loadOkfConnection, openSessionWithPrompt, type OkfConnection } from "../okf/connection";
import { activateLocalWorkspace } from "../okf/matter-session";
import { activeWorkspace, officeOf, officeWorkspace } from "../okf/read-model";
import { currentUiMode } from "./ui-mode";

let pending: Promise<OkfConnection> | null = null;

/**
 * Je-li aktivní složka uvnitř kanceláře, aktivuje zpět kancelář; jinak nic nedělá.
 * Spojení se načítá vždy znovu — aktivní složku mezitím změnila konverzace a seznam složek nová věc.
 */
export function restoreOfficeScope(): Promise<OkfConnection> {
  pending ??= (async () => {
    const connection = await loadOkfConnection();
    const active = activeWorkspace(connection);
    const office = officeWorkspace(connection);
    if (!connection.client || !office || !active || office.id === active.id) return connection;
    return activateLocalWorkspace({ ...connection, client: connection.client }, office, connection.workspaces);
  })().finally(() => { pending = null; });
  return pending;
}

/** „Zeptat se“: nová konverzace v kanceláři, bez věci — ne poslední konverzace naposledy otevřené věci. */
export async function openOfficeChat(): Promise<string> {
  const connection = await restoreOfficeScope();
  const office = officeWorkspace(connection);
  if (!office) throw new Error("no office workspace");
  return openSessionWithPrompt(connection, office, "");
}

/** Nastavení v lite: složka věci → kancelář (Personalizace je profil kanceláře). `null` = nic neměnit. */
export function liteSettingsWorkspace(selectedId: string, workspaces: readonly RouteWorkspace[]): string | null {
  if (currentUiMode() !== "lite") return null;
  const office = officeOf(workspaces, workspaces.find((w) => w.id === selectedId) ?? null);
  return office && office.id !== selectedId ? office.id : null;
}
