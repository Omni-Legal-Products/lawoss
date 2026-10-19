import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openBenchmarkStore, resetBenchmarkStoreCache } from "./benchmarks/store.js";
import { BenchmarkRunner, type BenchmarkOpencodeClient } from "./benchmarks/runner.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];
const ENV_KEYS = [
  "LEGALWORK_BENCHMARKS_DB",
  "LEGALWORK_BENCHMARKS_DIR",
  // startLegalworkServer() sets this too; without it here the afterEach never
  // restores it and every later test file inherits a runtime-DB path pointing
  // into this suite's (already deleted) temp root.
  "LEGALWORK_RUNTIME_DB",
  "LEGALWORK_GITHUB_API_BASE",
  "LEGALWORK_GITHUB_RAW_BASE",
  "LEGALWORK_BENCHMARK_POLL_MS",
  "LEGALWORK_BENCHMARK_ITEM_TIMEOUT_MS",
] as const;
const previousEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]] as const));

const SHA = "e2e0000000000000000000000000000000000000";
const TASKS_SHA = "e2e1111111111111111111111111111111111111";

const HARVEY_TASK = {
  title: "Draft Tax Memo",
  work_type: "draft",
  tags: ["Tax"],
  instructions: "Draft the memo. Output: `memo.docx`.",
  deliverables: { "memo.docx": "memo.docx" },
  criteria: [
    { id: "C-001", title: "Memo exists", deliverables: ["memo.docx"], match_criteria: "PASS if the memo exists." },
  ],
};

// ---- mock GitHub -------------------------------------------------------------

let githubServer: ReturnType<typeof Bun.serve>;

// ---- mock opencode engine ----------------------------------------------------

type MockSession = { directory: string; state: "idle" | "busy"; userId?: string; finished?: boolean };
let opencodeServer: ReturnType<typeof Bun.serve>;
const mockSessions = new Map<string, MockSession>();
let sessionCounter = 0;
let inferenceRequests = 0;

function startMockOpencode() {
  return Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      const path = url.pathname;
      const directory = decodeURIComponent(request.headers.get("x-opencode-directory") ?? "");
      if (request.method === "POST" && /\/(message|prompt_async)$/.test(path)) inferenceRequests++;

      if (request.method === "GET" && path === "/provider") {
        return Response.json({
          all: [
            { id: "prov", name: "Prov", source: "config", env: [], options: {}, models: { "model-a": { name: "Model A" } } },
            {
              id: "deepseek",
              name: "DeepSeek",
              source: "api",
              env: [],
              options: {},
              models: { "deepseek-v4-flash": { name: "DeepSeek V4 Flash" } },
            },
          ],
          default: {},
          connected: ["prov", "deepseek"],
        });
      }
      if (request.method === "POST" && path === "/session") {
        const id = `ses-${++sessionCounter}`;
        mockSessions.set(id, { directory, state: "idle" });
        return Response.json({ id, slug: id, projectID: "p", directory, title: "t", version: "1", time: { created: 1, updated: 1 } });
      }
      if (request.method === "GET" && path === "/session/status") {
        const map: Record<string, { type: string }> = {};
        for (const [id, session] of mockSessions) map[id] = { type: session.state };
        return Response.json(map);
      }
      const promptAsync = path.match(/^\/session\/([^/]+)\/prompt_async$/);
      if (request.method === "POST" && promptAsync) {
        const session = mockSessions.get(promptAsync[1]!)!;
        const body = await request.json() as { messageID: string };
        session.userId = body.messageID;
        session.finished = false;
        // A completed intermediate tool step can precede the next busy event.
        session.state = "idle";
        setTimeout(() => {
          writeFileSync(join(session.directory, "memo.docx"), "the memo");
          session.state = "idle";
          session.finished = true;
        }, 30);
        return new Response(null, { status: 204 });
      }
      const message = path.match(/^\/session\/([^/]+)\/message$/);
      if (request.method === "GET" && message) {
        const session = mockSessions.get(message[1]!)!;
        return Response.json([
          { info: { id: session.userId, sessionID: message[1], role: "user" }, parts: [] },
          {
            info: { id: session.finished ? "msg-final" : "msg-tool", parentID: session.userId, sessionID: message[1], role: "assistant", time: { completed: 1 }, finish: session.finished ? "stop" : "tool-calls", cost: 0.02, tokens: { input: 10, output: 5 } },
            parts: [{ type: "text", text: session.finished ? "Memo written" : "Reading inputs" }],
          },
        ]);
      }
      if (request.method === "POST" && message) {
        const body = (await request.json()) as Record<string, unknown>;
        if (body.format) {
          // batched judge call → structured verdicts for every listed criterion
          const promptText = String(
            (body.parts as Array<{ text?: string }> | undefined)?.[0]?.text ?? "",
          );
          const criterionIds = Array.from(
            new Set(Array.from(promptText.matchAll(/### (C-\d+):/g), (match) => match[1]!)),
          );
          return Response.json({
            info: {
              id: "msg-judge",
              sessionID: message[1],
              role: "assistant",
              structured: {
                verdicts: criterionIds.map((id) => ({
                  id,
                  verdict: "pass",
                  reasoning: "deliverable satisfies the criterion",
                })),
              },
            },
            parts: [],
          });
        }
        return Response.json({ info: { id: "msg-x", sessionID: message[1], role: "assistant" }, parts: [] });
      }
      if (request.method === "POST" && /^\/session\/[^/]+\/abort$/.test(path)) {
        return Response.json(true);
      }
      if (request.method === "DELETE" && /^\/session\/[^/]+$/.test(path)) {
        return Response.json(true);
      }
      return new Response(`mock opencode: unhandled ${request.method} ${path}`, { status: 404 });
    },
  });
}

