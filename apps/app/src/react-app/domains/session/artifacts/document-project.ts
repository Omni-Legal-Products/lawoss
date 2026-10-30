import { workspaceBootstrap } from "@/app/lib/desktop";
import { createLegalworkServerClient } from "@/app/lib/legalwork-server";
import { resolveWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import { isDesktopRuntime } from "@/app/utils";
import { isWithinClientFolder } from "@/lawoss/shell/session-directory";
import { resolveLegalworkConnection } from "../../../shell/legalwork-connection";
import type { DocumentProject } from "./document-runtime-store";

type ProjectWorkspace = { id: string; path?: string | null };
type ProjectEndpoint = Pick<DocumentProject, "client" | "workspaceId"> & { isRemote: boolean };

/** Resolves tasks that are not in the sidebar cache, including when the app
 * starts on Settings. No route, tab, or selected-project state is consulted. */
export async function resolveDocumentProject(sessionId: string): Promise<DocumentProject> {
  const connection = await resolveLegalworkConnection();
  const client = createLegalworkServerClient({ baseUrl: connection.normalizedBaseUrl, token: connection.resolvedToken, hostToken: connection.resolvedHostToken });
  const list = isDesktopRuntime() ? await workspaceBootstrap() : await client.listWorkspaces();
  return findDocumentProject(sessionId, list.workspaces ?? [], workspace => resolveWorkspaceEndpoint(workspace, { baseUrl: connection.normalizedBaseUrl, token: connection.resolvedToken }));
}

/** LAWOSS: a case chat runs in the case subfolder of its client (session-directory.ts), so the
 * session's folder may lie below the client root instead of matching it exactly. */
export async function findDocumentProject<W extends ProjectWorkspace>(sessionId: string, workspaces: readonly W[], endpointFor: (workspace: W) => ProjectEndpoint | null): Promise<DocumentProject> {
  const candidates = workspaces.flatMap(workspace => {
    const endpoint = endpointFor(workspace);
    if (!endpoint) return [];
    return [{ workspace, endpoint, lookup: (async () => {
      const { item } = await endpoint.client.getSession(endpoint.workspaceId, sessionId);
      if (!endpoint.isRemote && !isWithinClientFolder(workspace.path || "", item.directory)) throw new Error("Different project");
      return { directory: item.directory, project: { projectId: workspace.id, workspaceId: endpoint.workspaceId, workspaceRoot: workspace.path || "", client: endpoint.client, isRemoteWorkspace: endpoint.isRemote } };
    })() }];
  });
  // LAWOSS: with a nested registered folder (a practice root around its clients) several workspaces
  // can own the chat; the innermost one is its client, not whichever answers first (#223). A local
  // workspace inside the chosen one that holds the chat but failed to answer is never replaced by
  // the broader scope: the task stays unavailable instead.
  const settled = await Promise.allSettled(candidates.map(candidate => candidate.lookup));
  const found = settled.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  const inside = (outer: string, inner: string) => Boolean(outer) && Boolean(inner) && isWithinClientFolder(outer, inner);
  const chosen = found.reduce<(typeof found)[number] | undefined>((best, next) => !best || inside(best.project.workspaceRoot, next.project.workspaceRoot) ? next : best, undefined);
  const deeperFailed = chosen && candidates.some(({ workspace, endpoint }, index) => settled[index]!.status === "rejected" && !endpoint.isRemote
    && inside(chosen.project.workspaceRoot, workspace.path || "") && isWithinClientFolder(workspace.path || "", chosen.directory));
  if (!chosen || deeperFailed) throw new Error("The task's project is unavailable. Its data could not be loaded from the project server.");
  return chosen.project;
}
