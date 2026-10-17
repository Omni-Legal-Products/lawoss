import { z } from "zod";
import { ApiError } from "../errors.js";

export type NangoAuthSession = { sessionToken: string; integrationId: string; expiresAt: number };
const messageSchema = z.discriminatedUnion("message_type", [
  z.object({ message_type: z.literal("connection_ack"), ws_client_id: z.string().min(1) }),
  z.object({ message_type: z.literal("success"), provider_config_key: z.string(), connection_id: z.string().min(1).max(500), is_pending: z.boolean().optional() }),
  z.object({ message_type: z.literal("error") }),
]);

// Same auth-result transport as Nango's Frontend SDK, running locally so the
// connection ID is learned without a webhook, backend database or account list.
export async function createNangoAuthFlow(session: NangoAuthSession, createSocket = (url: string) => new WebSocket(url)) {
  const socket = createSocket("wss://api.nango.dev/");
  let connectionId: string | null = null;
  let failed = false;
  let cancelled = false;
  let acknowledged = false;
  const failure = () => new ApiError(502, "connector_auth_failed", "The account sign-in could not complete. Try connecting again.");
  let resolveUrl: (url: string) => void = () => {};
  let rejectUrl: (error: ApiError) => void = () => {};
  const urlPromise = new Promise<string>((resolve, reject) => { resolveUrl = resolve; rejectUrl = reject; });
  const ackTimer = setTimeout(() => { failed = true; rejectUrl(failure()); socket.close(); }, 10_000);
  const expiryTimer = setTimeout(() => socket.close(), Math.max(1, session.expiresAt - Date.now()));
  expiryTimer.unref?.();
  function close() { clearTimeout(ackTimer); clearTimeout(expiryTimer); socket.close(); }
  socket.addEventListener("message", (event) => {
    if (cancelled || failed || connectionId) return;
    let message: z.infer<typeof messageSchema>;
    try { message = messageSchema.parse(JSON.parse(String(event.data))); }
    catch { failed = true; rejectUrl(failure()); close(); return; }
    if (message.message_type === "connection_ack" && !acknowledged) {
      acknowledged = true;
      clearTimeout(ackTimer);
      const url = new URL(`/oauth/connect/${encodeURIComponent(session.integrationId)}`, "https://api.nango.dev");
      url.searchParams.set("connect_session_token", session.sessionToken);
      url.searchParams.set("ws_client_id", message.ws_client_id);
      resolveUrl(url.toString());
    } else if (message.message_type === "success" && acknowledged && message.provider_config_key === session.integrationId && !message.is_pending) {
      connectionId = message.connection_id;
      close();
    } else {
      failed = true; rejectUrl(failure()); close();
    }
  });
  socket.addEventListener("error", () => { failed = true; rejectUrl(failure()); close(); });
  socket.addEventListener("close", () => {
    clearTimeout(ackTimer); clearTimeout(expiryTimer);
    if (!connectionId && !cancelled) { failed = true; rejectUrl(failure()); }
  });
  return {
    connectUrl: await urlPromise,
    connectionId: () => { if (failed) throw failure(); return connectionId; },
    cancel: () => { cancelled = true; close(); },
  };
}
