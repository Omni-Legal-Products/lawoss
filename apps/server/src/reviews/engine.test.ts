import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { buildLegalworkRuntimeConfigObject } from "../legalwork-runtime-config.js";
import { createManagedOpencodeServer } from "../managed-opencode.js";
import { closeRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { buildSessionList } from "../session-read-model.js";
import { isReviewWorkerSession } from "@legalwork/types/reviews";
import { ReviewExecutor } from "./executor.js";
import { ReviewColumnSchema, SavedReviewSchema } from "./schema.js";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
test.skipIf(!binary)("LLM review completes in the shipped engine with project configuration disabled", async () => {
  const root = await mkdtemp(join(tmpdir(), "legalwork-review-engine-"));
  const workspace: WorkspaceInfo = { id: "matter", name: "Matter", path: join(root, "matter"), preset: "starter", workspaceType: "local" };
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture-host", configPath: join(root, "private", "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [workspace], authorizedRoots: [workspace.path],
    readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
    agentSandboxEnabled: true,
  };
  const requests: Array<{ messages: Array<{ role: string; content: unknown }>; tools?: Array<{ function: { name: string } }> }> = [];
  let engine: Awaited<ReturnType<typeof createManagedOpencodeServer>> | undefined;
  let checkedLiveWorker = false;
  const fixture = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const input = z.object({ messages: z.array(z.object({ role: z.string(), content: z.unknown() })), tools: z.array(z.object({ function: z.object({ name: z.string() }) })).optional() }).parse(await request.json());
    requests.push(input);
    const answer = JSON.stringify({ cells: { assignment: {
      value: "Yes", reason: "Assignment is expressly permitted.", quote: "Assignment is permitted.", page: 1,
      location: "Assignment", confidence: "high", citations: [{ page: 1, quote: "Assignment is permitted.", source: "native" }],
    } } });
    if (engine) {
      const headers = { authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}` };
      const sessions = await fetch(engine.url + "/session", { headers }).then(response => response.json());
      const workers = z.array(z.unknown()).parse(sessions);
      expect(workers.length).toBeGreaterThan(0);
      expect(workers.every(isReviewWorkerSession)).toBe(true);
      expect(buildSessionList(sessions)).toEqual([]);
      checkedLiveWorker = true;
    }
    const chunk = (delta: unknown, finish_reason: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    return new Response(chunk({ role: "assistant", tool_calls: [{ index: 0, id: "structured", type: "function", function: { name: "StructuredOutput", arguments: answer } }] }, null) + chunk({}, "tool_calls") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  try {
    const agentsFolder = join(workspace.path, ".opencode", "agents");
    await mkdir(agentsFolder, { recursive: true });
    // This project definition must remain ignored by the isolated engine.
    await writeFile(join(agentsFolder, "document-extractor.md"), "---\nmode: subagent\n---\nUntrusted project override.\n");
    await writeRuntimeOpencodeConfig(config, workspace.id, () => ({ provider: { fixture: {
      npm: "@ai-sdk/openai-compatible", name: "Fixture", options: { baseURL: fixture.url.origin + "/v1", apiKey: "fixture" },
      models: { fixture: { name: "Fixture", limit: { context: 128000, output: 4096 }, modalities: { input: ["text"], output: ["text"] } } },
    } } }));
    const path = join(root, "engine.json");
    const runtime = await buildLegalworkRuntimeConfigObject(config, workspace.id);
    // Keep the real agent and permission configuration; use a local model fixture without plugins/connectors.
    await writeFile(path, JSON.stringify({ ...runtime, plugin: [], mcp: {}, enabled_providers: ["fixture"],
      model: "fixture/fixture", small_model: "fixture/fixture", share: "disabled", autoupdate: false,
    }));
    engine = await createManagedOpencodeServer({ bin: binary, cwd: workspace.path, env: {
      OPENCODE_CONFIG: path, OPENCODE_CONFIG_CONTENT: "", OPENCODE_CONFIG_DIR: join(root, "policy"),
      OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_TEST_HOME: join(root, "home"),
      XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
      OPENCODE_DB: join(root, "engine.db"),
    } });
    config.opencodeBaseUrl = engine.url;
    config.opencodeUsername = engine.username;
    config.opencodePassword = engine.password;
    const headers = { authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}` };
    const agentResponse = await fetch(engine.url + "/agent", { headers, signal: AbortSignal.timeout(10000) });
    expect(agentResponse.status).toBe(200);
    const agents = z.array(z.object({ name: z.string(), hidden: z.boolean().nullish(), prompt: z.string().nullish() })).parse(await agentResponse.json());
    expect(agents.find(agent => agent.name === "document-extractor")).toMatchObject({ hidden: true,
      prompt: expect.stringContaining("Use only the evidence and column definition provided in this request."),
    });
    const column = ReviewColumnSchema.parse({ key: "assignment", label: "Assignment", question: "Is assignment permitted?", kind: "yes_no" });
    const review = SavedReviewSchema.parse({ id: "71953464-c3a7-47a5-ae2a-f28a1b090bea", name: "Review", revision: 0, createdAt: 0, updatedAt: 0,
      settings: { mode: "llm", jev: null, llm: { providerId: "fixture", model: "fixture" } }, documents: [], cells: [], columns: [column], status: "draft", runId: null,
    });
    const result = await new ReviewExecutor(config).execute(workspace, review, column,
      { hash: "fixture", complete: true, pages: [{ page: 1, source: "native", text: "Assignment is permitted." }] }, new AbortController().signal);
    expect(result).toMatchObject({ value: "Yes", backend: "llm", model: "fixture", evidence: "cited", citations: [{ page: 1, quote: "Assignment is permitted." }] });
    const inference = requests.find(request => JSON.stringify(request.messages).includes("Review the supplied evidence only."));
    expect(inference).toBeDefined();
    expect(inference?.tools?.map(tool => tool.function.name)).toEqual(["StructuredOutput"]);
    expect(checkedLiveWorker).toBe(true);
    const sessions = await fetch(engine.url + "/session", { headers, signal: AbortSignal.timeout(10000) });
    expect(await sessions.json()).toEqual([]);
  } finally {
    await engine?.close();
    fixture.stop(true);
    await closeRuntimeOpencodeConfig(config);
    Bun.gc(true);
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
