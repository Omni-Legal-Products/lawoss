import {expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {startServer} from "./server.js";
import {ScheduledTaskStore} from "./scheduled-tasks/store.js";
import {runtimeDbPath} from "./runtime-db.js";
import {syntheticHostConfig} from "./lawoss/test-support/host-config.js";

/** Engine v2 envelopes for the scheduler: no running chats, a created chat, chats in the project folder. */
function engineV2(request: Request, root: string) {
  const path = new URL(request.url).pathname;
  const session = (id: string) => ({ id, projectID: "synthetic", location: { directory: root }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 1, updated: 1 } });
  if (path === "/api/session/active") return Response.json({ data: {} });
  if (request.method === "POST" && path === "/api/session") return Response.json({ data: session("new-synthetic-chat") });
  const match = /^\/api\/session\/([^/]+)$/.exec(path);
  if (match) return Response.json({ data: session(match[1]!) });
  return Response.json({});
}
import {enforceAiBoundaries} from "./lawoss/test-support/ai-boundaries.js";

test.each(["synthetic-chat", null])("with AI boundaries on, ordinary server construction refuses protected schedules before existing/fresh chat side effects: %s", async sessionId => {
  const {root, config} = await syntheticHostConfig();
  await enforceAiBoundaries(config);
  const payloads: string[] = [];
  const engine = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (request.method === "POST") payloads.push(await request.text());
    return engineV2(request, root);
  }});
  config.workspaces = [{id: "synthetic", name: "Synthetic", path: root, workspaceType: "local", preset: "starter", baseUrl: engine.url.origin}];
  const store = await ScheduledTaskStore.open(runtimeDbPath(config));
  const due = Date.now() - 60000;
  const task = store.create("synthetic", {title: "PROTECTED-SCHEDULE-TITLE-CANARY", prompt: "PROTECTED-SCHEDULE-CANARY", projectAccess: "project", sessionId, reuseChat: false, pinSession: false, model: null, schedule: {kind: "once", startAt: new Date(due).toISOString(), timeZone: "UTC"}}, due - 60000);
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    server = await startServer(config);
    for (let attempt = 0; attempt < 100 && store.runs(task.id)[0]?.status !== "failed"; attempt++) await Bun.sleep(10);
    expect(store.runs(task.id)[0]).toMatchObject({status: "failed", error: "Protected AI processing is unavailable. Continue manually without a model."});
    expect(store.runs(task.id)[0]?.sessionId).toBe(sessionId);
    expect(payloads).toEqual([]);
  } finally {try {await server?.stop();} finally {store.close(); engine.stop(true); await rm(root, {recursive: true});}}
});

test("trusted non-model embedding work with a fresh chat still drains before server shutdown", async () => {
  const {root, config} = await syntheticHostConfig();
  const posts: string[] = [];
  const engine = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (request.method === "POST") posts.push(new URL(request.url).pathname);
    return engineV2(request, root);
  }});
  config.workspaces = [{id: "synthetic", name: "Synthetic", path: root, workspaceType: "local", preset: "starter", baseUrl: engine.url.origin}];
  const store = await ScheduledTaskStore.open(runtimeDbPath(config));
  const due = Date.now() - 60000;
  const task = store.create("synthetic", {title: "Public synthetic non-model job", prompt: "Public synthetic payload", projectAccess: "project", sessionId: null, reuseChat: false, pinSession: false, model: null, schedule: {kind: "once", startAt: new Date(due).toISOString(), timeZone: "UTC"}}, due - 60000);
  let entered!: () => void, release!: () => void;
  const sending = new Promise<void>(resolve => {entered = resolve;});
  const held = new Promise<void>(resolve => {release = resolve;});
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    server = await startServer(config, {scheduledTaskSend: async (_task, sessionId) => {expect(sessionId).toBe("new-synthetic-chat"); entered(); await held;}});
    await sending;
    let stopped = false;
    const stopping = Promise.resolve(server.stop()).then(() => {stopped = true;});
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(stopped).toBe(false);
    release(); await stopping;
    expect(store.runs(task.id)[0]).toMatchObject({sessionId: "new-synthetic-chat", status: "sent"});
    expect(posts).toEqual(["/api/session"]);
  } finally {release(); try {await server?.stop();} finally {store.close(); engine.stop(true); await rm(root, {recursive: true});}}
});
