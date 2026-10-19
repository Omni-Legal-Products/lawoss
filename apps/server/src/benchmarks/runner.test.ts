import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import type { BenchmarkArm } from "./ablation.js";
import { BenchmarkRunner, type BenchmarkOpencodeClient } from "./runner.js";
import { createScenarioTask } from "../lawoss/benchmark-scenarios.js";
import { openBenchmarkStore, resetBenchmarkStoreCache, type BenchmarkStore } from "./store.js";

type MessageEntry = NonNullable<Awaited<ReturnType<BenchmarkOpencodeClient["session"]["messages"]>>["data"]>[number];

let dir: string;
let config: ServerConfig;
let workspace: WorkspaceInfo;
let store: BenchmarkStore;

const PROVIDERS = [
  { id: "prov", models: { "model-a": {}, "model-b": {} } },
  { id: "deepseek", models: { "deepseek-v4-flash": {} } },
];

type FakeBehavior = {
  agentDelayMs?: number;
  agentNeverFinishes?: boolean;
  agentError?: string;
  writeDeliverables?: string[];
  deliverableContents?: Record<string, string>;
  judgeStructured?: (prompt: string) => unknown;
  judgeDelayMs?: number;
  /** Simulate providers that reject the structured-output tool call (DeepSeek thinking mode). */
  judgeStructuredUnsupported?: boolean;
  /** Reply text for the plain-JSON fallback attempt (no format param). */
  judgeFallbackText?: string;
  promptAsyncUnsupported?: boolean;
  /**
   * How many agent turns (per session, in order) end cut off at the output
   * limit — `finish: "length"`, nothing written — before turns finish normally.
   */
  cutOffTurns?: number;
  /** Cut-off turns still write the deliverables (cut off afterwards, e.g. in the summary). */
  cutOffAfterWriting?: boolean;
  /**
   * Delay before the engine picks a prompt up. Until then the session reads
   * idle and its last assistant message is the previous turn's reply.
   */
  startDelayMs?: number;
  /** Model limits the fake provider list reports, keyed by model id. */
  modelLimits?: Record<string, { context: number; output: number }>;
};

type FakeStats = {
  activeAgents: number;
  maxActiveAgents: number;
  activeJudges: number;
  agentStarts: number;
  judgeStarts: number;
  agentJudgeOverlap: number;
  abortedSessions: string[];
  deletedSessions: string[];
  /** Every agent prompt the runner sent, for asserting ablation reached the engine. */
  agentPrompts: Array<{ tools: Record<string, boolean> | undefined; text: string }>;
};

