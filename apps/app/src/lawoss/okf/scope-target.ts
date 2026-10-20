import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { loadOkfConnection, type OkfConnection } from "./connection";
import { canActOnSource, okfScope, okfScopeKey, readWorkspaceMemory, type OkfScope } from "./read-model";

/** Odmietnutie overenia: prax sa zmenila, priečinok v nej nie je, alebo sa jeho zdroj nedal čerstvo prečítať. */
const SCOPE_REFUSALS = new Set(["practice_scope_changed", "client_workspace_unavailable", "client_read_incomplete"]);
export const isScopeRefusal = (error: unknown): boolean => error instanceof Error && SCOPE_REFUSALS.has(error.message);

/**
 * Rozsah, ktorý `revalidateScopeTarget` porovnáva: z toho istého zoznamu priečinkov, z ktorého ho pri overení
 * postaví znova (spojenie `loadOkfConnection`), nie zo živého zoznamu bočného panela. Ten vynecháva wiki
 * a pridáva projekty, ktoré pozná len desktop; rozsah z neho by sa pri overení nikdy nezhodoval.
 */
export function revalidationScope(workspaces: readonly RouteWorkspace[], anchorId: string | null | undefined, practiceRoot: string | null | undefined): OkfScope | null {
  return okfScope(workspaces, workspaces.find(w => w.id === anchorId) ?? null, practiceRoot);
}

/**
 * Čím sa overuje cieľ akcie (#168): spojenie a rozsah z `loadOkfConnection` (ako ich postaví `revalidateScopeTarget`),
 * nie živý zoznam bočného panela. `practice` = je známy koreň praxe.
 */
export type RecheckTarget = { connection: OkfConnection | null; scope: OkfScope | null; practice: boolean };

/** Recheck membership and fresh source bytes immediately before admitting a client action. */
export async function revalidateScopeTarget(scope: OkfScope | null, expected: Pick<OkfConnection, "baseUrl" | "token" | "authGeneration">, workspaceId: string, load: () => Promise<OkfConnection> = loadOkfConnection) {
  const connection = await load();
  if (!scope || !connection.client || connection.baseUrl !== expected.baseUrl || connection.token !== expected.token || connection.authGeneration !== expected.authGeneration) throw new Error("practice_scope_changed");
  const profile = await connection.client.onboardingStatus();
  const current = revalidationScope(connection.workspaces, scope.anchor.id, profile.profile?.officeRoot);
  if (!current || okfScopeKey(current) !== okfScopeKey(scope)) throw new Error("practice_scope_changed");
  const workspace = current.members.find(member => member.workspace.id === workspaceId)?.workspace;
  if (!workspace) throw new Error("client_workspace_unavailable");
  const read = await readWorkspaceMemory(connection.client,workspace.id);
  if (!canActOnSource(read,workspace.id)) throw new Error("client_read_incomplete");
  return { connection: { ...connection, client: connection.client }, workspace };
}
