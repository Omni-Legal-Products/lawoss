import type { OnboardingApplyResult } from "./api";
import type { OnboardingCompletion } from "./lawoss-welcome-page";

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

type Registered = { id: string; path: string; name?: string; displayName?: string | null; appFiles?: OnboardingApplyResult["appFiles"] };

/** Natívne a serverové operácie registrácie; volajúci (welcome-route) ich dodá, test ich nahradí. */
export type RegisterWorkspaceDeps<N extends { id: string; path: string }, C> = {
  desktop: boolean;
  /** Klient uložený v profile onboardingu, ak výsledok nenesie pracovný priečinok. */
  profileClientRoot?: string;
  listWorkspaces(): Promise<{ items: readonly Registered[] }>;
  registerWorkingFolder(path: string): Promise<Registered>;
  createNative(input: { folderPath: string; name: string; appFiles?: OnboardingApplyResult["appFiles"] }): Promise<{ workspaces: readonly N[] }>;
  selectNative(id: string): Promise<unknown>;
  runtimeActive(id: string): Promise<unknown>;
  ensureConnection(native: N, all: readonly N[]): Promise<unknown>;
  /** Aktivuje priestor na serveri (trvalo) a vráti klienta servera pre ďalšie kroky. */
  activate(id: string): Promise<C>;
  remember(id: string): void;
};

const lastSegment = (path: string): string | undefined => path.split(/[\\/]/).filter(Boolean).pop();

/**
 * Zaregistruje pripojený priečinok, vyberie ho v bočnom paneli a aktivuje (aj ostatných klientov dávky).
 * Volá sa pred usporiadaním aj pri dokončení; natívna registrácia existujúceho priečinka je idempotentná
 * (rovnaká cesta = rovnaké id), preto druhé volanie nič nepokazí.
 */
export async function registerOnboardedWorkspace<N extends { id: string; path: string }, C>(
  deps: RegisterWorkspaceDeps<N, C>,
  result?: OnboardingApplyResult,
  completion?: OnboardingCompletion,
): Promise<{ id: string; client: C } | undefined> {
  const list = await deps.listWorkspaces();
  // Pracovný priečinok bez výsledku klienta (celá prax ako jeden priečinok) sa zaregistruje tak, ako je.
  const plain = !result?.workspace && completion?.workingFolder ? await deps.registerWorkingFolder(completion.workingFolder) : undefined;
  const workspace = result?.workspace ?? plain ?? list.items.find(item => item.path === deps.profileClientRoot);
  if (!workspace) return undefined;
  if (deps.desktop) {
    const existing = list.items.find(item => item.id === workspace.id);
    const nativeList = await deps.createNative({ folderPath: workspace.path, name: workspace.displayName ?? existing?.name ?? lastSegment(workspace.path) ?? "Client", appFiles: result?.appFiles ?? existing?.appFiles });
    const native = nativeList.workspaces.find(item => item.path === workspace.path);
    if (!native || native.id !== workspace.id) throw new Error("Client registration did not preserve workspace identity.");
    // Ostatní klienti dávky praxe sú samostatné pracovné priečinky. Natívne vytvorenie každý vyberie,
    // preto sa hlavný klient vyberie a aktivuje až po nich (review 6d), inak by ostal vybraný posledný.
    const others = await registerOtherClients(completion?.clients ?? [], native.id, (other, client) => deps.createNative({ folderPath: other.path, name: other.displayName ?? lastSegment(other.path) ?? "Client", appFiles: client.appFiles }));
    await deps.selectNative(native.id);
    await deps.runtimeActive(native.id);
    await deps.ensureConnection(native, (others ?? nativeList).workspaces);
  }
  const client = await deps.activate(workspace.id);
  deps.remember(workspace.id);
  return { id: workspace.id, client };
}
