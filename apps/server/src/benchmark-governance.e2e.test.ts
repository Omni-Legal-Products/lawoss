import {expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {openBenchmarkStore, resetBenchmarkStoreCache} from "./benchmarks/store.js";
import {startServer} from "./server.js";
import {syntheticHostConfig} from "./lawoss/test-support/host-config.js";
import {enforceAiBoundaries} from "./lawoss/test-support/ai-boundaries.js";

test("with AI boundaries on, benchmark execution refuses protected processing before a run or engine session is created", async () => {
  const {root, config} = await syntheticHostConfig();
  const sent: string[] = [];
  const engine = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (request.method === "POST") sent.push(path);
    if (path === "/provider") return Response.json({all: [{id: "fixture", models: {fixture: {}}}], connected: ["fixture"]});
    if (path === "/session" && request.method === "POST") return Response.json({id: "synthetic-chat"});
    if (path === "/session/status") return Response.json({});
    if (path.endsWith("/message")) return Response.json([{info: {role: "assistant", id: "synthetic-message"}, parts: []}]);
    return Response.json({});
  }});
  config.workspaces = [{id: "synthetic", name: "Synthetic", path: root, workspaceType: "local", preset: "starter", baseUrl: engine.url.origin}];
  const server = await startServer(config);
  await enforceAiBoundaries(config);
  const store = await openBenchmarkStore(config);
  const base = `http://127.0.0.1:${server.port}/workspace/synthetic/benchmarks`;
  const headers = {authorization: `Bearer ${config.token}`, "content-type": "application/json"};
  const request = (path: string, body?: unknown) => fetch(base + path, {method: body ? "POST" : "GET", headers, ...(body ? {body: JSON.stringify(body)} : {})});
  try {
    const task = await request("/tasks", {title: "Synthetic", workType: "review", tags: [], instructions: "PROTECTED-BENCHMARK-CANARY", deliverables: ["synthetic.md"], criteria: [{title: "Synthetic criterion", matchCriteria: "PASS if source supports it."}]}).then(response => response.json());
    const denied = await request("/runs", {tasks: [task.item.id], models: [{providerID: "fixture", modelID: "fixture"}], judgeModel: {providerID: "fixture", modelID: "fixture"}});
    // On the prior path, join the wrongly admitted background run before fixture cleanup.
    if (denied.status === 201) {
      const created = await denied.clone().json();
      for (let attempt = 0; attempt < 100; attempt++) {
        const current = await request(`/runs/${created.run.id}/progress`).then(response => response.json());
        if (!["pending", "running", "aborting"].includes(current.status)) break;
        await Bun.sleep(10);
      }
    }
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({code: "ai_transfer_denied"});
    expect(await request("/runs").then(response => response.json())).toMatchObject({items: []});
    expect(sent).toEqual([]);
    expect((await request("/runs/missing/resume", {})).status).toBe(404);
    store.createRun({id: "historical-failed", workspaceId: "synthetic", title: "Synthetic failed run", status: "failed", judgeProviderId: "fixture", judgeModelId: "fixture", concurrency: 1, catalogRef: null, createdAt: 0}, [], []);
    const resumed = await request("/runs/historical-failed/resume", {});
    expect(resumed.status).toBe(403);
    expect(await resumed.json()).toMatchObject({code: "ai_transfer_denied"});
    expect(store.getRun("historical-failed")?.status).toBe("failed");
    expect(sent).toEqual([]);
  } finally {try {await server.stop();} finally {store.close(); resetBenchmarkStoreCache(); engine.stop(true); await rm(root, {recursive: true});}}
});
