import {expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {startServer} from "./server.js";
import {ScheduledTaskStore} from "./scheduled-tasks/store.js";
import {runtimeDbPath} from "./runtime-db.js";
import {syntheticHostConfig} from "./lawoss/test-support/host-config.js";

test("ordinary server construction never admits a protected scheduled send", async () => {
  const {root, config} = await syntheticHostConfig();
  const payloads: string[] = [];
  const engine = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (request.method === "POST") payloads.push(await request.text());
    return Response.json({});
  }});
  config.workspaces = [{id: "synthetic", name: "Synthetic", path: root, workspaceType: "local", preset: "starter", baseUrl: engine.url.origin}];
  const store = await ScheduledTaskStore.open(runtimeDbPath(config));
  const due = Date.now() - 60000;
  const task = store.create("synthetic", {title: "Synthetic", prompt: "PROTECTED-SCHEDULE-CANARY", projectAccess: "project", sessionId: "synthetic-chat", reuseChat: false, pinSession: false, model: null, schedule: {kind: "once", startAt: new Date(due).toISOString(), timeZone: "UTC"}}, due - 60000);
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    server = await startServer(config);
    for (let attempt = 0; attempt < 100 && store.runs(task.id)[0]?.status !== "failed"; attempt++) await Bun.sleep(10);
    expect(store.runs(task.id)[0]).toMatchObject({status: "failed", error: "Protected AI processing is unavailable. Continue manually without a model."});
    expect(payloads).toEqual([]);
  } finally {try {await server?.stop();} finally {store.close(); engine.stop(true); await rm(root, {recursive: true});}}
});
