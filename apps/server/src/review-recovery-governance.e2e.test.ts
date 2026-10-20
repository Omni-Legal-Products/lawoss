import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { enforceAiBoundaries } from "./lawoss/test-support/ai-boundaries.js";

test("with AI boundaries on, server-mediated recovery preserves governance denial and releases its reservation", async () => {
  const root = await mkdtemp(join(tmpdir(), "recovery-governance-"));
  let prompts = 0;
  const engine = Bun.serve({hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/session/status") return Response.json({chat: {type: "idle"}});
    if (path === "/session/chat") return Response.json({id: "chat", title: "Synthetic", directory: root, time: {created: 1, updated: 1}});
    if (path === "/session/chat/prompt_async") {prompts++; return new Response(null, {status: 204});}
    if (path === "/session/chat/todo") return Response.json([{id: "todo", content: "Finish synthetic review", status: "in_progress", priority: "high"}]);
    if (path === "/session/chat/message/human") return Response.json({info: {id: "human", sessionID: "chat", role: "user", agent: "legalwork", model: {providerID: "test", modelID: "test"}}, parts: [{type: "text", text: "Synthetic request"}]});
    if (path === "/session/chat/message") return Response.json([{info: {id: "empty", parentID: "human", sessionID: "chat", role: "assistant", finish: "stop"}, parts: [{type: "reasoning", text: "Synthetic reasoning"}]}]);
    return new Response(null, {status: 404});
  }});
  const config: ServerConfig = {host: "127.0.0.1", port: 0, token: "synthetic-client", hostToken: "synthetic-host", configPath: join(root, "server.json"), approval: {mode: "auto", timeoutMs: 1000}, corsOrigins: [], workspaces: [{id: "project", name: "Synthetic", path: root, workspaceType: "local", preset: "starter", baseUrl: engine.url.origin}], authorizedRoots: [root], readOnly: false, startedAt: 0, tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false};
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    server = await startServer(config);
    await enforceAiBoundaries(config);
    const endpoint = `http://127.0.0.1:${server.port}/workspace/project/sessions/chat`;
    const request = (path: string, body: unknown) => fetch(endpoint + path, {method: "POST", headers: {authorization: `Bearer ${config.token}`, "content-type": "application/json"}, body: JSON.stringify(body)});
    expect((await request("/review-recovery", {messageId: "old"})).status).toBe(409);
    for (let retry = 0; retry < 2; retry++) {
      const denied = await request("/review-recovery", {messageId: "empty"});
      expect(denied.status).toBe(403);
      expect(await denied.json()).toMatchObject({code: "ai_transfer_denied"});
      expect(prompts).toBe(0);
    }
    // Both the execution lease and recovery dedup reservation must remain available.
    expect((await request("/queue", {type: "pause", paused: true})).status).toBe(200);
  } finally {
    try {await server?.stop();} finally {engine.stop(true); await rm(root, {recursive: true});}
  }
});
