import type { OnboardingApplyResult } from "./api";

type ClientWorkspace = NonNullable<OnboardingApplyResult["workspace"]>;
type NativeList = { workspaces: readonly { id: string; path: string }[] };

/**
 * Natívne zaregistruje ostatných klientov z dávky praxe (spec 2026-10-08: každý potvrdený klient je
 * samostatný pracovný priečinok). Aktívny klient sa registruje zvlášť; vráti posledný natívny zoznam.
 */
export async function registerOtherClients<L extends NativeList>(
  clients: readonly OnboardingApplyResult[],
  activeId: string | undefined,
  register: (workspace: ClientWorkspace, result: OnboardingApplyResult) => Promise<L>,
): Promise<L | undefined> {
  const seen = new Set(activeId ? [activeId] : []);
  let last: L | undefined;
  for (const client of clients) {
    const workspace = client.workspace;
    if (!workspace || seen.has(workspace.id)) continue;
    seen.add(workspace.id);
    last = await register(workspace, client);
    if (!last.workspaces.some(item => item.id === workspace.id && item.path === workspace.path)) throw new Error("Client registration did not preserve workspace identity.");
  }
  return last;
}
