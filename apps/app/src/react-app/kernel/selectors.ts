import type { LegalworkStore } from "./store";

export const selectActiveWorkspace = (state: LegalworkStore) =>
  state.workspaces.find(
    (workspace) => workspace.id === state.activeWorkspaceId,
  ) ?? null;

export const selectServerStatus = (state: LegalworkStore) => state.server.status;

export const selectServerUrl = (state: LegalworkStore) => state.server.url;

export const selectErrorBanner = (state: LegalworkStore) => state.errorBanner;
