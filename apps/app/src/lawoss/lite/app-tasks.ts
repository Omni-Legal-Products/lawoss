/**
 * N-A5-4 (test 25. 10. 2026): úlohy aplikácie („Nová úloha“, natívny panel Úlohy) na Dnes a na Domove klienta.
 * Zoznam sa číta zo servera pod kľúčom „tasks“, takže ho panel Úlohy po každej zmene obnoví; nedostupný zoznam
 * prehľad nezastaví. Na Dnes patria len úlohy klientov praxe (projekt v rozsahu) a úlohy bez projektu, nie úlohy
 * nesúvisiacich priečinkov (AGENTS.md, Selected-practice overview invariants).
 */
import { useQuery } from "@tanstack/react-query";
import { requestTasksPane } from "@/react-app/domains/tasks/tasks-pane-request";
import type { OkfConnection } from "../okf/connection";
import type { OkfClient, OkfScope } from "../okf/read-model";
import { overviewFolder } from "./client-projects";
import { comparable, within } from "./matter-conversations";
import type { AppTask } from "./today-model";

type Workspace = { id: string; path: string; name?: string; displayNameResolved?: string };

/** Otvorené úlohy aplikácie (server vráti najviac 200, zoradené podľa termínu). */
export function useAppTasks(connection: Pick<OkfConnection, "client" | "activeWorkspaceId"> | null): readonly AppTask[] {
  const workspaceId = connection?.activeWorkspaceId ?? "";
  const query = useQuery({
    queryKey: ["tasks", workspaceId, { lawossToday: true }],
    enabled: Boolean(connection?.client && workspaceId),
    retry: false,
    queryFn: async () => (await connection?.client?.listTasks(workspaceId, { statuses: ["open", "in_progress"], sort: "due", order: "asc", limit: 200 }))?.tasks ?? [],
  });
  return query.data ?? [];
}

/** Úloha patrí do praxe: bez projektu, alebo jej projekt leží v niektorom priečinku rozsahu. */
export function inPractice(workspaces: readonly Workspace[], scope: Pick<OkfScope, "members">): (task: Pick<AppTask, "projectId">) => boolean {
  const members = scope.members.map((member) => comparable(member.workspace.path));
  return (task) => {
    if (!task.projectId) return true;
    const workspace = workspaces.find((w) => w.id === task.projectId);
    return workspace !== undefined && members.some((member) => within(member, comparable(workspace.path)));
  };
}

/** Meno klienta úlohy z karty klienta (client.md), inak meno priečinka. */
export function appTaskClient(workspaces: readonly Workspace[], scope: OkfScope | null, clients: readonly Pick<OkfClient, "path" | "title">[]): (projectId: string) => string | undefined {
  return (projectId) => {
    const workspace = workspaces.find((w) => w.id === projectId);
    if (!workspace) return undefined;
    const card = scope ? clients.find((client) => overviewFolder(scope, client.path) === comparable(workspace.path))?.title : undefined;
    return card || workspace.displayNameResolved || workspace.name || undefined;
  };
}

/** Klik na odkaz úlohy aplikácie: panel Úlohy otvorí túto úlohu (odkaz sám vedie na `/tasks`). */
export const openAppTask = (taskId: string | undefined): (() => void) | undefined => taskId ? () => requestTasksPane(taskId) : undefined;