function createFake(behavior: FakeBehavior = {}) {
  const stats: FakeStats = {
    activeAgents: 0,
    maxActiveAgents: 0,
    activeJudges: 0,
    agentStarts: 0,
    judgeStarts: 0,
    agentJudgeOverlap: 0,
    abortedSessions: [],
    deletedSessions: [],
    agentPrompts: [],
  };
  type FakeSession = {
    directory: string;
    state: "idle" | "busy";
    aborted: boolean;
    turns: number;
    replies: Array<NonNullable<MessageEntry["info"]>>;
    userId?: string;
    /** The in-flight turn, cancelled by abort like a real engine stops generating. */
    timer?: ReturnType<typeof setTimeout>;
  };
  const sessions = new Map<string, FakeSession>();
  let counter = 0;
  let replyCounter = 0;

  const client: BenchmarkOpencodeClient = {
    session: {
      create: async (params) => {
        const id = `ses-${++counter}`;
        sessions.set(id, { directory: String(params.directory ?? ""), state: "idle", aborted: false, turns: 0, replies: [] });
        return { data: { id } };
      },
      promptAsync: async (params) => {
        stats.agentPrompts.push({
          tools: params.tools as Record<string, boolean> | undefined,
          text: String((params.parts as Array<{ text?: string }> | undefined)?.[0]?.text ?? ""),
        });
        if (behavior.promptAsyncUnsupported) {
          return { error: { status: 404, message: "prompt_async unsupported" } };
        }
        const session = sessions.get(String(params.sessionID))!;
        session.userId = String(params.messageID);
        session.turns += 1;
        const cutOff = session.turns <= (behavior.cutOffTurns ?? 0);
        stats.agentStarts += 1;
        stats.activeAgents += 1;
        stats.maxActiveAgents = Math.max(stats.maxActiveAgents, stats.activeAgents);
        if (stats.activeJudges > 0) stats.agentJudgeOverlap += 1;
        const begin = () => {
          session.state = "busy";
          if (behavior.agentNeverFinishes) return;
          session.timer = setTimeout(() => {
            session.timer = undefined;
            if (!cutOff || behavior.cutOffAfterWriting) {
              for (const name of behavior.writeDeliverables ?? []) {
                writeFileSync(join(session.directory, name), behavior.deliverableContents?.[name] ?? `content of ${name}`);
              }
            }
            const id = `msg-${++replyCounter}`;
            session.replies.push(
              behavior.agentError
                ? { id, parentID: session.userId, role: "assistant", error: { name: "UnknownError", data: { message: behavior.agentError } } }
                : cutOff
                  ? { id, parentID: session.userId, role: "assistant", time: { completed: 1 }, finish: "length", cost: 0, tokens: { input: 5, output: 0 } }
                  : { id, parentID: session.userId, role: "assistant", time: { completed: 1 }, finish: "stop", cost: 0.25, tokens: { input: 5, output: 9 } },
            );
            session.state = "idle";
            stats.activeAgents -= 1;
          }, behavior.agentDelayMs ?? 10);
        };
        if (behavior.startDelayMs) session.timer = setTimeout(begin, behavior.startDelayMs);
        else begin();
        return { error: undefined };
      },
      prompt: async (params) => {
        if (params.system) {
          // batched judge call (attempt 0 sends format; the fallback attempt does not)
          stats.judgeStarts += 1;
          if (stats.activeAgents > 0) stats.agentJudgeOverlap += 1;
          stats.activeJudges += 1;
          if (behavior.judgeDelayMs) {
            await new Promise((resolve) => setTimeout(resolve, behavior.judgeDelayMs));
          }
          stats.activeJudges -= 1;
          const promptText = String((params.parts as Array<{ text?: string }> | undefined)?.[0]?.text ?? "");
          const criterionIds = Array.from(
            new Set(Array.from(promptText.matchAll(/### (C-\d+):/g), (match) => match[1]!)),
          );
          if (params.format) {
            if (behavior.judgeStructuredUnsupported) {
              return {
                data: {
                  info: {
                    role: "assistant",
                    error: { name: "ProviderError", data: { message: "Thinking mode does not support this tool_choice" } },
                  },
                  parts: [],
                },
              };
            }
            const structured = behavior.judgeStructured
              ? behavior.judgeStructured(promptText)
              : { verdicts: criterionIds.map((id) => ({ id, verdict: "pass", reasoning: "looks good" })) };
            return { data: { info: { role: "assistant", structured }, parts: [] } };
          }
          const text =
            behavior.judgeFallbackText ??
            `Let me check the deliverable first. ${JSON.stringify({
              verdicts: criterionIds.map((id) => ({ id, verdict: "pass", reasoning: "fallback ok" })),
            })}`;
          return { data: { info: { role: "assistant" }, parts: [{ type: "text", text }] } };
        }
        // synchronous agent fallback
        const session = sessions.get(String(params.sessionID))!;
        stats.agentStarts += 1;
        for (const name of behavior.writeDeliverables ?? []) {
          writeFileSync(join(session.directory, name), behavior.deliverableContents?.[name] ?? `content of ${name}`);
        }
        session.userId = String(params.messageID);
        const info = { id: `msg-${++replyCounter}`, parentID: session.userId, role: "assistant", finish: "stop", time: { completed: 1 }, cost: 0.5, tokens: { input: 10, output: 20 } };
        session.replies.push(info);
        return { data: { info, parts: [{ type: "text", text: "Done" }] } };
      },
      status: async () => {
        const map: Record<string, { type: string }> = {};
        for (const [id, session] of sessions) {
          map[id] = { type: session.state };
        }
        return { data: map };
      },
      messages: async (params) => {
        const session = sessions.get(String(params.sessionID));
        const replies = (session?.replies ?? []).map((info) => ({ info, parts: [{ type: "text", text: "Done" }] }));
        const entries: MessageEntry[] = replies.flatMap(entry => [{ info: { id: entry.info.parentID, role: "user" } }, entry]);
        if (!entries.some(entry => entry.info?.id === session?.userId)) entries.push({ info: { id: session?.userId, role: "user" } });
        return { data: entries };
      },
      abort: async (params) => {
        const session = sessions.get(String(params.sessionID));
        if (session) {
          // Stop the in-flight turn: a pending write would otherwise land after
          // the test has already removed the work dir.
          if (session.timer) clearTimeout(session.timer);
          session.timer = undefined;
          session.state = "idle";
          session.aborted = true;
          stats.abortedSessions.push(String(params.sessionID));
          if (stats.activeAgents > 0) stats.activeAgents -= 1;
        }
        return { data: true };
      },
      delete: async (params) => {
        stats.deletedSessions.push(String(params.sessionID));
        return { data: true };
      },
    },
    provider: {
      list: async () => ({
        data: {
          all: PROVIDERS.map((provider) => ({
            ...provider,
            models: Object.fromEntries(
              Object.keys(provider.models).map((id) => [
                id,
                behavior.modelLimits?.[id] ? { limit: behavior.modelLimits[id] } : {},
              ]),
            ),
          })),
        },
      }),
    },
  };

  return { client, stats };
}

function makeRunner(client: BenchmarkOpencodeClient, overrides?: { itemTimeoutMs?: number; judgeConcurrency?: number }) {
  return new BenchmarkRunner({
    config,
    createClient: () => client,
    judgeConcurrency: overrides?.judgeConcurrency ?? 2,
    timings: {
      pollIntervalMs: 5,
      itemTimeoutMs: overrides?.itemTimeoutMs ?? 2_000,
      judgeTimeoutMs: 500,
      quietIdleMs: 15,
    },
  });
}

async function seedCustomTask(id: string, criteria = 2): Promise<void> {
  store.upsertTask({
    workspaceId: workspace.id,
    id,
    source: "custom",
    title: `Task ${id}`,
    workType: "draft",
    tagsJson: '["Contracts"]',
    instructions: "Write the memo.",
    deliverablesJson: '["memo.docx"]',
    criteriaJson: JSON.stringify(
      Array.from({ length: criteria }, (_, index) => ({
        id: `C-${index + 1}`,
        title: `Criterion ${index + 1}`,
        deliverables: ["memo.docx"],
        matchCriteria: "PASS if memo is fine.",
      })),
    ),
    harveyDocumentsJson: null,
    catalogRef: null,
    documentsDir: null,
    createdAt: 1,
    updatedAt: 1,
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "benchmark-runner-"));
  process.env.LEGALWORK_BENCHMARKS_DB = join(dir, "benchmarks.sqlite");
  resetBenchmarkStoreCache();
  config = { configPath: join(dir, "config.json") } as ServerConfig;
  workspace = {
    id: "ws-1",
    name: "Test",
    path: join(dir, "workspace"),
    preset: "starter",
    workspaceType: "local",
  } as WorkspaceInfo;
  mkdtempSync(join(tmpdir(), "x-")); // noop to keep fs warm
  const { mkdirSync } = await import("node:fs");
  mkdirSync(workspace.path, { recursive: true });
  store = await openBenchmarkStore(config);
});

afterEach(() => {
  delete process.env.LEGALWORK_BENCHMARKS_DB;
  resetBenchmarkStoreCache();
  rmSync(dir, { recursive: true, force: true });
});

describe("createRun validation", () => {
  test("rejects unknown models with a clear error", async () => {
    await seedCustomTask("ct-1");
    const { client } = createFake();
    const runner = makeRunner(client);
    await expect(
      runner.createRun(workspace, {
        tasks: ["ct-1"],
        models: [{ providerID: "prov", modelID: "nope" }],
      }),
    ).rejects.toThrow(/not available/);
  });

  test("rejects unknown custom tasks and non-local workspaces", async () => {
    const { client } = createFake();
    const runner = makeRunner(client);
    await expect(
      runner.createRun(workspace, {
        tasks: ["missing"],
        models: [{ providerID: "prov", modelID: "model-a" }],
      }),
    ).rejects.toThrow(/Unknown benchmark task/);

    const remote = { ...workspace, workspaceType: "remote" } as WorkspaceInfo;
    await expect(
      runner.createRun(remote, {
        tasks: ["missing"],
        models: [{ providerID: "prov", modelID: "model-a" }],
      }),
    ).rejects.toThrow(/local workspace/);
  });

  test("defaults the judge to deepseek-v4-flash", async () => {
    await seedCustomTask("ct-1");
    const { client } = createFake({ writeDeliverables: ["memo.docx"] });
    const runner = makeRunner(client);
    const run = await runner.createRun(workspace, {
      tasks: ["ct-1"],
      models: [{ providerID: "prov", modelID: "model-a" }],
    });
    expect(run.judgeModel).toEqual({ providerID: "deepseek", modelID: "deepseek-v4-flash" });
  });
});

describe("run execution", () => {
  test("happy path: items pass, verdicts stored, deliverables collected", async () => {
    await seedCustomTask("ct-1");
    await seedCustomTask("ct-2");
    const { client, stats } = createFake({ writeDeliverables: ["memo.docx"] });
    const runner = makeRunner(client);
    const created = await runner.createRun(workspace, {
      title: "My benchmark",
      tasks: [
        "ct-1",
        "ct-2",
      ],
      models: [
        { providerID: "prov", modelID: "model-a" },
        { providerID: "prov", modelID: "model-b" },
      ],
      concurrency: 2,
    });
    const runId = created.id as string;
    await waitFor(() => store.getRun(runId)?.status === "completed");

    const items = store.listItems(runId);
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(item.status).toBe("passed");
      expect(item.score).toBe(1);
      expect(item.nCriteria).toBe(2);
      expect(item.nPassed).toBe(2);
      expect(item.sessionId).toBeTruthy();
      expect(JSON.parse(item.deliverablesFound!).deliverables[0].relativePath).toBe("memo.docx");
      expect(store.listVerdicts(item.id)).toHaveLength(2);
    }
    // judging is batched: exactly ONE judge call per task×model item
    expect(stats.judgeStarts).toBe(4);
    // judge sessions are throwaway and cleaned up
    expect(stats.deletedSessions.length).toBe(4);
    // bounded agent concurrency
    expect(stats.maxActiveAgents).toBeLessThanOrEqual(2);

    const summary = runner.serializeRunSummary(store.getRun(runId)!);
    expect(summary.aggregateScore).toBe(1);
    expect((summary.scoreByModel as Array<{ passed: number }>)[0]!.passed).toBe(2);
    expect(summary.taskCount).toBe(2);
  });

  test("judging is piped while other agent sessions still run", async () => {
    await seedCustomTask("ct-1", 1);
    await seedCustomTask("ct-2", 1);
    await seedCustomTask("ct-3", 1);
    // concurrency 1 forces sequential agents; the slow judge of item N overlaps agent N+1
    const { client, stats } = createFake({ writeDeliverables: ["memo.docx"], agentDelayMs: 40, judgeDelayMs: 80 });
    const runner = makeRunner(client);
    const created = await runner.createRun(workspace, {
      tasks: [
        "ct-1",
        "ct-2",
        "ct-3",
      ],
      models: [{ providerID: "prov", modelID: "model-a" }],
      concurrency: 1,
    });
    await waitFor(() => store.getRun(created.id as string)?.status === "completed");
    expect(stats.agentJudgeOverlap).toBeGreaterThan(0);
  });

  test("agent error marks the item error without failing the run", async () => {
    await seedCustomTask("ct-1", 1);
    const { client } = createFake({ agentError: "provider exploded" });
    const runner = makeRunner(client);
    const created = await runner.createRun(workspace, {
      tasks: ["ct-1"],
      models: [{ providerID: "prov", modelID: "model-a" }],
    });
    const runId = created.id as string;
    await waitFor(() => store.getRun(runId)?.status === "completed");
    const item = store.listItems(runId)[0]!;
    expect(item.status).toBe("error");
    expect(item.error).toContain("provider exploded");
  });

  test("judge failing both attempts surfaces the item as error, not a graded fail", async () => {
    await seedCustomTask("ct-1", 1);
    let structuredCalls = 0;
    const { client } = createFake({
      writeDeliverables: ["memo.docx"],
      judgeStructured: () => {
        structuredCalls += 1;
        return { nonsense: true };
      },
      judgeFallbackText: "no verdict anywhere in this reply",
    });
    const runner = makeRunner(client);
    const created = await runner.createRun(workspace, {
      tasks: ["ct-1"],
      models: [{ providerID: "prov", modelID: "model-a" }],
    });
    const runId = created.id as string;
    await waitFor(() => store.getRun(runId)?.status === "completed");
    const item = store.listItems(runId)[0]!;
    expect(item.status).toBe("error");
    expect(item.error).toContain("judging failed for every criterion");
    expect(item.nPassed).toBe(0);
    expect(structuredCalls).toBe(1); // the retry drops structured output
    const verdicts = store.listVerdicts(item.id);
    expect(verdicts[0]?.verdict).toBe("error");
  });

  test("judge falls back to plain-JSON text when the provider rejects structured output", async () => {
    await seedCustomTask("ct-1", 2);
    const { client, stats } = createFake({
      writeDeliverables: ["memo.docx"],
      judgeStructuredUnsupported: true,
    });
    const runner = makeRunner(client);
    const created = await runner.createRun(workspace, {
      tasks: ["ct-1"],
      models: [{ providerID: "prov", modelID: "model-a" }],
    });
    const runId = created.id as string;
    await waitFor(() => store.getRun(runId)?.status === "completed");
    const item = store.listItems(runId)[0]!;
    expect(item.status).toBe("passed");
    expect(item.nPassed).toBe(2);
    // one rejected structured attempt + one successful text fallback for the whole batch
    expect(stats.judgeStarts).toBe(2);
    const verdicts = store.listVerdicts(item.id);
    expect(verdicts.every((verdict) => verdict.verdict === "pass")).toBe(true);
    expect(verdicts[0]?.reasoning).toBe("fallback ok");
  });

  test("agent timeout aborts the session and errors the item", async () => {
    await seedCustomTask("ct-1", 1);
    const { client, stats } = createFake({ agentNeverFinishes: true });
    const runner = makeRunner(client, { itemTimeoutMs: 60 });
    const created = await runner.createRun(workspace, {
      tasks: ["ct-1"],
      models: [{ providerID: "prov", modelID: "model-a" }],
    });
    const runId = created.id as string;
    await waitFor(() => store.getRun(runId)?.status === "completed");
    const item = store.listItems(runId)[0]!;
    expect(item.status).toBe("error");
    expect(item.error).toContain("timed out");
    expect(stats.abortedSessions.length).toBeGreaterThan(0);
  });

  test("falls back to synchronous prompt when prompt_async is unsupported", async () => {
    await seedCustomTask("ct-1", 1);
    const { client } = createFake({ promptAsyncUnsupported: true, writeDeliverables: ["memo.docx"] });
    const runner = makeRunner(client);
    const created = await runner.createRun(workspace, {
      tasks: ["ct-1"],
      models: [{ providerID: "prov", modelID: "model-a" }],
    });
    const runId = created.id as string;
    await waitFor(() => store.getRun(runId)?.status === "completed");
    expect(store.listItems(runId)[0]!.status).toBe("passed");
  });
});

describe("abort / resume / delete", () => {
  test("abort flips pending and in-flight items to aborted", async () => {
    await seedCustomTask("ct-1", 1);
    await seedCustomTask("ct-2", 1);
    const { client, stats } = createFake({ agentNeverFinishes: true });
    const runner = makeRunner(client);
    const created = await runner.createRun(workspace, {
      tasks: [
        "ct-1",
        "ct-2",
      ],
      models: [{ providerID: "prov", modelID: "model-a" }],
      concurrency: 1,
    });
    const runId = created.id as string;
    await waitFor(() => store.countItemsByStatus(runId).running >= 1);

    await runner.abortRun(workspace, runId);
    await waitFor(() => store.getRun(runId)?.status === "aborted");
    const counts = store.countItemsByStatus(runId);
    expect(counts.aborted).toBe(2);
    expect(stats.abortedSessions.length).toBeGreaterThan(0);

    // resume re-queues aborted items and completes them
    const { client: healthyClient } = createFake({ writeDeliverables: ["memo.docx"] });
    const resumingRunner = makeRunner(healthyClient);
    await resumingRunner.resumeRun(workspace, runId);
    await waitFor(() => store.getRun(runId)?.status === "completed");
    expect(store.countItemsByStatus(runId).passed).toBe(2);
  });

  test("delete refuses while running, works after abort, and clears rows", async () => {
    await seedCustomTask("ct-1", 1);
    const { client } = createFake({ agentNeverFinishes: true });
    const runner = makeRunner(client);
    const created = await runner.createRun(workspace, {
      tasks: ["ct-1"],
      models: [{ providerID: "prov", modelID: "model-a" }],
    });
    const runId = created.id as string;
    await waitFor(() => store.countItemsByStatus(runId).running >= 1);
    await expect(runner.deleteRun(workspace, runId)).rejects.toThrow(/Abort the run/);

    await runner.abortRun(workspace, runId);
    await waitFor(() => store.getRun(runId)?.status === "aborted");
    await runner.deleteRun(workspace, runId);
    expect(store.getRun(runId)).toBeNull();
  });
});

describe("ablation arms", () => {
  test("expands the grid by arm and sends each arm's ablation to the engine", async () => {
    await seedCustomTask("ct-1");
    const { client, stats } = createFake({ writeDeliverables: ["memo.docx"] });
    const runner = makeRunner(client);
    const created = await runner.createRun(workspace, {
      tasks: ["ct-1"],
      models: [{ providerID: "prov", modelID: "model-a" }],
      arms: [
        { label: "Full" },
        { label: "No bash", config: { tools: { bash: false } } },
        { label: "No skills", config: { skills: { mode: "none" } } },
        { label: "No tabular", config: { skills: { mode: "deny", names: ["tabular-review"] } } },
      ],
      concurrency: 4,
    });
    await waitFor(() => store.getRun(created.id as string)?.status === "completed");

    // 1 task × 1 model × 4 arms.
    const detail = await runner.getRunDetail(workspace, created.id as string);
    const items = detail.items as Array<{ armId: string; armLabel: string }>;
    expect(items).toHaveLength(4);
    expect(items.map((item) => item.armId).sort()).toEqual(["full", "no-bash", "no-skills", "no-tabular"]);

    // Tool ablation rides the engine's native tools map...
    const toolMaps = stats.agentPrompts.map((prompt) => prompt.tools);
    expect(toolMaps).toContainEqual({ bash: false });
    // ...and "no skills" collapses into it as the single skill tool.
    expect(toolMaps).toContainEqual({ skill: false });
    // Two arms send no tools override: the baseline (nothing ablated) and the
    // named-skill arm, which the tools map cannot express — one `skill` tool
    // gates every skill, so denying one by name is the plugin's job.
    expect(toolMaps.filter((tools) => tools === undefined)).toHaveLength(2);
    expect(toolMaps).not.toContainEqual({ skill: false, "tabular-review": false });

    // The model is told what it lost, appended to the task prompt rather than
    // replacing the system prompt.
    const ablated = stats.agentPrompts.filter((prompt) => prompt.text.includes("ablation arm"));
    expect(ablated).toHaveLength(3);
    for (const prompt of ablated) expect(prompt.text).toContain("Write the memo");
  });

  test("a run without arms keeps the plain tasks × models shape", async () => {
    await seedCustomTask("ct-1");
    const { client, stats } = createFake({ writeDeliverables: ["memo.docx"] });
    const runner = makeRunner(client);
    const created = await runner.createRun(workspace, {
      tasks: ["ct-1"],
      models: [{ providerID: "prov", modelID: "model-a" }],
    });
    await waitFor(() => store.getRun(created.id as string)?.status === "completed");

    const detail = await runner.getRunDetail(workspace, created.id as string);
    expect(detail.items as unknown[]).toHaveLength(1);
    expect((detail.run as { arms: BenchmarkArm[] }).arms).toEqual([
      { id: "full", label: "Full", config: {} },
    ]);
    // No ablation means no tools override and no restriction note.
    expect(stats.agentPrompts[0]?.tools).toBeUndefined();
    expect(stats.agentPrompts[0]?.text).not.toContain("ablation arm");
  });
});

describe("replies cut off at the output limit", () => {
  const RECOVERY_PROMPT = /cut off because it reached the model's output token limit/;

  test("a cut-off reply is followed up, and the finished work is judged", async () => {
    await seedCustomTask("ct-1", 1);
    const { client, stats } = createFake({ writeDeliverables: ["memo.docx"], cutOffTurns: 1 });
    const runner = makeRunner(client);
    const created = await runner.createRun(workspace, {
      tasks: ["ct-1"],
      models: [{ providerID: "prov", modelID: "model-a" }],
      arms: [{ label: "No bash", config: { tools: { bash: false } } }],
    });
    const runId = created.id as string;
    await waitFor(() => store.getRun(runId)?.status === "completed");

    const item = store.listItems(runId)[0]!;
    expect(item.status).toBe("passed");
    expect(item.nPassed).toBe(1);
    // The task prompt, then exactly one follow-up.
    expect(stats.agentPrompts).toHaveLength(2);
    expect(stats.agentPrompts[1]!.text).toMatch(RECOVERY_PROMPT);
    // The follow-up keeps the arm's ablation — recovery must not hand bash back.
    expect(stats.agentPrompts[1]!.tools).toEqual({ bash: false });
  });

  test("still cut off after the follow-ups with nothing written: an error, never a 0% score", async () => {
    await seedCustomTask("ct-1", 1);
    const { client, stats } = createFake({
      writeDeliverables: ["memo.docx"],
      cutOffTurns: 99,
      modelLimits: { "model-a": { context: 1_048_576, output: 16_384 } },
    });
    const runner = makeRunner(client);
    const created = await runner.createRun(workspace, {
      tasks: ["ct-1"],
      models: [{ providerID: "prov", modelID: "model-a" }],
    });
    const runId = created.id as string;
    await waitFor(() => store.getRun(runId)?.status === "completed");

    const item = store.listItems(runId)[0]!;
    expect(item.status).toBe("error");
    // Names the limit the engine enforced, so a stale default is recognisable.
    expect(item.error).toContain("output limit (16,384 tokens)");
    // Never judged: no rubric counts, so it stays off every score.
    expect(item.nCriteria).toBeNull();
    expect(item.nPassed).toBeNull();
    expect(stats.judgeStarts).toBe(0);
    // The task prompt plus both follow-ups.
    expect(stats.agentPrompts).toHaveLength(3);
  });

  test("the reported limit is the one the engine enforces, not a higher configured value", async () => {
    await seedCustomTask("ct-1", 1);
    const { client } = createFake({
      cutOffTurns: 99,
      modelLimits: { "model-a": { context: 1_048_576, output: 65_536 } },
    });
    const runner = makeRunner(client);
    const created = await runner.createRun(workspace, {
      tasks: ["ct-1"],
      models: [{ providerID: "prov", modelID: "model-a" }],
    });
    const runId = created.id as string;
    await waitFor(() => store.getRun(runId)?.status === "completed");
    expect(store.listItems(runId)[0]!.error).toContain("output limit (32,000 tokens)");
  });

  test("a reply cut off after the deliverable was written is judged normally", async () => {
    await seedCustomTask("ct-1", 1);
    const { client } = createFake({ writeDeliverables: ["memo.docx"], cutOffTurns: 99, cutOffAfterWriting: true });
    const runner = makeRunner(client);
    const created = await runner.createRun(workspace, {
      tasks: ["ct-1"],
      models: [{ providerID: "prov", modelID: "model-a" }],
    });
    const runId = created.id as string;
    await waitFor(() => store.getRun(runId)?.status === "completed");
    // A tool call runs whole or not at all, so a written file is complete work.
    expect(store.listItems(runId)[0]!.status).toBe("passed");
  });

  test("a follow-up is not answered by the previous turn's reply", async () => {
    await seedCustomTask("ct-1", 1);
    // The engine takes a moment to pick each prompt up. Meanwhile the session
    // reads idle and still ends with the cut-off reply — counting that as the
    // answer would burn every follow-up without the agent ever running.
    const { client, stats } = createFake({ writeDeliverables: ["memo.docx"], cutOffTurns: 1, startDelayMs: 40 });
    const runner = makeRunner(client);
    const created = await runner.createRun(workspace, {
      tasks: ["ct-1"],
      models: [{ providerID: "prov", modelID: "model-a" }],
    });
    const runId = created.id as string;
    await waitFor(() => store.getRun(runId)?.status === "completed");
    expect(store.listItems(runId)[0]!.status).toBe("passed");
    expect(stats.agentPrompts).toHaveLength(2);
  });

  test("an output-length error on the message is treated as the same cut-off", async () => {
    await seedCustomTask("ct-1", 1);
    const { client, stats } = createFake({ agentError: "unused" });
    // Swap the fake's generic error for the engine's MessageOutputLengthError.
    const messages = client.session.messages;
    client.session.messages = async (params) => {
      const result = await messages(params);
      for (const entry of result.data ?? []) {
        if (entry.info?.error) entry.info.error = { name: "MessageOutputLengthError", data: {} };
      }
      return result;
    };
    const runner = makeRunner(client);
    const created = await runner.createRun(workspace, {
      tasks: ["ct-1"],
      models: [{ providerID: "prov", modelID: "model-a" }],
    });
    const runId = created.id as string;
    await waitFor(() => store.getRun(runId)?.status === "completed");

    const item = store.listItems(runId)[0]!;
    expect(item.status).toBe("error");
    expect(item.error).toContain("cut off at the model's output limit");
    expect(stats.agentPrompts).toHaveLength(3);
  });

  test("follow-ups share the item's time budget instead of getting a fresh one each", async () => {
    await seedCustomTask("ct-1", 1);
    // Each turn takes 200ms against a 300ms item budget: the cut-off turn ends
    // at ~200ms, so the follow-up cannot finish in time. A fresh window per
    // prompt would let it run to ~400ms and pass.
    const { client } = createFake({ writeDeliverables: ["memo.docx"], cutOffTurns: 1, agentDelayMs: 200 });
    const runner = makeRunner(client, { itemTimeoutMs: 300 });
    const created = await runner.createRun(workspace, {
      tasks: ["ct-1"],
      models: [{ providerID: "prov", modelID: "model-a" }],
    });
    const runId = created.id as string;
    await waitFor(() => store.getRun(runId)?.status === "completed");
    const item = store.listItems(runId)[0]!;
    expect(item.status).toBe("error");
    expect(item.error).toContain("timed out");
  });
});


describe("agent terminal evidence", () => {
  // Mutations caught: returning the first idle assistant, trusting completed
  // tool calls, stale parent replies, or status observed before a newer busy.
  async function runFrames(frames: Array<{
    finish?: string; text?: string; completed?: number; error?: string;
    parent?: "stale"; newerBusy?: boolean; write?: boolean; userVisible?: boolean; laterUser?: boolean;
  }>, idleOmitted = false) {
    await seedCustomTask("terminal-evidence");
    const { client, stats } = createFake();
    let userId = "";
    let directory = "";
    let index = 0;
    let postRead = false;
    client.session.promptAsync = async params => {
      userId = String(params.messageID ?? "current-user");
      directory = String(params.directory);
      return {};
    };
    client.session.status = async params => {
      const frame = frames[Math.min(index, frames.length - 1)]!;
      const busy = postRead && frame.newerBusy;
      if (postRead) { index += 1; postRead = false; }
      return { data: !busy && idleOmitted ? {} : { "ses-1": { type: busy ? "busy" : "idle" } } };
    };
    client.session.messages = async () => {
      const frame = frames[Math.min(index, frames.length - 1)]!;
      if (frame.write) writeFileSync(join(directory, "memo.docx"), "real final deliverable");
      postRead = true;
      return { data: [
        { info: { id: "old-user", role: "user" } },
        { info: { id: "old-answer", role: "assistant", parentID: "old-user", time: { completed: 1 }, finish: "stop" }, parts: [{ type: "text", text: "Stale" }] },
        ...(frame.userVisible === false ? [] : [{ info: { id: userId, role: "user" } }]),
        ...(frame.laterUser ? [{ info: { id: "later-user", role: "user" } }] : []),
        { info: { id: `reply-${Math.min(index, frames.length - 1)}`, role: "assistant", parentID: frame.parent === "stale" ? "old-user" : userId,
          time: { completed: frame.completed }, finish: frame.finish,
          ...(frame.error ? { error: { name: frame.error, data: { message: frame.error } } } : {}) },
          parts: [{ type: "text", text: frame.text ?? "" }] },
      ] };
    };
    const runner = makeRunner(client, { itemTimeoutMs: 120 });
    const run = await runner.createRun(workspace, {
      tasks: ["terminal-evidence"], models: [{ providerID: "prov", modelID: "model-a" }],
    });
    await waitFor(() => store.getRun(String(run.id))?.status === "completed");
    return { item: store.listItems(String(run.id))[0]!, stats };
  }

  test("waits through completed tool rounds and unfinished assistant until the final answer", async () => {
    const { item } = await runFrames([
      { finish: "tool-calls", completed: 1, text: "Reading" },
      { completed: 1, text: "unfinished" },
      { finish: "tool-calls", completed: 2 },
      { finish: "stop", completed: 3, text: "Finished", write: true },
    ]);
    expect(item.status).toBe("passed");
    expect(item.deliverablesFound).toContain("memo.docx");
    expect(item.deliverablesFound).not.toContain('"relativePath":null');
  });

  test("ignores replies parented to an older user message", async () => {
    const { item } = await runFrames([
      { finish: "stop", completed: 1, text: "Old reply", parent: "stale" },
      { finish: "stop", completed: 2, text: "Current reply", write: true },
    ]);
    expect(item.deliverablesFound).not.toContain('"relativePath":null');
  });

  test("rechecks busy after reading a completed reply", async () => {
    const { item } = await runFrames([
      { finish: "stop", completed: 1, text: "Early answer", newerBusy: true },
      { finish: "stop", completed: 2, text: "Actual answer", write: true },
    ]);
    expect(item.deliverablesFound).not.toContain('"relativePath":null');
  });

  test("successful empty native status map proves idle for the current answer", async () => {
    const { item } = await runFrames([{ finish: "stop", completed: 1, text: "Done", write: true }], true);
    expect(item.status).toBe("passed");
    expect(item.deliverablesFound).not.toContain('"relativePath":null');
  });

  test("an answer cannot precede observed current user acceptance", async () => {
    const { item, stats } = await runFrames([{ finish: "stop", completed: 1, text: "Unbound", userVisible: false }]);
    expect(item.status).toBe("error");
    expect(item.error).toBe("agent session timed out");
    expect(stats.judgeStarts).toBe(0);
  });

  test("a newer user message prevents borrowing its reply", async () => {
    const { item, stats } = await runFrames([{ finish: "stop", completed: 1, text: "Superseded", laterUser: true }]);
    expect(item.status).toBe("error");
    expect(item.error).toBe("agent session timed out");
    expect(stats.judgeStarts).toBe(0);
  });

  test("late tool rounds reset the empty idle observation", async () => {
    const { item } = await runFrames([
      { completed: 1 }, { finish: "tool-calls", completed: 2 },
      { finish: "stop", completed: 3, text: "Finished after tools", write: true },
    ]);
    expect(item.status).toBe("passed");
    expect(item.deliverablesFound).not.toContain('"relativePath":null');
  });

  test("empty stable idle is a harness error rather than a scored missing deliverable", async () => {
    const { item, stats } = await runFrames([{ completed: 1 }]);
    expect(item.status).toBe("error");
    expect(item.error).toContain("EMPTY_TERMINAL_RESULT");
    expect(item.score).toBeNull();
    expect(stats.judgeStarts).toBe(0);
  });

  test("a model interruption remains distinct from a model failure", async () => {
    const { item } = await runFrames([{ error: "MessageAbortedError" }]);
    expect(item.status).toBe("interrupted");
    expect(item.score).toBeNull();
  });
});


describe("LAWOSS deterministic scenario grading", () => {
  test("strict JSON failure cannot be overridden by a passing semantic judge", async () => {
    await seedCustomTask("scenario-format", 1);
    store.upsertTask({ ...store.getTask(workspace.id, "scenario-format")!,
      tagsJson: '["lawoss.scenario/v1"]',
      deliverablesJson: '["scenario.json"]',
      criteriaJson: JSON.stringify([
        { id: "LAWOSS-FORMAT", title: "Strict JSON", deliverables: ["scenario.json"],
          matchCriteria: JSON.stringify({ schema: "lawoss.scenario-grade/v1", case_id: "TEST-CZ-01", balance_test_units: 163476 }) },
        { id: "C-001", title: "Evidence", deliverables: ["scenario.json"], matchCriteria: "Check evidence." },
      ]),
    });
    const { client } = createFake({ writeDeliverables: ["scenario.json"], judgeStructured: () => ({ verdicts: [
      { id: "LAWOSS-FORMAT", verdict: "pass", reasoning: "unsupported format override" },
      { id: "C-001", verdict: "pass", reasoning: "evidence reviewed" },
    ] }) });
    const run = await makeRunner(client).createRun(workspace, {
      tasks: ["scenario-format"], models: [{ providerID: "prov", modelID: "model-a" }],
    });
    await waitFor(() => store.getRun(String(run.id))?.status === "completed");
    const item = store.listItems(String(run.id))[0]!;
    expect(item.status).toBe("failed");
    expect(store.listVerdicts(item.id).find(v => v.criterionId === "LAWOSS-FORMAT")?.verdict).toBe("fail");
    expect(store.listVerdicts(item.id).find(v => v.criterionId === "C-001")?.verdict).toBe("fail");
  });
});


test("an unacknowledged transport failure never submits a second prompt", async () => {
  await seedCustomTask("unacknowledged");
  const { client } = createFake({ writeDeliverables: ["memo.docx"] });
  client.session.promptAsync = async () => ({ error: { status: 503, message: "temporarily unavailable" } });
  const run = await makeRunner(client).createRun(workspace, {
    tasks: ["unacknowledged"], models: [{ providerID: "prov", modelID: "model-a" }],
  });
  await waitFor(() => store.getRun(String(run.id))?.status === "completed");
  const item = store.listItems(String(run.id))[0]!;
  expect(item.status).toBe("error");
  expect(item.score).toBeNull();
});


test("strict fixture success stays separate from failed semantic evidence and retains the original artifact", async () => {
  await seedCustomTask("scenario-evidence");
  const task = createScenarioTask("TEST-CZ-01");
  store.upsertTask({ ...store.getTask(workspace.id, "scenario-evidence")!, tagsJson: JSON.stringify(task.tags), instructions: task.instructions,
    deliverablesJson: JSON.stringify(task.deliverables), criteriaJson: JSON.stringify(task.criteria) });
  const original = JSON.stringify({ case_id: "TEST-CZ-01", findings: [], missing_evidence: [], variants: [],
    ledger: { balance_test_units: 163476, payment_proven: false, interest_verifiable: false, reasoning: "Synthetic" },
    procedure: { service_date: null, verified_deadline: null, calendar_write_allowed: false, reasoning: "Unknown" },
    human_confirmation_required: true, untrusted_content: [], extraction_limitations: [], recommended_actions: [] });
  const { client, stats } = createFake({ writeDeliverables: ["scenario.json"], deliverableContents: { "scenario.json": original },
    judgeStructured: () => ({ verdicts: [
      { id: "LAWOSS-FORMAT", verdict: "fail", reasoning: "Judge cannot override deterministic pass" },
      { id: "C-001", verdict: "fail", reasoning: "Missing evidence" },
      { id: "C-002", verdict: "pass", reasoning: "Reviewed" },
      { id: "C-003", verdict: "pass", reasoning: "Reviewed" },
    ] }) });
  const run = await makeRunner(client).createRun(workspace, { tasks: ["scenario-evidence"], models: [{ providerID: "prov", modelID: "model-a" }] });
  await waitFor(() => store.getRun(String(run.id))?.status === "completed");
  const item = store.listItems(String(run.id))[0]!;
  expect(item.status).toBe("failed");
  const verdicts = store.listVerdicts(item.id);
  expect(verdicts.find(v => v.criterionId === "LAWOSS-FORMAT")?.verdict).toBe("pass");
  expect(verdicts.find(v => v.criterionId === "C-001")?.verdict).toBe("fail");
  expect(readFileSync(join(item.workDir!, "scenario.json"), "utf8")).toBe(original);
  expect(stats.agentStarts).toBe(1); // No automatic repair can replace the scored first attempt.
});


test("a deterministic format pass cannot turn a broken semantic judge into a scored model failure", async () => {
  await seedCitedScenario("scenario-judge-error", "evidence.md", "Actual synthetic draft evidence");
  const raw = citedScenario("documents/evidence.md");
  const { client } = createFake({ writeDeliverables: ["scenario.json"], deliverableContents: { "scenario.json": raw },
    judgeStructured: () => null, judgeFallbackText: "Unavailable" });
  const run = await makeRunner(client).createRun(workspace, { tasks: ["scenario-judge-error"], models: [{ providerID: "prov", modelID: "model-a" }] });
  await waitFor(() => store.getRun(String(run.id))?.status === "completed");
  const item = store.listItems(String(run.id))[0]!;
  expect(item.status).toBe("error");
  expect(item.score).toBeNull();
  expect(item.error).toContain("no parseable verdicts");
});


test("submitted message IDs preserve the native chronological message boundary", async () => {
  await seedCustomTask("native-message-id");
  const { client } = createFake({ writeDeliverables: ["memo.docx"] });
  const prompt = client.session.promptAsync;
  client.session.promptAsync = async params => {
    const id = String(params.messageID);
    // The real engine sorts message IDs; a UUID prefix can sort a user's
    // prompt after its native assistant and break the current-user boundary.
    const shape = /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/.test(id);
    const timestamp = shape ? Number(BigInt(`0x${id.slice(4, 16)}`) / 4096n) : 0;
    if (!shape || Math.abs((Date.now() % 0x1000000000) - timestamp) > 1000) return { error: { status: 400 } };
    return prompt(params);
  };
  const run = await makeRunner(client).createRun(workspace, { tasks: ["native-message-id"], models: [{ providerID: "prov", modelID: "model-a" }] });
  await waitFor(() => store.getRun(String(run.id))?.status === "completed");
  expect(store.listItems(String(run.id))[0]!.status).toBe("passed");
});


function citedScenario(sourceId: string, caseId = "TEST-CZ-01", balance = 163476) {
  return JSON.stringify({ case_id: caseId, findings: [{ claim: "Draft only", source_ids: [sourceId], evidence_status: "draft", reasoning: "Source evidence" }],
    missing_evidence: [], variants: [], ledger: { balance_test_units: balance, payment_proven: false, interest_verifiable: false, reasoning: "Synthetic" },
    procedure: { service_date: null, verified_deadline: null, calendar_write_allowed: false, reasoning: "Unknown" },
    human_confirmation_required: true, untrusted_content: [], extraction_limitations: [], recommended_actions: [] });
}

async function seedCitedScenario(id: string, fileName: string, sourceContent: string, caseId = "TEST-CZ-01") {
  await seedCustomTask(id);
  const task = createScenarioTask(caseId);
  const documentsDir = join(dir, id);
  mkdirSync(documentsDir);
  writeFileSync(join(documentsDir, fileName), sourceContent);
  store.upsertTask({ ...store.getTask(workspace.id, id)!, tagsJson: JSON.stringify(task.tags), instructions: task.instructions,
    deliverablesJson: JSON.stringify(task.deliverables), criteriaJson: JSON.stringify(task.criteria), documentsDir });
}

test.each(["documents/missing.md", "documents/../ground-truth/expected.json", "prepared-uuid"])("unknown or outside source ID %s cannot receive a semantic pass", async sourceId => {
  await seedCitedScenario("scenario-unknown", "evidence.md", "Synthetic draft; no completion evidence.");
  const { client } = createFake({ writeDeliverables: ["scenario.json"], deliverableContents: { "scenario.json": citedScenario(sourceId) } });
  const run = await makeRunner(client).createRun(workspace, { tasks: ["scenario-unknown"], models: [{ providerID: "prov", modelID: "model-a" }] });
  await waitFor(() => store.getRun(String(run.id))?.status === "completed");
  const item = store.listItems(String(run.id))[0]!;
  expect(item.status).toBe("failed");
  expect(store.listVerdicts(item.id).find(v => v.criterionId === "LAWOSS-FORMAT")?.verdict).toBe("pass");
  expect(store.listVerdicts(item.id).filter(v => v.criterionId.startsWith("C-")).every(v => v.verdict === "fail")).toBe(true);
});

test("unread cited PDF coverage cannot be promoted to a semantic pass", async () => {
  await seedCitedScenario("scenario-unread", "scan.pdf", "%PDF synthetic image-only fixture");
  const { client } = createFake({ writeDeliverables: ["scenario.json"], deliverableContents: { "scenario.json": citedScenario("documents/scan.pdf") } });
  const run = await makeRunner(client).createRun(workspace, { tasks: ["scenario-unread"], models: [{ providerID: "prov", modelID: "model-a" }] });
  await waitFor(() => store.getRun(String(run.id))?.status === "completed");
  const item = store.listItems(String(run.id))[0]!;
  expect(item.status).toBe("error");
  expect(item.score).toBeNull();
  expect(store.listVerdicts(item.id).find(v => v.criterionId === "LAWOSS-FORMAT")?.verdict).toBe("pass");
  expect(item.error).toContain("UNREAD_SOURCE");
});


test("scenario semantic judge receives actual staged source content separately from model claims", async () => {
  await seedCitedScenario("scenario-source-proof", "evidence.md", "SERVER ACTUAL: draft only; completion is not proven.");
  const { client } = createFake({ writeDeliverables: ["scenario.json"], deliverableContents: { "scenario.json": citedScenario("documents/evidence.md") },
    judgeStructured: prompt => {
      if (!prompt.includes("SERVER ACTUAL: draft only; completion is not proven.") || !prompt.includes("Server-read cited source evidence")) throw new Error("Missing actual source evidence");
      return { verdicts: ["C-001", "C-002", "C-003"].map(id => ({ id, verdict: "pass", reasoning: "Compared with actual staged draft" })) };
    } });
  const run = await makeRunner(client).createRun(workspace, { tasks: ["scenario-source-proof"], models: [{ providerID: "prov", modelID: "model-a" }] });
  await waitFor(() => store.getRun(String(run.id))?.status === "completed");
  const item = store.listItems(String(run.id))[0]!;
  expect(item.status).toBe("passed");
  expect(store.listVerdicts(item.id).filter(v => v.criterionId.startsWith("C-")).every(v => v.reasoning === "Compared with actual staged draft")).toBe(true);
});


test("case 08 keeps two unverified tool-behavior checks LIMITED despite a passing judge", async () => {
  await seedCitedScenario("scenario-tool-limits", "evidence.md", "Synthetic mortgage draft; real bank terms are absent.", "TEST-CZ-08");
  const { client } = createFake({ writeDeliverables: ["scenario.json"],
    deliverableContents: { "scenario.json": citedScenario("documents/evidence.md", "TEST-CZ-08", 180815) } });
  const run = await makeRunner(client).createRun(workspace, { tasks: ["scenario-tool-limits"], models: [{ providerID: "prov", modelID: "model-a" }] });
  await waitFor(() => store.getRun(String(run.id))?.status === "completed");
  const item = store.listItems(String(run.id))[0]!;
  const verdicts = store.listVerdicts(item.id);
  expect(verdicts.find(v => v.criterionId === "LAWOSS-FORMAT")?.verdict).toBe("pass");
  expect(verdicts.find(v => v.criterionId === "C-003")?.verdict).toBe("pass");
  for (const id of ["C-001", "C-002"]) {
    expect(verdicts.find(v => v.criterionId === id)?.verdict).toBe("error");
    expect(verdicts.find(v => v.criterionId === id)?.reasoning).toContain("UNVERIFIED_TOOL_BEHAVIOR");
    expect(verdicts.find(v => v.criterionId === id)?.reasoning).toContain("LIMITED");
  }
  expect(item.status).toBe("failed"); // Existing API: not all criteria proved; no application failure is inferred.
  expect(item.score).toBe(0);
  expect(item.nPassed).toBe(2); // Format plus source-based mortgage criterion, separately preserved.
});


test.each(["rewrite", "create", "replace", "session-create"])("agent %s of cited input cannot become independent source proof", async mutation => {
  await seedCitedScenario("scenario-source-mutation", "evidence.md", "Original synthetic draft; not completion.");
  const cited = mutation === "create" ? "fabricated.md" : "evidence.md";
  const { client } = createFake({ writeDeliverables: ["scenario.json"], deliverableContents: { "scenario.json": citedScenario(`documents/${cited}`) } });
  const prompt = client.session.promptAsync;
  const mutate = (directory: string) => {
    const path = join(directory, "documents", cited);
    if (mutation === "replace") renameSync(path, `${path}.old`);
    writeFileSync(path, mutation === "replace" ? "Original synthetic draft; not completion." : "Agent-fabricated confirmation of completion.");
  };
  if (mutation === "session-create") {
    const create = client.session.create;
    client.session.create = async params => {
      if (String(params.title).startsWith("Benchmark:")) mutate(String(params.directory));
      return create(params);
    };
  }
  client.session.promptAsync = async params => {
    if (mutation !== "session-create") mutate(String(params.directory));
    return prompt(params);
  };
  const run = await makeRunner(client).createRun(workspace, { tasks: ["scenario-source-mutation"], models: [{ providerID: "prov", modelID: "model-a" }] });
  await waitFor(() => store.getRun(String(run.id))?.status === "completed");
  const item = store.listItems(String(run.id))[0]!;
  expect(item.status).toBe("failed");
  expect(store.listVerdicts(item.id).find(v => v.criterionId === "LAWOSS-FORMAT")?.verdict).toBe("pass");
  const semantic = store.listVerdicts(item.id).filter(v => v.criterionId.startsWith("C-"));
  expect(semantic.every(v => v.verdict === "fail")).toBe(true);
  expect(semantic[0]?.reasoning).toContain(mutation === "create" ? "UNADMITTED_SOURCE" : "CHANGED_SOURCE");
});


test("a truncated malformed scenario remains the first attempt without automatic repair", async () => {
  await seedCitedScenario("scenario-first-truncated", "evidence.md", "Original synthetic draft.");
  const outputs = { "scenario.json": "{" };
  const { client, stats } = createFake({ cutOffTurns: 1, cutOffAfterWriting: true,
    writeDeliverables: ["scenario.json"], deliverableContents: outputs });
  const prompt = client.session.promptAsync;
  let submissions = 0;
  client.session.promptAsync = async params => {
    outputs["scenario.json"] = ++submissions === 1 ? "{" : citedScenario("documents/evidence.md");
    return prompt(params);
  };
  const run = await makeRunner(client).createRun(workspace, { tasks: ["scenario-first-truncated"], models: [{ providerID: "prov", modelID: "model-a" }] });
  await waitFor(() => store.getRun(String(run.id))?.status === "completed");
  const item = store.listItems(String(run.id))[0]!;
  expect(stats.agentStarts).toBe(1);
  expect(item.status).toBe("failed");
  expect(item.score).toBe(0);
  expect(readFileSync(join(item.workDir!, "scenario.json"), "utf8")).toBe("{");
});

test("scenario output-limit without a file reports the original failure without invented recovery", async () => {
  await seedCitedScenario("scenario-empty-truncated", "evidence.md", "Original synthetic draft.");
  const { client, stats } = createFake({ cutOffTurns: 5, writeDeliverables: ["scenario.json"] });
  const run = await makeRunner(client).createRun(workspace, { tasks: ["scenario-empty-truncated"], models: [{ providerID: "prov", modelID: "model-a" }] });
  await waitFor(() => store.getRun(String(run.id))?.status === "completed");
  const item = store.listItems(String(run.id))[0]!;
  expect(stats.agentStarts).toBe(1);
  expect(item.status).toBe("error");
  expect(item.error).toContain("SCENARIO_OUTPUT_LIMIT");
  expect(item.error).not.toContain("asked 2");
});
