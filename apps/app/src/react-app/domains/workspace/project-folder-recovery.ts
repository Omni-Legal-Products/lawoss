export const PROJECT_FOLDER_RECONNECTED_EVENT = "legalwork:projectFolderReconnected";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";

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
  await input.client.activateWorkspace(input.workspaceId, { persist: true });
  await input.refresh();
  return true;
}
