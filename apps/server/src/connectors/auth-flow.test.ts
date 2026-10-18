import { expect, test } from "bun:test";
import { createNangoAuthFlow } from "./auth-flow.js";

async function transport(message: Record<string, unknown>) {
  const server = Bun.serve({
    port: 0,
    fetch(request, server) { return server.upgrade(request) ? undefined : new Response(null, { status: 400 }); },
    websocket: { open(socket) {
      socket.send(JSON.stringify({ message_type: "connection_ack", ws_client_id: "scoped-socket" }));
      socket.send(JSON.stringify(message));
    }, message() {} },
  });
  try {
    const flow = await createNangoAuthFlow({ sessionToken: "session-capability", integrationId: "google-mail", expiresAt: Date.now() + 30_000 },
      (url) => { expect(url).toBe("wss://api.nango.dev/"); return new WebSocket(`ws://127.0.0.1:${server.port}`); });
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    return flow;
  } finally { server.stop(true); }
}

test("learns the random connection ID through the SDK auth result without listing", async () => {
  const flow = await transport({ message_type: "success", provider_config_key: "google-mail", connection_id: "random-nango-capability" });
  const url = new URL(flow.connectUrl);
  expect(url.origin).toBe("https://api.nango.dev");
  expect(url.pathname).toBe("/oauth/connect/google-mail");
  expect(url.searchParams.get("connect_session_token")).toBe("session-capability");
  expect(url.searchParams.get("ws_client_id")).toBe("scoped-socket");
  expect(url.searchParams.has("connection_id")).toBe(false);
  expect(flow.connectionId()).toBe("random-nango-capability");
  flow.cancel();
});

test("rejects an auth result for a different integration", async () => {
  const flow = await transport({ message_type: "success", provider_config_key: "outlook", connection_id: "other-provider" });
  expect(() => flow.connectionId()).toThrow("The account sign-in could not complete.");
});

test("does not reflect Nango errors or unvalidated connection data", async () => {
  const flow = await transport({ message_type: "error", error_desc: "private token" });
  expect(() => flow.connectionId()).toThrow("The account sign-in could not complete.");
  try { flow.connectionId(); } catch (error) { expect(String(error)).not.toContain("private token"); }
});
