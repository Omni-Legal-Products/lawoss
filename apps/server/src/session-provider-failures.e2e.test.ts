import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import { ensureWikiAgentToken, grantWikiAgentSession } from "./wiki/agent-access.js";
import type { ServerConfig } from "./types.js";

test("scoped provider witness survives server reload only on its failed terminal assistant", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "provider-witness-")));
  const previous = process.env.LEGALWORK_RUNTIME_DB;
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  let idle = false;
  let finish: string | undefined;
  let newer = false;
  let engine: ReturnType<typeof Bun.serve> | undefined;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
  const assistant = () => ({ info: { id: "msg_a", sessionID: "ses_1", role: "assistant", parentID: "msg_u", providerID: "openrouter", modelID: "google/gemini-3-flash-preview", time: { created: 2, completed: 3 }, ...(finish ? { finish } : {}) }, parts: [] });
  engine = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/session/status") return Response.json({ ses_1: { type: idle ? "idle" : "busy" } });
    if (url.pathname === "/session/ses_1/todo") return Response.json([]);
    if (url.pathname === "/session/ses_1/message") return Response.json(newer ? [assistant(), { ...assistant(), info: { ...assistant().info, id: "msg_new", parentID: "msg_user_new", finish: "stop" } }] : [assistant()]);
    if (url.pathname === "/session/ses_1/message/msg_a") return Response.json(assistant());
    if (url.pathname === "/session/ses_1/message/msg_wrong") return Response.json({ ...assistant(), info: { ...assistant().info, id: "msg_wrong", providerID: "openai" } });
    if (url.pathname === "/session/ses_1") return Response.json({ id: "ses_1", directory: root, title: "Synthetic", time: { created: 1, updated: 3 } });
    if (url.pathname === "/session") return Response.json([]);
    return Response.json({}, { status: 404 });
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
    const snapshot = async () => (await (await fetch(`http://127.0.0.1:${serverPort()}/workspace/ws_1/sessions/ses_1/snapshot`, { headers: { Authorization: `Bearer ${config.token}` } })).json()).item;
    idle = true;
    expect((await snapshot()).messages[0].info.error?.data.message).toContain("incomplete");
    expect((await snapshot()).messages[0].info.error?.data.message).not.toContain("signature");
    idle = false;
    expect((await post(witness)).status).toBe(200);
    expect((await snapshot()).messages[0].info.error).toBeUndefined();
    idle = true;
    expect((await snapshot()).messages[0].info.error?.data.message).toContain("thought signature");
    finish = "stop";
    expect((await snapshot()).messages[0].info.error).toBeUndefined();
    finish = "tool-calls";
    expect((await snapshot()).messages[0].info.error).toBeUndefined();
    finish = undefined;
    newer = true;
    expect((await post(witness)).status).toBe(200);
    const late = await snapshot();
    expect(late.messages[0].info.error?.data.message).toContain("thought signature");
    expect(late.messages[1].info.error).toBeUndefined();
    newer = false;
    expect((await post({ ...witness, messageId: "msg_wrong" })).status).toBe(409);
    expect((await post({ ...witness, userMessageId: "msg_foreign" })).status).toBe(409);
    expect((await post({ ...witness, code: "arbitrary" })).status).toBe(400);
    expect((await post(witness, { "content-type": "application/json", Authorization: `Bearer ${config.token}` })).status).toBe(403);
    expect((await post(witness, headers, "ws_foreign")).status).toBe(403);
    await server.stop();
    server = await startServer(config);
    expect((await snapshot()).messages[0].info.error?.data.message).toContain("thought signature");
  } finally {
    try { await server?.stop(); }
    finally {
      engine?.stop(true);
      if (previous === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previous;
      await rm(root, { recursive: true, force: true });
    }
  }
}, 30000);
