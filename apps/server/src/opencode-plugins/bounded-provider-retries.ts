import { resolveWorkspaceId, serverToken, serverUrl } from "./office-plugin-shared.js";

/** Runs in the engine even when the chat is not visible. The server rechecks
 * current status before stopping, so a late event cannot cancel a new turn. */
export function boundedProviderRetries(directory?: string) {
  const pending = new Set<string>();
  return async ({ event }: { event: { type: string; properties?: unknown } }) => {
    if (event.type !== "session.status" || !event.properties || typeof event.properties !== "object") return;
    const sessionId = Reflect.get(event.properties, "sessionID");
    const status: unknown = Reflect.get(event.properties, "status");
    if (typeof sessionId !== "string" || !status || typeof status !== "object" || !("type" in status) || status.type !== "retry" || pending.has(sessionId)) return;
    pending.add(sessionId);
    try {
      const workspaceId = await resolveWorkspaceId({ directory }, { requireDirectory: true });
      await fetch(`${serverUrl()}/workspace/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/retry-stop`, {
        method: "POST", headers: { Authorization: `Bearer ${serverToken()}` }, signal: AbortSignal.timeout(10000),
      });
    } catch { /* A later retry event can retry the bounded stop. */ }
    finally { pending.delete(sessionId); }
  };
}
