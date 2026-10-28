/**
 * Chýbajúci priečinok pracovného priestoru (MČ 19. 10. 2026): server odpovie 404
 * `project_folder_unavailable`. Stránky LAWOSS namiesto „Vaše veci sa nepodarilo načítať“ povedia,
 * ktorý priečinok chýba, a ponúknu iný priečinok alebo prepnutie na iný zaregistrovaný.
 */
import { normalizeDirectoryPath } from "@/app/utils";
import { isFolderUnavailable, OFFICE_SCOPE_RESTORED, type OkfReadResult } from "./read-model";

type FolderWorkspace = { id: string; path: string; workspaceType?: string };

/** Priestor, ktorému chýba priečinok: z problémov čítania, inak z chyby dotazu (vtedy kotviaci priestor). */
export function unavailableWorkspace<W extends FolderWorkspace>(workspaces: readonly W[], data: OkfReadResult | undefined, error: unknown, anchor: W | null): W | null {
  const id = data?.problems.find(problem => problem.folderUnavailable)?.folderUnavailable;
  if (id) return workspaces.find(workspace => workspace.id === id) ?? null;
  return isFolderUnavailable(error) ? anchor : null;
}

const inside = (outer: string, inner: string): boolean => {
  const prefix = normalizeDirectoryPath(outer);
  return normalizeDirectoryPath(inner).startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`);
};

/** Všetky priestory, ktorým pri čítaní chýbal priečinok (napr. všetci klienti presunutej praxe). */
export function unavailableWorkspaceIds(data: OkfReadResult | undefined): Set<string> {
  return new Set((data?.problems ?? []).flatMap(problem => problem.folderUnavailable ? [problem.folderUnavailable] : []));
}

/**
 * Kam sa dá prepnúť: iné lokálne priestory mimo chýbajúceho priečinka, len najvzdialenejšie
 * (klient vnútri kancelárie sa neponúka zvlášť, ako `officeOf`). Aktívny priestor nie (už je otvorený)
 * a ani priestor, ktorému tiež chýba priečinok (N-A7-1: prepnutie naň by nič neurobilo).
 */
export function missingFolderAlternatives<W extends FolderWorkspace>(workspaces: readonly W[], missing: W, activeId?: string, unavailable: ReadonlySet<string> = new Set()): W[] {
  const local = workspaces.filter(workspace => workspace.id !== missing.id && !unavailable.has(workspace.id) && workspace.workspaceType !== "remote" && workspace.path && !inside(missing.path, workspace.path));
  return local.filter(workspace => workspace.id !== activeId && !local.some(other => other.id !== workspace.id && inside(other.path, workspace.path)));
}

/** Prepne na iný priečinok a stránky načíta znova; zlyhanie zapíše do konzoly a vráti `false`. */
export async function switchToWorkspace<W extends FolderWorkspace>(activate: (target: W) => Promise<unknown>, target: W, events: EventTarget = window): Promise<boolean> {
  try {
    await activate(target);
  } catch (failure) {
    console.warn("LAWOSS: prepnutie na iný priečinok", failure);
    return false;
  }
  events.dispatchEvent(new CustomEvent(OFFICE_SCOPE_RESTORED));
  return true;
}
