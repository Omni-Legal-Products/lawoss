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
 * starts on Settings. The chat URL's workspace is only asked first; ownership is still verified. */
export async function resolveDocumentProject(sessionId: string): Promise<DocumentProject> {
  const connection = await resolveLegalworkConnection();
  const client = createLegalworkServerClient({ baseUrl: connection.normalizedBaseUrl, token: connection.resolvedToken, hostToken: connection.resolvedHostToken });
  const workspaces = isDesktopRuntime() && connection.source === "desktop-runtime" ? (await workspaceBootstrap()).workspaces ?? [] : (await client.listWorkspaces()).items;
  return findDocumentProject(sessionId, workspaces, workspace => resolveWorkspaceEndpoint(workspace, { baseUrl: connection.normalizedBaseUrl, token: connection.resolvedToken }), routeWorkspaceId(sessionId));
}

/** 🟡 LAWOSS #480: `#/workspace/<ws>/session/<ses>` names the chat's workspace; asking every client
 * first cost one 404 per client on each chat open. */
function routeWorkspaceId(sessionId: string): string | undefined {
  const hash = typeof window === "undefined" ? "" : window.location?.hash ?? "";
  const match = /^#\/workspace\/([^/?#]+)\/session\/([^/?#]+)/.exec(hash);
  return match && decodeURIComponent(match[2]!) === sessionId ? decodeURIComponent(match[1]!) : undefined;
}

/** LAWOSS: a case chat runs in the case subfolder of its client (session-directory.ts), so the
 * session's folder may lie below the client root instead of matching it exactly. */
export async function findDocumentProject<W extends ProjectWorkspace>(sessionId: string, workspaces: readonly W[], endpointFor: (workspace: W) => ProjectEndpoint | null, preferredId?: string): Promise<DocumentProject> {
  const candidates = workspaces.flatMap(workspace => {
    const endpoint = endpointFor(workspace);
    return endpoint ? [{ workspace, endpoint }] : [];
  });
  type Candidate = (typeof candidates)[number];
  const lookup = async ({ workspace, endpoint }: Candidate) => {
    const { item } = await endpoint.client.getSession(endpoint.workspaceId, sessionId);
    if (!endpoint.isRemote && !isWithinClientFolder(workspace.path || "", item.directory)) throw new Error("Different project");
    return { directory: item.directory, project: { projectId: workspace.id, workspaceId: endpoint.workspaceId, workspaceRoot: workspace.path || "", client: endpoint.client, isRemoteWorkspace: endpoint.isRemote } };
  };
  const inside = (outer: string, inner: string) => Boolean(outer) && Boolean(inner) && isWithinClientFolder(outer, inner);
  // 🟡 LAWOSS #480: when the URL's workspace holds the chat, only local workspaces nested in it that
  // also contain the chat's folder can own it more closely (#223); the other clients are not asked.
  const preferred = candidates.find(candidate => candidate.workspace.id === preferredId);
  const preferredLookup = preferred ? lookup(preferred) : null;
  const first = preferredLookup ? await preferredLookup.catch(() => null) : null;
  const asked = first ? [preferred!, ...candidates.filter(candidate => candidate !== preferred && !candidate.endpoint.isRemote
    && inside(first.project.workspaceRoot, candidate.workspace.path || "") && isWithinClientFolder(candidate.workspace.path || "", first.directory))] : candidates;
  // LAWOSS: with a nested registered folder (a practice root around its clients) several workspaces
  // can own the chat; the innermost one is its client, not whichever answers first (#223). A local
  // workspace inside the chosen one that holds the chat but failed to answer is never replaced by
  // the broader scope: the task stays unavailable instead.
  const settled = await Promise.allSettled(asked.map(candidate => candidate === preferred ? preferredLookup! : lookup(candidate)));
  const found = settled.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
  const chosen = found.reduce<(typeof found)[number] | undefined>((best, next) => !best || inside(best.project.workspaceRoot, next.project.workspaceRoot) ? next : best, undefined);
  const deeperFailed = chosen && asked.some(({ workspace, endpoint }, index) => settled[index]!.status === "rejected" && !endpoint.isRemote
    && inside(chosen.project.workspaceRoot, workspace.path || "") && isWithinClientFolder(workspace.path || "", chosen.directory));
  if (!chosen || deeperFailed) throw new Error("The task's project is unavailable. Its data could not be loaded from the project server.");
  return chosen.project;
}
