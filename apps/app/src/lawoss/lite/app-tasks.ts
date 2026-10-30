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

type TaskPageParams = { statuses: ["open", "in_progress"]; sort: "due"; order: "asc"; limit: number; projectId?: string; cursor?: string };
type ListTasks<T> = (workspaceId: string, params: TaskPageParams) => Promise<{ tasks: T[]; nextCursor: string | null }>;
export type OpenTasks<T = AppTask> = { tasks: readonly T[]; complete: boolean };

/** Strop stránok po 200 (5 000 úloh): nad ním sa zoznam hlási ako neúplný. */
const TASK_PAGES = 25;

/**
 * #271: úlohy sú celostrojové a server vráti najviac 200 na stránku, zoradené podľa termínu. Bez `projectId` by
 * filter praxe či klienta dostal len prvých 200 úloh celého stroja: stránky sa dočítajú a Domov klienta nechá
 * filtrovať server. `complete: false`, keď strop stránok nestačil.
 */
export async function readOpenTasks<T>(list: ListTasks<T>, workspaceId: string, projectId?: string): Promise<OpenTasks<T>> {
  const tasks: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < TASK_PAGES; page++) {
    const result = await list(workspaceId, { statuses: ["open", "in_progress"], sort: "due", order: "asc", limit: 200, ...(projectId ? { projectId } : {}), ...(cursor ? { cursor } : {}) });
    tasks.push(...result.tasks);
    if (!result.nextCursor) return { tasks, complete: true };
    cursor = result.nextCursor;
  }
  return { tasks, complete: false };
}

/**
 * Otvorené úlohy aplikácie zoradené podľa termínu; `projectId` len úlohy jedného klienta (Domov klienta).
 * Nedostupný zoznam prehľad nezastaví, ale úplný je len po úspešnom aktuálnom čítaní (načítava sa, chyba, aj pri
 * starších údajoch z cache, je `complete: false`).
 */
export function useAppTasks(connection: Pick<OkfConnection, "client" | "activeWorkspaceId"> | null, projectId?: string): OpenTasks {
  const workspaceId = connection?.activeWorkspaceId ?? "";
  const client = connection?.client;
  const query = useQuery({
    queryKey: ["tasks", workspaceId, { lawossToday: true, projectId: projectId ?? null }],
    enabled: Boolean(client && workspaceId),
    retry: false,
    queryFn: async (): Promise<OpenTasks> => client ? readOpenTasks(client.listTasks, workspaceId, projectId) : currentTasks(undefined, false),
  });
  return currentTasks(query.data, query.isError);
}

/** Úplný je len výsledok posledného úspešného čítania; cache po chybe nesie úlohy, nie úplnosť. */
export function currentTasks<T>(data: OpenTasks<T> | undefined, failed: boolean): OpenTasks<T> {
  if (!data) return { tasks: [], complete: false };
  return failed ? { tasks: data.tasks, complete: false } : data;
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
