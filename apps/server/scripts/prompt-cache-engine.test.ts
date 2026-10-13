import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { buildSessionPromptRequest } from "../../app/src/app/lib/system-reminder";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { buildLegalworkRuntimeConfigObject } from "../src/legalwork-runtime-config";
import { createManagedOpencodeServer } from "../src/managed-opencode";
import { assertCachePrefix, CacheRequestSchema, type CacheRequest } from "../src/prompt-cache.test-support";
import { closeRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "../src/runtime-opencode-config-store";
import { startServer } from "../src/server";
import type { ServerConfig } from "../src/types";

// Separate process from unit tests: no mocked hooks, SDK, runtime builder or
// server proxy. Only external model, MCP and UI surfaces are synthetic.
async function runFixture(injectTimestamp: boolean) {
  const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
  if (!binary) throw new Error("Set LEGALWORK_TEST_OPENCODE_BIN to the shipped engine (build legalwork-server first)");
  const root = await realpath(await mkdtemp(join(tmpdir(), "legalwork-cache-")));
  const workspace = { id: "matter", name: "Synthetic matter", path: join(root, "matter"), preset: "starter", workspaceType: "local" } satisfies ServerConfig["workspaces"][number];
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture-host", configPath: join(root, "private", "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [workspace], authorizedRoots: [workspace.path],
    readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const captures: { trajectory: string; epoch: string; request: CacheRequest }[] = [];
  const previous = new Map<string, CacheRequest>();
  const steps = new Map<string, number>();
  let engine: Awaited<ReturnType<typeof createManagedOpencodeServer>> | undefined;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let activeSession = "";
  let surface = "";
  let epoch = "continuous";
  let modelID = "fixture";
  let contractError: Error | undefined;
  const ui = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    return Response.json({ ok: true, route: `/workspace/matter/session/${activeSession}`, activeSurface: surface ? {
      id: `${activeSession}:file:${surface}`, kind: "document", format: "docx", sessionId: activeSession, workspaceId: "matter", name: surface, path: surface, editable: true,
    } : null, actions: [] });
  } });
  const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const input = CacheRequestSchema.parse(await request.json());
    // The engine also generates titles/summaries: those are independent prompts,
    // never silently admitted to the conversation's cache epoch.
    const toolNames = (input.tools ?? []).map(tool => z.object({ function: z.object({ name: z.string() }) }).parse(tool).function.name);
    const lastUser = input.messages.findLast(message => message.role === "user");
    const child = JSON.stringify(lastUser).includes("CACHE_CHILD");
    const trajectory = child ? "child" : "parent";
    const step = steps.get(trajectory) ?? 0;
    let call: { name: string; arguments: string } | undefined;
    if (toolNames.length) {
      const prior = previous.get(trajectory);
      try { if (prior) assertCachePrefix(prior, input, `${trajectory} request ${step + 1}`); }
      catch (error) { contractError = error instanceof Error ? error : new Error(String(error)); }
      captures.push({ trajectory, epoch, request: input });
      previous.set(trajectory, input);
      steps.set(trajectory, step + 1);
      if (child && step === 0) call = { name: "read", arguments: JSON.stringify({ filePath: join(workspace.path, "fixture.txt") }) };
      if (!child && step === 0) {
        // Advance real wall time and change live state between agent steps.
        await Bun.sleep(1100);
        surface = "opened-during-tool.docx";
        call = { name: "read", arguments: JSON.stringify({ filePath: join(workspace.path, "fixture.txt") }) };
      }
      if (!child && step === 1) call = { name: "cachefixture_echo", arguments: JSON.stringify({ value: "synthetic echo" }) };
      if (!child && step === 2) call = { name: "task", arguments: JSON.stringify({ description: "Cache fixture child", prompt: "CACHE_CHILD: Read fixture.txt and report its synthetic text.", subagent_type: "explore", run_in_background: false }) };
      if (!child && step === 3) call = { name: "legalwork_schedule_clock", arguments: "{}" };
      if (!child && step === 4) call = { name: "skill", arguments: JSON.stringify({ name: "cache-fixture" }) };
      if (call && !toolNames.includes(call.name)) throw new Error(`Production tool not discovered: ${call.name}`);
    }
    const chunk = (delta: unknown, finish_reason: string | null) => `data: ${JSON.stringify({ id: `fixture_${trajectory}_${step}`, object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    // Combined gateway CI: the tap chooses the fixture's next action, then the
    // real proxy/Vertex adapter produces the response consumed by the engine.
    // The negative plugin run stays local and does not pollute gateway captures.
    const gateway = process.env.LEGALWORK_CACHE_GATEWAY;
    if (gateway && !injectTimestamp) {
      const providerControl = process.env.LEGALWORK_CACHE_PROVIDER;
      if (!providerControl) throw new Error("Gateway fixture provider control URL is required");
      const calls = input.messages.reduce((count, message) => count + (z.object({ tool_calls: z.array(z.unknown()).optional() }).parse(message).tool_calls?.length ?? 0), 0);
      const plan = await fetch(providerControl + "/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: `${toolNames.length ? trajectory : "other"}:${calls}`, call }), signal: AbortSignal.timeout(10000) });
      if (!plan.ok) throw new Error("Could not configure the provider response fixture");
      return fetch(gateway + "/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer sk-cache-fixture" }, body: JSON.stringify(input), signal: AbortSignal.timeout(15000) });
    }
    const delta = call ? { tool_calls: [{ index: 0, id: `call_${trajectory}_${step}`, type: "function", function: call }] } : { content: "Synthetic fixture complete." };
    return new Response(chunk({ role: "assistant", ...delta }, null) + chunk({}, call ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const engineConfig = join(root, "engine.json");
  const discovery = join(root, "ui.json");
  const request = async (path: string, body?: unknown, method = body === undefined ? "GET" : "POST") => {
    if (!server) throw new Error("LegalWork server unavailable");
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
      method, headers: { authorization: "Bearer fixture", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(path.endsWith("/message") ? 45000 : 10000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`LegalWork ${path}: ${response.status} ${text}`);
    return JSON.parse(text);
  };
  const startEngine = async () => {
    engine = await createManagedOpencodeServer({ bin: binary, cwd: workspace.path, timeoutMs: 30000, env: {
      OPENCODE_CONFIG: engineConfig, OPENCODE_CONFIG_CONTENT: "", OPENCODE_CONFIG_DIR: join(root, "policy"),
      OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_TEST_HOME: join(root, "home"),
      XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
      OPENCODE_DB: join(root, "engine.db"), LEGALWORK_UI_CONTROL_DISCOVERY: discovery,
      LEGALWORK_SERVER_URL: server ? `http://127.0.0.1:${server.port}` : "", LEGALWORK_SERVER_TOKEN: "fixture", TZ: "Europe/Berlin",
    } });
    config.opencodeBaseUrl = engine.url;
    config.opencodeUsername = engine.username;
    config.opencodePassword = engine.password;
    // /global/health only proves the process is listening. A cold workspace
    // still installs/loads the normal npm plugins and discovers connectors.
    // Complete that bounded startup phase before using ordinary API deadlines.
    const agentDiscovery = await fetch(engine.url + "/agent", {
      headers: { authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}` },
      signal: AbortSignal.timeout(45000),
    });
    if (!agentDiscovery.ok) throw new Error(`Production agent discovery failed: ${agentDiscovery.status} ${await agentDiscovery.text()}`);
    const agents = z.array(z.object({ name: z.string() })).parse(await agentDiscovery.json());
    expect(agents.some(agent => agent.name === "legalwork")).toBe(true);
    expect(agents.some(agent => agent.name === "explore")).toBe(true);
  };
  const prompt = async (text: string, context: string) => {
    if (!server) throw new Error("LegalWork server unavailable");
    const client = createOpencodeClient({ baseUrl: `http://127.0.0.1:${server.port}/workspace/matter/opencode`, directory: workspace.path, headers: { authorization: "Bearer fixture" } });
    const result = await client.session.prompt(buildSessionPromptRequest({ sessionID: activeSession,
      agent: "legalwork", model: { providerID: "fixture", modelID }, parts: [{ type: "text", text }],
    }, context), { throwOnError: true, signal: AbortSignal.timeout(45000) });
    expect(result.data.info.error, "Agent must finish without a provider/tool execution error").toBeUndefined();
  };
  const personalize = async (customInstructions: string) => {
    const { revision } = z.object({ revision: z.number() }).parse(await request("/workspace/matter/personalization"));
    await request("/workspace/matter/personalization", { revision, customInstructions }, "PUT");
  };
  try {
    await mkdir(workspace.path, { recursive: true });
    await writeFile(join(workspace.path, "fixture.txt"), "SYNTHETIC FILE CONTENT\n");
    const skill = join(workspace.path, ".opencode", "skills", "cache-fixture");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "---\nname: cache-fixture\ndescription: Synthetic cache regression skill\n---\nUse the synthetic fixture file.\n");
    await writeFile(discovery, JSON.stringify({ baseUrl: ui.url.origin, token: "fixture" }));
    const mutation = join(root, "changing-system.mjs");
    if (injectTimestamp) await writeFile(mutation, `export default async () => ({ "experimental.chat.system.transform": async (_input, output) => { output.system.push("CACHE_REGRESSION_TIME: " + new Date().toISOString()); } });`);
    await writeRuntimeOpencodeConfig(config, workspace.id, () => ({ permission: { "*": "allow" },
      ...(injectTimestamp ? { plugin: [pathToFileURL(mutation).href] } : {}),
      mcp: { cachefixture: { type: "local", command: [process.execPath, join(import.meta.dir, "prompt-cache-mcp.ts")], enabled: true } },
      provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "Fixture", options: { baseURL: provider.url.origin + "/v1", apiKey: "fixture" }, models: {
        fixture: { name: "Fixture", limit: { context: 128000, output: 4096 } },
        alternate: { name: "Alternate fixture", limit: { context: 128000, output: 4096 } },
      } } },
    }));
    // Keep ALL production plugins, agents and connectors from the real builder.
    const runtime = await buildLegalworkRuntimeConfigObject(config, workspace.id);
    await writeFile(engineConfig, JSON.stringify({ ...runtime, skills: { paths: [skill] }, enabled_providers: ["fixture"], model: "fixture/fixture", small_model: "fixture/fixture", share: "disabled", autoupdate: false, lsp: false, formatter: false }));
    server = await startServer(config);
    await startEngine();
    activeSession = z.object({ id: z.string() }).parse(await request("/workspace/matter/opencode/session", { title: "Synthetic cache contract" })).id;
    await personalize("PROJECT INITIAL SYNTHETIC PREFERENCE");
    await prompt("CACHE_PARENT: Read the file, use MCP, delegate and get the clock.", "APP INITIAL SYNTHETIC CONTEXT");
    if (injectTimestamp) {
      expect(captures.length).toBeGreaterThan(2);
      const systemIndex = captures[0].request.messages.findIndex(message => message.role === "system" && JSON.stringify(message.content).includes("CACHE_REGRESSION_TIME"));
      expect(systemIndex).toBeGreaterThanOrEqual(0);
      expect(contractError?.message).toContain(`prompt cache prefix changed at messages[${systemIndex}].content`);
      return;
    }
    if (contractError) throw contractError;
    expect(steps.get("parent")).toBeGreaterThanOrEqual(6);
    expect(steps.get("child")).toBeGreaterThanOrEqual(2);
    surface = "follow-up-document.docx";
    await personalize("PROJECT UPDATED SYNTHETIC PREFERENCE");
    await request("/workspace/matter/office-tools/poll?wait=0&host=word&document=synthetic-word.docx");
    await prompt("Continue the synthetic check.", "APP UPDATED SYNTHETIC CONTEXT");
    if (contractError) throw contractError;
    // Restart the engine, keeping the same SQLite history and runtime config.
    // No rebaseline is allowed: the following request must preserve the prefix.
    await engine?.close();
    await startEngine();
    await prompt("Continue after restart.", "APP RESTART SYNTHETIC CONTEXT");
    if (contractError) throw contractError;
    const parent = captures.filter(capture => capture.trajectory === "parent");
    const first = parent[0].request;
    const last = parent.at(-1)?.request;
    const tools = JSON.stringify(first.tools);
    for (const name of ["read", "task", "cachefixture_echo", "legalwork_schedule_clock", "word_read_document", "legalwork_skill_list"]) expect(tools).toContain(`"${name}"`);
    expect(JSON.stringify(last?.messages).includes("Use the synthetic fixture file."), "Engine must discover and load the synthetic skill").toBe(true);
    expect(JSON.stringify(last?.messages).includes("APP INITIAL SYNTHETIC CONTEXT")).toBe(true);
    expect(JSON.stringify(last?.messages)).toContain("APP UPDATED SYNTHETIC CONTEXT");
    expect(JSON.stringify(last?.messages)).toContain("PROJECT UPDATED SYNTHETIC PREFERENCE");
    expect(JSON.stringify(last?.messages)).toContain("MCP fixture: synthetic echo");
    expect(JSON.stringify(last?.messages)).toContain("follow-up-document.docx");
    expect(JSON.stringify(last?.messages)).toContain("synthetic-word.docx");
    expect(JSON.stringify(last?.messages)).toContain("SYNTHETIC FILE CONTENT");
    // Mutation controls use captured production requests, not an idealized prompt.
    const bad = structuredClone(first);
    const system = bad.messages.find(message => message.role === "system");
    if (!system) throw new Error("Missing system prompt");
    system.content = `${JSON.stringify(system.content)}\nCurrent time: ${new Date().toISOString()}`;
    expect(() => assertCachePrefix(first, bad, "negative live clock")).toThrow("prompt cache prefix changed");
    expect(() => assertCachePrefix(first, { ...first, tools: [...(first.tools ?? [])].reverse() }, "negative tool order")).toThrow("tools[");
    // Intentional context boundaries are explicit. Ordinary turns, live state
    // updates and restart above NEVER reset the baseline.
    await request(`/workspace/matter/opencode/session/${activeSession}/summarize`, { providerID: "fixture", modelID: "fixture", auto: false });
    epoch = "compaction"; previous.clear();
    await prompt("Continue after explicit compaction.", "APP COMPACTED SYNTHETIC CONTEXT");
    await prompt("Continue in the compacted context.", "APP COMPACTED FOLLOW-UP CONTEXT");
    if (contractError) throw contractError;
    modelID = "alternate";
    epoch = "model-change"; previous.clear();
    await prompt("Continue with the alternate fixture model.", "APP MODEL CHANGE CONTEXT");
    await prompt("Continue with this model.", "APP MODEL FOLLOW-UP CONTEXT");
    if (contractError) throw contractError;
    for (const boundary of ["compaction", "model-change"]) expect(captures.filter(capture => capture.epoch === boundary)).toHaveLength(2);
    console.log(`Cache contract passed: ${parent.length} parent requests, ${captures.filter(capture => capture.trajectory === "child").length} child requests, ${captures.filter(capture => capture.epoch !== "continuous").length} requests after declared boundaries; full production plugin set, real MCP, tools and persisted restart.`);
  } finally {
    if (!injectTimestamp && process.env.LEGALWORK_CACHE_CAPTURE) await writeFile(process.env.LEGALWORK_CACHE_CAPTURE, JSON.stringify({ captures }, null, 2));
    await engine?.close();
    await server?.stop();
    provider.stop(true); ui.stop(true);
    await closeRuntimeOpencodeConfig(config);
    await rm(root, { recursive: true, force: true });
  }
}

test("whole agent preserves the provider prompt prefix across tools, app changes, subagents and restart", () => runFixture(false), 120000);
test("whole-agent guard detects a real plugin injecting a changing system timestamp", () => runFixture(true), 90000);
