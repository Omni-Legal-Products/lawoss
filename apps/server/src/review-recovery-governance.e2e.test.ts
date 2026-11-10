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
  // LAWOSS v2: fake engine 2.1.4 with the recovery history shape of upstream session-view-delete.e2e.test.ts.
  const tool = (id: string, name: string, metadata = {}) => ({type: "tool", id, name, time: {created: 2, ran: 2, completed: 3}, state: {status: "completed", input: {}, content: [{type: "text", text: ""}], metadata}});
  const assistant = (id: string, content: unknown[], created: number) => ({id, type: "assistant", agent: "legalwork", model: {providerID: "test", id: "test"}, time: {created, completed: created + 1}, content});
  const history = [
    {id: "human", type: "user", text: "Synthetic request", time: {created: 1}},
    assistant("review", [tool("review-call", "legalwork_review_get"), tool("todo", "todowrite", {todos: [{content: "Finish synthetic review", status: "in_progress", priority: "high"}]})], 2),
    {...assistant("empty", [{type: "reasoning", text: "Synthetic reasoning"}], 4), finish: "stop"},
  ];
  const engine = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url), path = url.pathname;
    if (path === "/api/session/active") return Response.json({data: {}});
    if (path === "/api/session") return Response.json({data: [], cursor: {}});
    if (path === "/api/session/chat") return Response.json({data: {id: "chat", projectID: "project", title: "Synthetic", location: {directory: root}, time: {created: 1, updated: 1}}});
    if (path === "/api/session/chat/inbox") return Response.json({data: []});
    if (path === "/api/session/chat/synthetic" || path === "/api/session/chat/prompt") {prompts++; return Response.json({data: {id: "recovery", type: "synthetic", text: "", time: {created: 10}}});}
    if (path === "/api/session/chat/message") {
      const type = url.searchParams.get("type"), ordered = url.searchParams.get("order") === "desc" ? [...history].reverse() : history;
      return Response.json({data: ordered.filter(message => !type || message.type === type), cursor: {}});
    }
    return Response.json({code: "not_found", message: "Not found"}, {status: 404});
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
