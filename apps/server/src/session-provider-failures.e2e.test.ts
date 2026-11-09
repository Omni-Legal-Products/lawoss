import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import { ensureWikiAgentToken, grantWikiAgentSession } from "./wiki/agent-access.js";
import type { ServerConfig } from "./types.js";
import { syncEventStream } from "./app-sync-events.js";

test("scoped provider witness survives server reload only on its failed terminal assistant", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "provider-witness-")));
  const previous = process.env.LEGALWORK_RUNTIME_DB;
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  let idle = false;
  let finish: string | undefined;
  let newer = false, wrong = false;
  let engine: ReturnType<typeof Bun.serve> | undefined;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
  // LAWOSS v2: fake engine 2.1.4 (`/api/...`); the originating user message precedes its assistant in history.
  const user = (id: string) => ({ id, type: "user", text: "Synthetic request", time: { created: 1 } });
  const assistant = (id = "msg_a", providerID = "openrouter") => ({ id, type: "assistant", agent: "legalwork", model: { providerID, id: "google/gemini-3-flash-preview" },
    time: { created: 2, completed: 3 }, content: [], ...(finish ? { finish } : {}) });
  const history = () => newer ? [user("msg_u"), assistant(), user("msg_user_new"), { ...assistant("msg_new"), finish: "stop" }]
    : wrong ? [user("msg_u"), assistant("msg_wrong", "openai")] : [user("msg_u"), assistant()];
  engine = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/api/session/active") return Response.json({ data: idle ? {} : { ses_1: { type: "running" } } });
    if (url.pathname === "/api/session/ses_1/inbox") return Response.json({ data: [] });
    if (url.pathname === "/api/session/ses_1/message") {
      const type = url.searchParams.get("type");
      const ordered = url.searchParams.get("order") === "desc" ? history().reverse() : history();
      return Response.json({ data: ordered.filter(message => !type || message.type === type), cursor: {} });
    }
    if (url.pathname === "/api/session/ses_1/message/msg_a") return Response.json({ data: assistant() });
    if (url.pathname === "/api/session/ses_1") return Response.json({ data: { id: "ses_1", projectID: "project", location: { directory: root }, title: "Synthetic", time: { created: 1, updated: 3 } } });
    if (url.pathname === "/api/session") return Response.json({ data: [], cursor: {} });
    return Response.json({ code: "not_found", message: "Not found" }, { status: 404 });
  } });
  const config: ServerConfig = { configPath: join(root, "server.json"), host: "127.0.0.1", port: 0, token: "synthetic-client", hostToken: "synthetic-host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: [{ id: "ws_1", name: "Synthetic", path: root, preset: "starter", workspaceType: "local", baseUrl: engine.url.origin }], authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
    server = await startServer(config);
    const serverPort = () => { if (!server) throw new Error("The fixture server has not started."); return server.port; };
    const token = await ensureWikiAgentToken(config);
    await grantWikiAgentSession(config, { sessionId: "ses_1", directory: root, scope: "collaborator" });
    const headers = { "content-type": "application/json", "x-legalwork-wiki-agent-token": token, "x-legalwork-wiki-agent-session": "ses_1", "x-legalwork-wiki-agent-directory": encodeURIComponent(root) };
    const post = (body: unknown, overrideHeaders: Record<string, string> = headers, workspace = "ws_1") => fetch(`http://127.0.0.1:${serverPort()}/workspace/${workspace}/sessions/ses_1/provider-failure`, { method: "POST", headers: overrideHeaders, body: JSON.stringify(body) });
    const witness = { messageId: "msg_a", userMessageId: "msg_u", providerId: "openrouter", modelId: "google/gemini-3-flash-preview", code: "gemini_thought_signature" };
    // LAWOSS v2: snapshot messages are native v2 messages; `messages` here are its assistant turns in order.
    const snapshot = async () => {
      const item = (await (await fetch(`http://127.0.0.1:${serverPort()}/workspace/ws_1/sessions/ses_1/snapshot`, { headers: { Authorization: `Bearer ${config.token}` } })).json()).item;
      return { ...item, messages: item.messages.filter((message: { type: string }) => message.type === "assistant") };
    };
    idle = true;
    expect((await snapshot()).messages[0].error?.message).toContain("incomplete");
    expect((await snapshot()).messages[0].error?.message).not.toContain("signature");
    idle = false;
    const syncStop = new AbortController();
    const syncReader = syncEventStream(config, syncStop.signal).body?.getReader();
    if (!syncReader) throw new Error("Missing app sync stream.");
    await syncReader.read(); // Initial resync precedes the late failure witness.
    const changed = syncReader.read();
    try {
      expect((await post(witness)).status).toBe(200);
      const event = await Promise.race([changed, Bun.sleep(500).then(() => null)]);
      expect(event && !event.done ? new TextDecoder().decode(event.value) : "").toContain('"sessions":true');
    } finally { syncStop.abort(); await changed; }
    expect((await snapshot()).messages[0].error).toBeUndefined();
    idle = true;
    expect((await snapshot()).messages[0].error?.message).toContain("thought signature");
    finish = "stop";
    expect((await snapshot()).messages[0].error).toBeUndefined();
    finish = "tool-calls";
    expect((await snapshot()).messages[0].error).toBeUndefined();
    finish = undefined;
    newer = true;
    expect((await post(witness)).status).toBe(200);
    const late = await snapshot();
    expect(late.messages[0].error?.message).toContain("thought signature");
    expect(late.messages[1].error).toBeUndefined();
    newer = false;
    // The observed assistant exists but belongs to another provider.
    wrong = true;
    expect((await post({ ...witness, messageId: "msg_wrong" })).status).toBe(409);
    wrong = false;
    expect((await post({ ...witness, userMessageId: "msg_foreign" })).status).toBe(409);
    expect((await post({ ...witness, code: "arbitrary" })).status).toBe(400);
    expect((await post(witness, { "content-type": "application/json", Authorization: `Bearer ${config.token}` })).status).toBe(403);
    expect((await post(witness, headers, "ws_foreign")).status).toBe(403);
    await server.stop();
    server = await startServer(config);
    expect((await snapshot()).messages[0].error?.message).toContain("thought signature");
  } finally {
    try { await server?.stop(); }
    finally {
      engine?.stop(true);
      if (previous === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previous;
      await rm(root, { recursive: true, force: true });
    }
  }
}, 30000);
