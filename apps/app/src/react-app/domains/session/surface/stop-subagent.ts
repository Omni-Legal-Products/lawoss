import type { SessionQueue } from "@legalwork/types/session-queue";
import type { Client } from "@/app/types";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { abortSessionSafe } from "@/app/lib/opencode-session";
import { t } from "@/i18n";
import { getReactQueryClient } from "../../../infra/query-client";
import { useSessionActivityStore } from "../status/session-activity-store";
import { permissionKey, questionKey } from "../sync/interaction-state";
import { snapshotKey, statusKey } from "../sync/session-sync";
import { useComposerStateStore } from "./composer-state-store";

/** Stop in the child's workspace without opening its chat or restarting its queue. */
export async function stopSubagentRun({ client, serverClient, workspaceId, sessionId, workspaceRoot }: {
  client: Client;
  serverClient: Pick<LegalworkServerClient, "baseUrl" | "updateSessionMessageQueue">;
  workspaceId: string;
  sessionId: string;
  workspaceRoot: string;
}) {
  const queryClient = getReactQueryClient();
  const queueKey = ["session-message-queue", serverClient.baseUrl, workspaceId, sessionId];
  const queue = await serverClient.updateSessionMessageQueue(workspaceId, sessionId, { type: "pause", paused: true, reason: "stop" });
  queryClient.setQueryData<SessionQueue>(queueKey, previous => !previous || queue.revision >= previous.revision ? queue : previous);
  useComposerStateStore.getState().setQueuePaused(sessionId, true);
  if (!await abortSessionSafe(client, sessionId, workspaceRoot.trim() || undefined)) {
    throw new Error(t("session.stop_failed"));
  }
  const activity = useSessionActivityStore.getState();
  activity.clearError(workspaceId, sessionId);
  activity.setRunStatus(workspaceId, sessionId, { type: "idle" });
  queryClient.setQueryData(statusKey(workspaceId, sessionId), { type: "idle" });
  queryClient.setQueryData(permissionKey(workspaceId, sessionId), []);
  queryClient.setQueryData(questionKey(workspaceId, sessionId), []);
  void queryClient.invalidateQueries({ queryKey: snapshotKey(workspaceId, sessionId) });
}