beforeAll(() => {
  githubServer = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/repos/harveyai/harvey-labs/commits/main") {
        return Response.json({ sha: SHA });
      }
      // Repo root, then the `tasks` subtree the catalog walk descends into.
      if (url.pathname === `/repos/harveyai/harvey-labs/git/trees/${SHA}`) {
        return Response.json({
          truncated: false,
          tree: [{ path: "tasks", type: "tree", sha: TASKS_SHA }],
        });
      }
      if (url.pathname === `/repos/harveyai/harvey-labs/git/trees/${TASKS_SHA}`) {
        return Response.json({
          truncated: false,
          tree: [
            { path: "tax/draft-tax-memo/task.json", type: "blob", sha: "blob-task", mode: "100644" },
            { path: "tax/draft-tax-memo/documents/input.docx", type: "blob", sha: "blob-doc", mode: "100644" },
          ],
        });
      }
      if (url.pathname === `/harveyai/harvey-labs/${SHA}/tasks/tax/draft-tax-memo/task.json`) {
        return Response.json(HARVEY_TASK);
      }
      if (url.pathname === `/harveyai/harvey-labs/${SHA}/tasks/tax/draft-tax-memo/documents/input.docx`) {
        return new Response("INPUT-DOC");
      }
      return new Response("not found", { status: 404 });
    },
  });
  opencodeServer = startMockOpencode();
  process.env.LEGALWORK_GITHUB_API_BASE = `http://127.0.0.1:${githubServer.port}`;
  process.env.LEGALWORK_GITHUB_RAW_BASE = `http://127.0.0.1:${githubServer.port}`;
  process.env.LEGALWORK_BENCHMARK_POLL_MS = "10";
  process.env.LEGALWORK_BENCHMARK_ITEM_TIMEOUT_MS = "10000";
});

afterAll(() => {
  githubServer.stop(true);
  opencodeServer.stop(true);
});

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
  for (const [key, value] of previousEnv) {
    if (["LEGALWORK_GITHUB_API_BASE", "LEGALWORK_GITHUB_RAW_BASE", "LEGALWORK_BENCHMARK_POLL_MS", "LEGALWORK_BENCHMARK_ITEM_TIMEOUT_MS"].includes(key)) continue;
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetBenchmarkStoreCache();
});

async function startLegalworkServer() {
  const root = await mkdtemp(join(tmpdir(), "legalwork-benchmarks-e2e-"));
  roots.push(root);
  process.env.LEGALWORK_BENCHMARKS_DB = join(root, "benchmarks.sqlite");
  process.env.LEGALWORK_BENCHMARKS_DIR = join(root, "benchmarks-data");
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  resetBenchmarkStoreCache();
  const workspaceRoot = join(root, "workspace");
  await Bun.write(join(workspaceRoot, ".keep"), "");
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_test_token",
    hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [
      {
        id: "ws_1",
        name: "Workspace",
        path: workspaceRoot,
        preset: "starter",
        workspaceType: "local",
        baseUrl: `http://127.0.0.1:${opencodeServer.port}`,
      },
    ],
    authorizedRoots: [workspaceRoot],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config);
  stops.push(() => server.stop());
  return { base: `http://127.0.0.1:${server.port}`, token: config.token, workspaceRoot, config };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function json(response: Response, expected = 200) {
  const body = await response.json();
  expect(response.status).toBe(expected);
  return body as any;
}

