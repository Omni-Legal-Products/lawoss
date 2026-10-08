/**
 * Interný domovský priestor (spec 2026-10-08, P8): prázdny priečinok `lawoss-domov` v dátach appky,
 * ktorý desktop zaregistruje, keď nie je žiadny priečinok (apps/desktop/electron/lawoss-home-workspace.mjs).
 * Používateľ ho nikde nevidí a skutočný priečinok má vždy prednosť.
 */
export const LAWOSS_HOME_DIR_NAME = "lawoss-domov";

type WithPath = { path?: string | null };

export function isLawossHomeWorkspace(workspace: WithPath): boolean {
  const path = workspace.path?.trim();
  if (!path) return false;
  return path.split(/[\\/]+/).filter(Boolean).at(-1) === LAWOSS_HOME_DIR_NAME;
}

export function withoutLawossHome<T extends WithPath>(list: readonly T[]): T[] {
  return list.filter(item => !isLawossHomeWorkspace(item));
}

/** Aktívny skutočný priečinok, inak prvý skutočný lokálny, inak domovský; vzdialený sa tu nevyberá. */
export function preferRealWorkspace<T extends WithPath & { workspaceType?: string }>(list: readonly T[], activeId?: string | null, idOf: (item: T) => string = () => ""): T | undefined {
  const local = list.filter(item => item.workspaceType !== "remote");
  const real = withoutLawossHome(local);
  return real.find(item => activeId && idOf(item) === activeId) ?? real[0] ?? local.find(isLawossHomeWorkspace);
}
