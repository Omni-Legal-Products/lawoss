/**
 * Chýbajúci priečinok pracovného priestoru (MČ 19. 10. 2026): server odpovie 404
 * `project_folder_unavailable`. Stránky LAWOSS namiesto „Vaše veci sa nepodarilo načítať“ povedia,
 * ktorý priečinok chýba, a ponúknu iný priečinok alebo prepnutie na iný zaregistrovaný.
 */
import { normalizeDirectoryPath } from "@/app/utils";
import { isFolderUnavailable, type OkfReadResult } from "./read-model";

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

/**
 * Kam sa dá prepnúť: iné lokálne priestory mimo chýbajúceho priečinka, len najvzdialenejšie
 * (klient vnútri kancelárie sa neponúka zvlášť, ako `officeOf`).
 */
export function missingFolderAlternatives<W extends FolderWorkspace>(workspaces: readonly W[], missing: W): W[] {
  const local = workspaces.filter(workspace => workspace.id !== missing.id && workspace.workspaceType !== "remote" && workspace.path && !inside(missing.path, workspace.path));
  return local.filter(workspace => !local.some(other => other.id !== workspace.id && inside(other.path, workspace.path)));
}
