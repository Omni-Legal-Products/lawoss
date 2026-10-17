import { afterEach, test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ViewRecordSchema, type ViewPreview } from "@legalwork/types/views";
import { withSessionExecution } from "./session-execution-gate.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "session-view-delete-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const preview: ViewPreview = { status: "preview", owner: { kind: "workspace", id: "project" }, input: { version: 1, title: "Unsaved dashboard", mode: "dashboard", catalog: "legalwork-1", program: 'root = Text("Keep this")', queries: {} } };
  const state: { deleted: number; busy: boolean; child: boolean; childBusy: boolean; calls: string[]; runningAtRead: boolean; recovery: boolean; prompts: number; reviewHook?: () => Promise<void> } = { deleted: 0, busy: false, child: false, childBusy: false, calls: ["call1"], runningAtRead: false, recovery: false, prompts: 0 };
  const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/session/status") return Response.json({ chat: { type: state.busy ? "busy" : "idle" }, child: { type: state.childBusy ? "busy" : "idle" } });
    if (path === "/session/chat/children") return Response.json(state.child ? [{ id: "child", parentID: "chat" }] : []);
    if (path === "/session/child") return Response.json({ id: "child", parentID: "chat", directory: root });
    if (path === "/session/child/message") return Response.json([{ parts: [{ type: "tool", tool: "view_create", callID: "child-call", state: { status: "completed", output: JSON.stringify(preview) } }] }]);
    if (path === "/session/chat" && request.method === "DELETE") { state.deleted++; return Response.json(true); }
    if (path === "/session/chat") return Response.json({ id: "chat", title: "Chat", directory: root, time: { created: 1, updated: 1 } });
    if (path === "/session/chat/prompt_async") { state.prompts++; return new Response(null, { status: 204 }); }
    if (path === "/session/chat/todo") return Response.json([{ id: "todo", content: "Finish review", status: "in_progress", priority: "high" }]);
    if (path === "/session/chat/message/human") return Response.json({ info: { id: "human", sessionID: "chat", role: "user", agent: "legalwork", model: { providerID: "test", modelID: "test" } }, parts: [{ type: "text", text: "Finish my review" }] });
    if (path === "/session/chat/message" && state.recovery) return Response.json([{ info: { id: "empty", parentID: "human", sessionID: "chat", role: "assistant", finish: "stop" }, parts: [{ type: "reasoning", text: "Thinking" }] }]);
    if (path === "/session/chat/message") { if (state.reviewHook) await state.reviewHook(); return Response.json([{ info: { id: "msg", role: "assistant", sessionID: "chat" }, parts: state.calls.map(callID => ({ type: "tool", tool: "view_create", callID, state: { status: state.runningAtRead ? "running" : "completed", output: "Preview ready", metadata: { legalworkViewPreview: preview } } })) }]); }
    return Response.json([], { status: 200 });
  } });
  cleanup.push(() => { engine.stop(true); });
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "test", hostToken: "host", configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces: [{ id: "project", name: "Project", path: root, workspaceType: "local", preset: "starter", baseUrl: `http://127.0.0.1:${engine.port}` }], authorizedRoots: [root], readOnly: false, startedAt: 0, tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const server = await startServer(config); cleanup.push(() => server.stop());
  const request = (path: string, method = "GET", body?: unknown, source?: unknown) => fetch(`http://127.0.0.1:${server.port}${path}${source ? `?source=${encodeURIComponent(JSON.stringify(source))}` : ""}`, { method, headers: { authorization: "Bearer test", "x-legalwork-host-token": "host", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { root, state, request, preview, config };
}
const reviewSchema = z.object({ items: z.array(z.object({ callId: z.string() })), reviewToken: z.string() });
const endpoint = "/workspace/project/sessions/chat";
test("deletion requires a reviewed discard and invalidates stale confirmations", async () => {
  const { state, request } = await fixture();
  expect((await request(endpoint, "DELETE")).status).toBe(409);
  const review = reviewSchema.parse(await (await request(`${endpoint}/views`)).json());
  expect(review.items).toEqual([{ callId: "call1" }]);
  state.calls.push("call2");
  expect((await request(`${endpoint}?discardReview=${review.reviewToken}`, "DELETE")).status).toBe(409);
  expect(state.deleted).toBe(0);
  const current = reviewSchema.parse(await (await request(`${endpoint}/views`)).json());
  expect((await request(`${endpoint}?discardReview=${current.reviewToken}`, "DELETE")).status).toBe(200);
  expect(state.deleted).toBe(1);
});
test("saved copies survive chat deletion; removing a copy restores the warning", async () => {
  const { root, state, request, preview } = await fixture();
  const response = await request("/workspace/project/ui-views", "POST", preview.input, { workspaceId: "project", sessionId: "chat", callId: "call1" });
  expect(response.status).toBe(201);
  const view = ViewRecordSchema.parse(await response.json());
  expect(reviewSchema.parse(await (await request(`${endpoint}/views`)).json()).items).toHaveLength(0);
  await rm(join(root, "Dashboards", `${view.id}.view.json`));
  expect((await request(endpoint, "DELETE")).status).toBe(409);
  expect(state.deleted).toBe(0);
  const again = await request("/workspace/project/ui-views", "POST", preview.input);
  const copy = ViewRecordSchema.parse(await again.json());
  expect((await request(endpoint, "DELETE")).status).toBe(200);
  expect((await request(`/workspace/project/ui-views/${copy.id}`)).status).toBe(200);
});
test("active generation and direct proxy deletion cannot bypass dashboard review", async () => {
  const { state, request } = await fixture();
  const review = reviewSchema.parse(await (await request(`${endpoint}/views`)).json());
  state.busy = true;
  expect((await request(`${endpoint}?discardReview=${review.reviewToken}`, "DELETE")).status).toBe(409);
  expect((await request("/workspace/project/opencode/session/chat", "DELETE")).status).toBe(409);
  expect(state.deleted).toBe(0);
});


test("parent deletion also protects dashboards and running generation in child chats", async () => {
  const { state, request, preview } = await fixture();
  state.calls = []; state.child = true;
  expect((await request(endpoint, "DELETE")).status).toBe(409);
  const childReview = z.object({ items: z.array(z.object({ sessionId: z.string(), callId: z.string() })), reviewToken: z.string() }).parse(await (await request(`${endpoint}/views`)).json());
  expect(childReview.items).toEqual([{ sessionId: "child", callId: "child-call" }]);
  state.childBusy = true;
  expect((await request(`${endpoint}?discardReview=${childReview.reviewToken}`, "DELETE")).status).toBe(409);
  state.childBusy = false;
  expect((await request("/workspace/project/ui-views", "POST", preview.input, { workspaceId: "project", sessionId: "child", callId: "child-call" })).status).toBe(201);
  expect((await request(endpoint, "DELETE")).status).toBe(200);
  expect(state.deleted).toBe(1);
});

test("running tools cannot disappear between transcript review and the idle check", async () => {
  const { state, request } = await fixture();
  state.runningAtRead = true;
  // Engine status has already become idle, but its transcript snapshot is lagging.
  const response = await request(endpoint, "DELETE");
  expect(response.status).toBe(409);
  expect(state.deleted).toBe(0);
  state.runningAtRead = false;
  const review = reviewSchema.parse(await (await request(`${endpoint}/views`)).json());
  expect(review.items).toHaveLength(1);
  expect((await request(`${endpoint}?discardReview=${review.reviewToken}`, "DELETE")).status).toBe(200);
});

test("deletion excludes direct sends, queue mutations, and another delete until review finishes", async () => {
  const { state, request } = await fixture();
  let reviewed = () => {}, release = () => {};
  const reached = new Promise<void>(resolve => { reviewed = resolve; });
  const blocked = new Promise<void>(resolve => { release = resolve; });
  state.reviewHook = async () => { reviewed(); await blocked; };
  const deleting = request(endpoint, "DELETE");
  try {
    await reached;
    for (const action of ["message", "prompt_async", "command", "fork"])
      expect((await request(`/workspace/project/opencode/session/chat/${action}`, "POST", { parts: [] })).status).toBe(409);
    expect((await request(`${endpoint}/queue`, "POST", { type: "pause", paused: false })).status).toBe(409);
    expect((await request(`${endpoint}/review-recovery`, "POST", { messageId: "empty" })).status).toBe(409);
    expect((await request(endpoint, "DELETE")).status).toBe(409);
    // Unrelated chats remain usable.
    expect((await request("/workspace/project/opencode/session/unrelated/prompt_async", "POST", { parts: [] })).status).toBe(200);
  } finally { release(); }
  expect((await deleting).status).toBe(409);
  state.reviewHook = undefined;
  expect((await request(`${endpoint}/queue`, "POST", { type: "pause", paused: false })).status).toBe(200);
});

test("a reserved send blocks deletion even before the engine reports busy", async () => {
  const { state, request, config } = await fixture();
  await withSessionExecution(config, "chat", async () => {
    expect((await request(endpoint, "DELETE")).status).toBe(409);
    expect(state.deleted).toBe(0);
  });
  const review = reviewSchema.parse(await (await request(`${endpoint}/views`)).json());
  expect((await request(`${endpoint}?discardReview=${review.reviewToken}`, "DELETE")).status).toBe(200);
});

test("server-mediated recovery accepts a 204, uses the verified request and deduplicates it", async () => {
  const { state, request } = await fixture();
  state.recovery = true;
  expect((await request(`${endpoint}/review-recovery`, "POST", { messageId: "old" })).status).toBe(409);
  expect(state.prompts).toBe(0);
  expect((await request(`${endpoint}/review-recovery`, "POST", { messageId: "empty" })).status).toBe(200);
  expect(state.prompts).toBe(1);
  expect((await request(`${endpoint}/review-recovery`, "POST", { messageId: "empty" })).status).toBe(200);
  expect(state.prompts).toBe(1);
});
