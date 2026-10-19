import { useEffect, useRef } from "react";

import { LegalworkServerError } from "@/app/lib/legalwork-server";
import { PROJECT_FOLDER_RECONNECTED_EVENT } from "@/react-app/domains/workspace/project-folder-recovery";
import { SessionGroupSyncController } from "./session-group-sync-controller";
import type { LegalworkSessionGroupState } from "@/app/lib/legalwork-server";
import type { ResolvedWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import {
  applySessionGroupServerState,
  beginSessionGroupServerSync,
  setSessionGroupSyncHandler,
  useSessionManagementStore,
  type SessionGroupDefinition,
  type SessionGroupServerState,
  type WorkspaceGroupState,
} from "@/react-app/domains/session/sidebar/session-management-store";
import type { RouteWorkspace } from "./route-workspaces";

const MIGRATION_PREFIX = "legalwork.sessionGroups.migrated.v2";

type UseSessionGroupSyncInput = {
  workspaces: RouteWorkspace[];
  endpointForWorkspace: (workspace: RouteWorkspace | null | undefined) => ResolvedWorkspaceEndpoint | null;
};

function hasGroupData(state: SessionGroupServerState | WorkspaceGroupState | undefined): boolean {
  return Boolean(state && (state.groups.length > 0 || Object.keys(state.assignments).length > 0));
}

function serverStateFromWorkspaceState(state: WorkspaceGroupState): LegalworkSessionGroupState {
  return {
    groups: state.groups.map((group) => ({ id: group.id, label: group.label })),
    assignments: { ...state.assignments },
  };
}

function localGroupStateForWorkspace(
  workspace: RouteWorkspace,
  endpoint: ResolvedWorkspaceEndpoint,
): WorkspaceGroupState | undefined {
  const byWorkspace = useSessionManagementStore.getState().groupsByWorkspace;
  const ids = [workspace.id, endpoint.workspaceId, `rem_${endpoint.workspaceId}`];
  for (const id of ids) {
    const state = byWorkspace[id];
    if (hasGroupData(state)) return state;
  }
  return undefined;
}

function migrationKey(endpoint: ResolvedWorkspaceEndpoint): string {
  return `${MIGRATION_PREFIX}:${endpoint.baseUrl}:${endpoint.workspaceId}`;
}

function readMigrationComplete(endpoint: ResolvedWorkspaceEndpoint): boolean {
  try {
    return window.localStorage.getItem(migrationKey(endpoint)) === "1";
  } catch {
    return false;
  }
}

function writeMigrationComplete(endpoint: ResolvedWorkspaceEndpoint): void {
  try {
    window.localStorage.setItem(migrationKey(endpoint), "1");
  } catch {
    // ignore storage failures; the next launch can retry safely.
  }
}

export function useSessionGroupSync(input: UseSessionGroupSyncInput): void {
  const { workspaces, endpointForWorkspace } = input;
  const workspacesRef = useRef(workspaces);
  const endpointForWorkspaceRef = useRef(endpointForWorkspace);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    workspacesRef.current = workspaces;
    refreshRef.current();
  }, [workspaces]);

  useEffect(() => {
    endpointForWorkspaceRef.current = endpointForWorkspace;
    refreshRef.current();
  }, [endpointForWorkspace]);

  useEffect(() => {
    setSessionGroupSyncHandler({
      createGroup: async (workspaceId: string, group: SessionGroupDefinition) => {
        const workspace = workspacesRef.current.find((item) => item.id === workspaceId);
        const endpoint = endpointForWorkspaceRef.current(workspace);
        if (!endpoint) return null;
        const response = await endpoint.client.createSessionGroup(endpoint.workspaceId, group);
        writeMigrationComplete(endpoint);
        return response.state;
      },
      assignGroup: async (workspaceId: string, sessionId: string, groupId: string | null) => {
        const workspace = workspacesRef.current.find((item) => item.id === workspaceId);
        const endpoint = endpointForWorkspaceRef.current(workspace);
        if (!endpoint) return null;
        const response = await endpoint.client.assignSessionGroup(endpoint.workspaceId, sessionId, groupId);
        writeMigrationComplete(endpoint);
        return response.state;
      },
      reorderGroups: async (workspaceId: string, groupIds: string[]) => {
        const workspace = workspacesRef.current.find((item) => item.id === workspaceId);
        const endpoint = endpointForWorkspaceRef.current(workspace);
        if (!endpoint) return null;
        const response = await endpoint.client.reorderSessionGroups(endpoint.workspaceId, groupIds);
        writeMigrationComplete(endpoint);
        return response.state;
      },
      removeGroup: async (workspaceId: string, groupId: string) => {
        const workspace = workspacesRef.current.find((item) => item.id === workspaceId);
        const endpoint = endpointForWorkspaceRef.current(workspace);
        if (!endpoint) return null;
        const response = await endpoint.client.removeSessionGroup(endpoint.workspaceId, groupId);
        writeMigrationComplete(endpoint);
        return response.state;
      },
    });
    return () => setSessionGroupSyncHandler(null);
  }, []);

  useEffect(() => {
    type SyncTarget = { key: string; workspace: RouteWorkspace; endpoint: ResolvedWorkspaceEndpoint };
    const controller = new SessionGroupSyncController<SyncTarget>({
      targets: () => workspacesRef.current.flatMap(workspace => {
        const endpoint = endpointForWorkspaceRef.current(workspace);
        if (!endpoint) return [];
        // Root and capability changes start a new generation; label-only
        // metadata changes retain backoff and initialization. This key stays local.
        const key = JSON.stringify([workspace.id, workspace.path, endpoint.baseUrl, endpoint.workspaceId, endpoint.token, endpoint.hostToken]);
        return [{ key, workspace, endpoint }];
      }),
      sync: async ({ workspace, endpoint }, migrateLocal, isCurrent) => {
        const version = beginSessionGroupServerSync(workspace.id);
        const response = await endpoint.client.getSessionGroups(endpoint.workspaceId);
        if (!isCurrent()) return;
        let nextState = response.state;
        const localState = localGroupStateForWorkspace(workspace, endpoint);
        if (migrateLocal && !readMigrationComplete(endpoint) && !hasGroupData(response.state) && localState !== undefined) {
          const migrated = await endpoint.client.putSessionGroups(endpoint.workspaceId, serverStateFromWorkspaceState(localState));
          if (!isCurrent()) return;
          nextState = migrated.state;
        }
        writeMigrationComplete(endpoint);
        applySessionGroupServerState(workspace.id, nextState, version);
      },
      events: ({ endpoint }, since) => endpoint.client.listSessionGroupEvents(endpoint.workspaceId, since === undefined ? undefined : { since }),
      isUnavailable: error => error instanceof LegalworkServerError && error.code === "project_folder_unavailable",
      onError: (_target, error) => { console.warn("[session-groups] synchronization paused or backing off", error); },
    });
    const refresh = () => { void controller.refresh(); };
    const reconnect = () => { void controller.reconnect(); };
    refreshRef.current = refresh;
    refresh();
    window.addEventListener(PROJECT_FOLDER_RECONNECTED_EVENT, reconnect);
    const interval = window.setInterval(refresh, 3000);
    return () => {
      refreshRef.current = () => {};
      controller.dispose();
      window.removeEventListener(PROJECT_FOLDER_RECONNECTED_EVENT, reconnect);
      window.clearInterval(interval);
    };
  }, []);
}
