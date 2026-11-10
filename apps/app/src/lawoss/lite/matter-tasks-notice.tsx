/**
 * Prehliadka alfy 10. 11. 2026: stránka Úlohy klienta hlásila „Žiadne úlohy“, kým Prehľad toho istého klienta
 * ukazoval otvorené úlohy z prípadov. Sú to dva zdroje: úlohy aplikácie (natívny zoznam) a úlohy zapísané
 * v prípadoch (OKF). Zoznam sa nemení; poznámka nad ním povie, koľko úloh je v prípadoch, a odkáže na Prehľad.
 */
import { Link } from "react-router-dom";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { today } from "../okf/read-model";
import { clientDeadlines, overviewOwners, ownerOfFolder } from "./client-projects";
import { usePublishedClientNav, type PublishedClientNav } from "./client-nav";

/** Počet otvorených úloh v prípadoch klienta, rovnako ako dlaždica „Otvorené úlohy z prípadov“ na Prehľade. */
export function matterTaskCount(nav: PublishedClientNav | null, workspaceId: string, todayIso: string): number {
  if (!nav?.scope || !nav.data || !nav.model.clients.has(workspaceId) || nav.excludedWorkspaceIds.includes(workspaceId)) return 0;
  const owners = overviewOwners(nav.model, nav.connection?.workspaces ?? [], nav.scope, nav.groups);
  const own = clientDeadlines(nav.data, nav.scope, (folder) => ownerOfFolder(owners, folder) === workspaceId, todayIso);
  return new Set(own.matters.flatMap((m) => m.openTasks.map((task) => task.file ?? `${m.path}\u0000${task.id}`))).size;
}

export function MatterTasksNotice({ projectId }: { projectId?: string }) {
  const nav = usePublishedClientNav();
  const locale = useLocale();
  const count = projectId ? matterTaskCount(nav, projectId, today()) : 0;
  if (!projectId || count === 0) return null;
  return (
    <p role="note" data-lawoss-matter-tasks={count} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
      <span>{t("lawoss.lite.tasks_in_matters", locale, { count })}</span>
      <Link className="font-medium text-foreground underline-offset-2 hover:underline" to={`/workspace/${encodeURIComponent(projectId)}/project`}>{t("lawoss.lite.tasks_in_matters_open", locale)}</Link>
    </p>
  );
}