describe("benchmark API end-to-end", () => {
  test("catalog and custom tasks remain usable; protected runs are refused without side effects and historical runs remain readable", async () => {
    const { base, token, workspaceRoot, config } = await startLegalworkServer();

    // -- catalog
    const catalog = await json(await fetch(`${base}/workspace/ws_1/benchmarks/catalog`, { headers: auth(token) }));
    expect(catalog.ref).toBe(SHA);
    expect(catalog.items).toHaveLength(1);
    expect(catalog.verticals).toEqual([{ id: "tax", label: expect.any(String), count: 1 }]);
    expect(catalog.hydration.total).toBe(1);

    const taskPreview = await json(
      await fetch(
        `${base}/workspace/ws_1/benchmarks/catalog/task?key=${encodeURIComponent("tasks/tax/draft-tax-memo")}`,
        { headers: auth(token) },
      ),
    );
    expect(taskPreview.task.title).toBe("Draft Tax Memo");
    expect(taskPreview.task.workType).toBe("draft");

    // -- import the Harvey task into the workspace task table
    const imported = await json(
      await fetch(`${base}/workspace/ws_1/benchmarks/tasks/import`, {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ keys: ["tasks/tax/draft-tax-memo", "tasks/nope/missing"] }),
      }),
    );
    expect(imported.items).toHaveLength(1);
    expect(imported.items[0]).toMatchObject({
      id: "tasks/tax/draft-tax-memo",
      source: "harvey",
      workType: "draft",
      docCount: 1,
    });
    expect(imported.failed).toHaveLength(1);

    // -- custom task with an uploaded document
    const customTask = await json(
      await fetch(`${base}/workspace/ws_1/benchmarks/tasks`, {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({
          title: "Review NDA",
          workType: "review",
          tags: ["Contracts"],
          instructions: "Review the NDA and write memo.docx.",
          deliverables: ["memo.docx"],
          criteria: [{ title: "Flags clause", matchCriteria: "PASS if the clause is flagged." }],
          documents: [{ name: "nda.txt", contentBase64: Buffer.from("the nda text").toString("base64") }],
        }),
      }),
      201,
    );
    expect(customTask.item.docCount).toBe(1);
    expect(customTask.item.criteria).toHaveLength(1);
    const customTaskId = customTask.item.id as string;

    const taskList = await json(await fetch(`${base}/workspace/ws_1/benchmarks/tasks`, { headers: auth(token) }));
    expect(taskList.items).toHaveLength(2);
    expect(taskList.items.every((item: { latestResults: unknown[] }) => item.latestResults.length === 0)).toBe(true);

    // -- task documents stage into the workspace so the file viewer can open them
    const harveyDocs = await json(
      await fetch(
        `${base}/workspace/ws_1/benchmarks/tasks/${encodeURIComponent("tasks/tax/draft-tax-memo")}/documents`,
        { headers: auth(token) },
      ),
    );
    expect(harveyDocs.items).toHaveLength(1);
    expect(harveyDocs.items[0]).toMatchObject({ name: "input.docx" });
    expect(existsSync(join(workspaceRoot, harveyDocs.items[0].relativePath))).toBe(true);

    const customDocs = await json(
      await fetch(`${base}/workspace/ws_1/benchmarks/tasks/${encodeURIComponent(customTaskId)}/documents`, {
        headers: auth(token),
      }),
    );
    expect(customDocs.items).toHaveLength(1);
    expect(customDocs.items[0]).toMatchObject({ name: "nda.txt" });

    // Protect actual HTTP admission; positive model/scoring lifecycles remain
    // in the owned BenchmarkOpencodeClient port fixtures in runner.test.ts.
    const sessionsBefore = sessionCounter, requestsBefore = inferenceRequests;
    const created = await fetch(`${base}/workspace/ws_1/benchmarks/runs`, {
      method: "POST", headers: auth(token), body: JSON.stringify({ title: "Denied run", tasks: ["tasks/tax/draft-tax-memo", customTaskId], models: [{ providerID: "prov", modelID: "model-a" }], concurrency: 2 }),
    });
    expect(created.status).toBe(403);
    expect(await created.json()).toMatchObject({ code: "ai_transfer_denied" });
    expect(sessionCounter).toBe(sessionsBefore);
    expect(inferenceRequests).toBe(requestsBefore);
    expect((await json(await fetch(`${base}/workspace/ws_1/benchmarks/runs`, { headers: auth(token) }))).items).toEqual([]);
    const tasksAfterDenied = await json(await fetch(`${base}/workspace/ws_1/benchmarks/tasks`, { headers: auth(token) }));
    expect(tasksAfterDenied.items.every((item: { latestResults: unknown[] }) => item.latestResults.length === 0)).toBe(true);

    // A genuine public store fixture supplies historical non-executing state;
    // denying a new model request must not hide a lawyer's previous run history.
    const store = await openBenchmarkStore(config), runId = "historical-interrupted";
    store.createRun({ id: runId, workspaceId: "ws_1", title: "Previous run", status: "interrupted", judgeProviderId: "deepseek", judgeModelId: "deepseek-v4-flash", concurrency: 1, catalogRef: SHA, createdAt: 1000 }, [{ providerID: "prov", modelID: "model-a" }], []);
    const list = await json(await fetch(`${base}/workspace/ws_1/benchmarks/runs`, { headers: auth(token) }));
    expect(list.items.map((item: { id: string }) => item.id)).toEqual([runId]);
    const detail = await json(await fetch(`${base}/workspace/ws_1/benchmarks/runs/${runId}`, { headers: auth(token) }));
    expect(detail.run).toMatchObject({ id: runId, status: "interrupted", title: "Previous run" });
    expect(detail.items).toEqual([]);
    const resume = await fetch(`${base}/workspace/ws_1/benchmarks/runs/${runId}/resume`, { method: "POST", headers: auth(token) });
    expect(resume.status).toBe(403); expect(await resume.json()).toMatchObject({ code: "ai_transfer_denied" });
    expect((await json(await fetch(`${base}/workspace/ws_1/benchmarks/runs/${runId}`, { headers: auth(token) }))).run.status).toBe("interrupted");
    expect(sessionCounter).toBe(sessionsBefore); expect(inferenceRequests).toBe(requestsBefore);

    // -- delete cleans up
    await json(
      await fetch(`${base}/workspace/ws_1/benchmarks/runs/${runId}`, { method: "DELETE", headers: auth(token) }),
    );
    const gone = await fetch(`${base}/workspace/ws_1/benchmarks/runs/${runId}`, { headers: auth(token) });
    expect(gone.status).toBe(404);
    expect(existsSync(join(workspaceRoot, ".legalwork", "benchmarks", runId))).toBe(false);
  });

  test("governance denial precedes unavailable-model execution without contacting a provider", async () => {
    const { base, token, config } = await startLegalworkServer();
    await json(
      await fetch(`${base}/workspace/ws_1/benchmarks/tasks/import`, {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ keys: ["tasks/tax/draft-tax-memo"] }),
      }),
    );
    const response = await fetch(`${base}/workspace/ws_1/benchmarks/runs`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({
        tasks: ["tasks/tax/draft-tax-memo"],
        models: [{ providerID: "prov", modelID: "no-such-model" }],
      }),
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("ai_transfer_denied");
    expect(inferenceRequests).toBe(0);
    expect((await json(await fetch(`${base}/workspace/ws_1/benchmarks/runs`, { headers: auth(token) }))).items).toEqual([]);
    // Model catalog validation remains a pure domain contract, separate from
    // the current host prohibition on executing protected HTTP jobs.
    let modelCalls = 0;
    const unexpected = async () => { modelCalls++; throw new Error("An unavailable model must never execute"); };
    const client: BenchmarkOpencodeClient = {
      provider: { list: async () => ({ data: { all: [{ id: "prov", models: { "model-a": {} } }, { id: "deepseek", models: { "deepseek-v4-flash": {} } }] } }) },
      session: { create: unexpected, prompt: unexpected, promptAsync: unexpected, status: unexpected, messages: unexpected, abort: unexpected, delete: unexpected },
    };
    const runner = new BenchmarkRunner({ config, createClient: () => client });
    await expect(runner.createRun(config.workspaces[0]!, { tasks: ["tasks/tax/draft-tax-memo"], models: [{ providerID: "prov", modelID: "no-such-model" }] })).rejects.toMatchObject({ status: 400, code: "benchmark_model_unavailable" });
    expect(modelCalls).toBe(0);

  });
});
