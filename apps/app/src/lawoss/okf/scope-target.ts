import { loadOkfConnection, type OkfConnection } from "./connection";
import { canActOnSource, okfScope, okfScopeKey, readWorkspaceMemory, type OkfScope } from "./read-model";

/** Recheck membership and fresh source bytes immediately before admitting a client action. */
export async function revalidateScopeTarget(scope: OkfScope | null, expected: Pick<OkfConnection, "baseUrl" | "token" | "authGeneration">, workspaceId: string) {
  const connection = await loadOkfConnection();
  if (!scope || !connection.client || connection.baseUrl !== expected.baseUrl || connection.token !== expected.token || connection.authGeneration !== expected.authGeneration) throw new Error("practice_scope_changed");
  const profile = await connection.client.onboardingStatus();
  const current = okfScope(connection.workspaces, connection.workspaces.find(w => w.id === scope.anchor.id) ?? null, profile.profile?.officeRoot);
  if (!current || okfScopeKey(current) !== okfScopeKey(scope)) throw new Error("practice_scope_changed");
  const workspace = current.members.find(member => member.workspace.id === workspaceId)?.workspace;
  if (!workspace) throw new Error("client_workspace_unavailable");
  const read = await readWorkspaceMemory(connection.client,workspace.id);
  if (!canActOnSource(read,workspace.id)) throw new Error("client_read_incomplete");
  return { connection: { ...connection, client: connection.client }, workspace };
}
