/**
 * Prístup k serveru a k workspace-om mimo session-route — rovnaký recept, aký
 * používa settings-route, len bez jej stavu. Nič z toho nie je nové API:
 * skladá existujúce helpery upstreamu.
 */
import { workspaceBootstrap } from "@/app/lib/desktop";
import type { WorkspaceInfo } from "@/app/lib/desktop-types";
import { createLegalworkServerClient, type LegalworkServerClient } from "@/app/lib/legalwork-server";
import { createClient, unwrap } from "@/app/lib/opencode";
import { toSessionTransportDirectory } from "@/app/lib/session-scope";
import { resolveWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import { isDesktopRuntime } from "@/app/utils";
import { saveSessionDraft } from "@/react-app/domains/session/sync/draft-store";
import { resolveLegalworkConnection } from "@/react-app/shell/legalwork-connection";
import { mapDesktopWorkspace, mergeRouteWorkspaces, type RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { readActiveWorkspaceId } from "@/react-app/shell/session-memory";
import { workspaceSessionRoute } from "@/react-app/shell/workspace-routes";

export type OkfConnection = {
  client: LegalworkServerClient | null;
  baseUrl: string;
  token: string;
  workspaces: RouteWorkspace[];
  activeWorkspaceId: string;
};

export async function loadOkfConnection(): Promise<OkfConnection> {
  let desktopWorkspaces: RouteWorkspace[] = [];
  if (isDesktopRuntime()) {
    try {
      const list = (await workspaceBootstrap()) as { workspaces?: WorkspaceInfo[] };
      desktopWorkspaces = (list.workspaces ?? []).map(mapDesktopWorkspace);
    } catch {
      // bridge down — the server list below still works
    }
  }
  const { normalizedBaseUrl, resolvedToken, resolvedHostToken } = await resolveLegalworkConnection();
  if (!normalizedBaseUrl || !resolvedToken) {
    return { client: null, baseUrl: "", token: "", workspaces: desktopWorkspaces, activeWorkspaceId: readActiveWorkspaceId() ?? "" };
  }
  const client = createLegalworkServerClient({
    baseUrl: normalizedBaseUrl,
    token: resolvedToken,
    hostToken: resolvedHostToken || undefined,
  });
  const list = await client.listWorkspaces();
  const workspaces = mergeRouteWorkspaces(list.items, desktopWorkspaces);
  const activeWorkspaceId = readActiveWorkspaceId() ?? list.activeId ?? workspaces[0]?.id ?? "";
  return { client, baseUrl: normalizedBaseUrl, token: resolvedToken, workspaces, activeWorkspaceId };
}

/**
 * Založí session vo workspace, uloží prompt ako draft (presne tak, ako to robí
 * upstream New Task) a vráti cestu, kam navigovať.
 */
export async function openSessionWithPrompt(
  connection: OkfConnection,
  workspace: RouteWorkspace,
  prompt: string,
): Promise<string> {
  const endpoint = resolveWorkspaceEndpoint(workspace, { baseUrl: connection.baseUrl, token: connection.token });
  if (!endpoint) throw new Error("Workspace nie je dostupný — server nebeží alebo chýba token.");
  const opencode = createClient(endpoint.opencodeBaseUrl, workspace.path || undefined, {
    token: endpoint.token,
    mode: "legalwork",
  });
  const directory = toSessionTransportDirectory(workspace.path) || undefined;
  const session = unwrap(await opencode.session.create({ directory }));
  saveSessionDraft(workspace.id, session.id, { text: prompt, mode: "prompt" });
  return workspaceSessionRoute(workspace.id, session.id);
}
