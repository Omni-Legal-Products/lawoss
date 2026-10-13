export const PROJECT_FOLDER_RECONNECTED_EVENT = "legalwork:projectFolderReconnected";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";

/** Reconnect has committed; a failed engine activation must not imply rollback. */
export class ProjectFolderActivationError extends Error {
  readonly recoveryCommitted = true;
  constructor(cause: unknown) {
    super("Project folder reconnected but activation failed", { cause });
    this.name = "ProjectFolderActivationError";
  }
}

/** Cancellation leaves the registered project and selection untouched. */
export async function recoverProjectFolder(input: {
  client: Pick<LegalworkServerClient, "reconnectWorkspace" | "activateWorkspace">;
  workspaceId: string;
  expectedPath: string;
  pick: () => Promise<string | null>;
  refresh: () => Promise<void>;
}): Promise<boolean> {
  const folderPath = await input.pick();
  if (!folderPath) return false;
  await input.client.reconnectWorkspace(input.workspaceId, { folderPath, expectedPath: input.expectedPath });
  try { await input.client.activateWorkspace(input.workspaceId, { persist: true }); }
  catch (error) { throw new ProjectFolderActivationError(error); }
  finally { await input.refresh(); }
  return true;
}
