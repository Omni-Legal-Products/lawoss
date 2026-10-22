import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ApprovalService } from "../approvals.js";
import { ApiError } from "../errors.js";
import { explicitFileApprovals, managedPermissionRules } from "../agent-sandbox/engine-policy.js";
import { AgentSandboxService, type AgentPermissionRule } from "../agent-sandbox/service.js";
import { buildLegalworkRuntimeConfigObject } from "../legalwork-runtime-config.js";
import { closeRuntimeOpencodeConfig, GLOBAL_TOOL_PERMISSIONS_ID, readRuntimeOpencodeConfigText } from "../runtime-opencode-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { applyFileOperations, planFileOperations, publicPlan } from "./file-operations.js";
import { writeYoloMode } from "./yolo-mode.js";

/**
 * Alfa 2 acceptance with the shipped engine and the production permission map on a CLEAN profile
 * (no tool rule saved, YOLO off, protected execution off), synthetic files only:
 * - managed shell `mv`: exactly one card; declined → file unchanged; a new request in the SAME chat
 *   shows a new card; approved → renamed;
 * - `lawoss_files` rename: exactly one engine card (`edit`, readable plan, no "always");
 *   rejected → unchanged; a new request in the same chat → new card; approved → renamed, truthful result;
 * - YOLO on → `lawoss_files` renames without any card.
 * Opt-in: needs the built server plugins and an engine binary.
 *   pnpm --filter legalwork-server build
 *   LAWOSS_APPROVAL_ENGINE=1 LEGALWORK_TEST_OPENCODE_BIN=/Applications/LAWOSS.app/Contents/Resources/sidecars/opencode \
 *     pnpm --filter legalwork-server exec bun test src/lawoss/approval-cards.integration.test.ts
 */
const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const agentRuleSchema = z.array(z.object({ name: z.string(), permission: z.array(z.object({ permission: z.string(), pattern: z.string(), action: z.enum(["allow", "ask", "deny"]) })) }));
const askSchema = z.array(z.object({ id: z.string(), sessionID: z.string(), permission: z.string(), patterns: z.array(z.string()), always: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional() }));
type EngineAsk = z.infer<typeof askSchema>[number];

test.skipIf(!binary || process.env.LAWOSS_APPROVAL_ENGINE !== "1")("a real engine: one card per change, a decline changes nothing, a new request asks again, YOLO asks nothing", async () => {
  if (!binary) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-approval-engine-")));
  const matter = join(root, "C001-Synteticka"); await mkdir(matter);
  const previousDb = process.env.LEGALWORK_RUNTIME_DB;
  process.env.LEGALWORK_RUNTIME_DB = join(root, "private", "runtime.sqlite");
  const workspace: WorkspaceInfo = { id: "matter", name: "C001", path: matter, preset: "starter", workspaceType: "local" };
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture-host", configPath: join(root, "private", "server.json"),
    approval: { mode: "auto", timeoutMs: 5000 }, corsOrigins: [], workspaces: [workspace], authorizedRoots: [matter], agentSandboxEnabled: true,
    readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };
  // Host (managed shell) cards are answered from this queue, in order.
  const hostReplies: Array<"allow" | "deny"> = [];
  const hostCards: Array<{ action: string; summary: string }> = [];
  const approvals: ApprovalService = new ApprovalService(config.approval, undefined, () => queueMicrotask(() => {
    for (const request of approvals.list()) { hostCards.push({ action: request.action, summary: request.summary }); approvals.respond(request.id, hostReplies.shift() ?? "deny"); }
  }));
  const service = new AgentSandboxService(config, approvals, { status: async () => ({ available: true }), prepare: async () => "fixture",
    run: async () => { throw new Error("The protected environment stays off in this test."); } });
  let engineBase = "";
  let call: { tool: string; args: Record<string, unknown> } = { tool: "", args: {} };
  const toolResults: string[] = [];
  let advertised: unknown;
  const fixture = Bun.serve({ port: 0, idleTimeout: 120, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/workspaces") return Response.json({ items: [{ id: workspace.id, path: matter }] });
    if (path.includes("/sandbox/session/")) return Response.json({ enabled: false, networkMode: "allow", shell: "zsh", platform: process.platform, cwd: matter });
    try {
      if (path === "/workspace/matter/sandbox/execute") {
        const command = z.object({ command: z.string(), write: z.boolean(), agent: z.string(), sessionID: z.string() }).parse(await request.json());
        // As the server derives them: the engine's agent rules under its current config.
        const agents = agentRuleSchema.parse(await (await fetch(`${engineBase}/agent`)).json());
        const engineConfig = z.object({ permission: z.unknown(), agent: z.record(z.string(), z.object({ permission: z.unknown() }).partial()).optional() })
          .parse(await (await fetch(`${engineBase}/config`)).json());
        const rules: AgentPermissionRule[] = managedPermissionRules(explicitFileApprovals(agents.find(agent => agent.name === command.agent)?.permission ?? [],
          [engineConfig.permission, engineConfig.agent?.[command.agent]?.permission]), []);
        return Response.json(await service.run(workspace, { ...command, timeoutMs: 10000 }, { type: "host" }, request.signal, rules, [command.sessionID]));
      }
      if (path === "/workspace/matter/lawoss/files/plan") {
        const body = z.object({ operations: z.unknown() }).parse(await request.json());
        return Response.json({ operations: publicPlan(await planFileOperations(config, workspace, body.operations)) });
      }
      if (path === "/workspace/matter/lawoss/files/apply") {
        const body = z.object({ operations: z.unknown(), approved: z.unknown(), sessionID: z.string() }).parse(await request.json());
        return Response.json(await applyFileOperations(config, workspace, body.operations, body.approved, body.sessionID));
      }
    } catch (error) {
      return Response.json({ code: error instanceof ApiError ? error.code : "failed", error: error instanceof Error ? error.message : String(error) }, { status: error instanceof ApiError ? error.status : 500 });
    }
    // The model: on each new user message call the tool once; after the tool result, answer in text.
    const input = z.object({ messages: z.array(z.object({ role: z.string(), content: z.unknown() })), tools: z.array(z.object({ function: z.object({ name: z.string(), parameters: z.unknown().optional() }) })).optional() }).parse(await request.json());
    advertised ??= input.tools?.find(tool => tool.function.name === "lawoss_files")?.function.parameters;
    const last = input.messages.at(-1);
    if (last?.role === "tool") toolResults.push(typeof last.content === "string" ? last.content : JSON.stringify(last.content));
    const invoke = last?.role === "user" && (input.tools ?? []).some(tool => tool.function.name === call.tool);
    const delta = invoke ? { tool_calls: [{ index: 0, id: `call_${toolResults.length}_${Date.now()}`, type: "function", function: { name: call.tool, arguments: JSON.stringify(call.args) } }] } : { content: "Hotovo." };
    const chunk = (value: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`;
    return new Response(chunk({ role: "assistant", ...delta }, null) + chunk({}, invoke ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });

  const plugins = ["legalwork-sandbox", "lawoss-file-operations"].map(name => pathToFileURL(join(import.meta.dir, `../../dist/opencode-plugins/${name}.js`)).href);
  const engine = async (phase: string) => {
    const production = await buildLegalworkRuntimeConfigObject(config, workspace.id);
    const file = join(root, `config-${phase}.json`);
    await writeFile(file, JSON.stringify({ enabled_providers: ["fixture"], model: "fixture/fixture", small_model: "fixture/fixture", share: "disabled", autoupdate: false,
      provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "Fixture", options: { baseURL: fixture.url.origin + "/v1", apiKey: "fixture" }, models: { fixture: { name: "Fixture", limit: { context: 100000, output: 4000 } } } } },
      plugin: plugins, permission: production.permission, agent: production.agent, experimental: production.experimental, lsp: false, formatter: false }));
    const reservation = Bun.serve({ port: 0, fetch: () => new Response() }), port = reservation.port;
    reservation.stop(true);
    const child = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: matter, env: {
      ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
      OPENCODE_TEST_HOME: root, OPENCODE_CONFIG: file, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
      LEGALWORK_SERVER_URL: fixture.url.origin, LEGALWORK_WIKI_AGENT_TOKEN: "fixture",
    }, stdout: "pipe", stderr: "pipe" });
    const logs = new Response(child.stderr).text();
    engineBase = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 300 && !ready && child.exitCode === null; i++) {
      try { ready = (await fetch(engineBase + "/global/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { await Bun.sleep(100); }
    }
    if (!ready) { child.kill("SIGKILL"); throw new Error("Engine did not start: " + (child.exitCode !== null ? await logs : "timed out")); }
    const session = z.object({ id: z.string() }).parse(await (await fetch(engineBase + "/session", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json());
    /** One user turn; every engine card is recorded and answered by `reply`. */
    const turn = async (text: string, reply: (ask: EngineAsk) => "once" | "reject") => {
      const cards: EngineAsk[] = [];
      const accepted = await fetch(`${engineBase}/session/${session.id}/prompt_async`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: "legalwork", model: { providerID: "fixture", modelID: "fixture" }, parts: [{ type: "text", text }] }) });
      expect(accepted.ok).toBe(true);
      for (let i = 0; i < 300; i++) {
        for (const ask of askSchema.parse(await (await fetch(`${engineBase}/permission`)).json())) {
          if (cards.some(card => card.id === ask.id)) continue;
          cards.push(ask);
          await fetch(`${engineBase}/permission/${ask.id}/reply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reply: reply(ask) }) });
        }
        const status = z.record(z.string(), z.object({ type: z.string() })).parse(await (await fetch(`${engineBase}/session/status`)).json());
        if (i > 5 && (status[session.id]?.type ?? "idle") === "idle") break;
        await Bun.sleep(100);
      }
      return cards;
    };
    return { turn, stop: async () => { child.kill("SIGKILL"); await child.exited; } };
  };

  const evidence: Record<string, unknown> = {};
  try {
    // A clean profile: nothing saved for tools.
    expect(await readRuntimeOpencodeConfigText(config, GLOBAL_TOOL_PERMISSIONS_ID)).toBeNull();

    // 1. Managed shell `mv`, same chat: decline, then a new explicit request, approve.
    await writeFile(join(matter, "poznamky.txt"), "SYN poznamky");
    call = { tool: "legalwork_shell", args: { command: "mv poznamky.txt SYN-overenie.txt", description: "Premenuj poznámky", write: true } };
    const shell = await engine("shell");
    try {
      hostReplies.push("deny");
      const declinedCards = await shell.turn("Premenuj poznamky.txt na SYN-overenie.txt.", () => "reject");
      expect(declinedCards).toEqual([]);
      expect(hostCards.map(card => card.action)).toEqual(["sandbox.bash"]);
      expect(await readdir(matter)).toEqual(["poznamky.txt"]);
      const declinedResult = toolResults.at(-1) ?? "";
      expect(declinedResult).toContain("sandbox_permission_declined");
      expect(declinedResult).toContain("call the tool again so they see a new approval card");

      hostReplies.push("allow");
      expect(await shell.turn("Skús to prosím znova, teraz to schválim.", () => "reject")).toEqual([]);
      expect(hostCards.map(card => card.action)).toEqual(["sandbox.bash", "sandbox.bash"]);
      expect(await readFile(join(matter, "SYN-overenie.txt"), "utf8")).toBe("SYN poznamky");
      expect(await readdir(matter)).toEqual(["SYN-overenie.txt"]);
      evidence.shell = { hostCards: hostCards.map(card => card.action), declinedResult: declinedResult.slice(0, 400), files: await readdir(matter) };
    } finally { await shell.stop(); }

    // 2. lawoss_files rename, same chat: reject, then a new explicit request, approve.
    await writeFile(join(matter, "zmluva.txt"), "SYN zmluva");
    hostCards.length = 0;
    call = { tool: "lawoss_files", args: { operations: [{ operation: "move", from: "zmluva.txt", to: "01_Zmluva.txt" }], description: "Premenovanie zmluvy" } };
    const files = await engine("files");
    try {
      const rejected = await files.turn("Premenuj zmluva.txt na 01_Zmluva.txt.", () => "reject");
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({ permission: "edit", patterns: ["zmluva.txt", "01_Zmluva.txt"], always: [] });
      expect(rejected[0].metadata?.lawossFiles).toEqual([{ operation: "move", kind: "file", from: "zmluva.txt", to: "01_Zmluva.txt" }]);
      expect(hostCards).toEqual([]);
      expect((await readdir(matter)).sort()).toEqual(["SYN-overenie.txt", "zmluva.txt"]);
      const rejectedResult = toolResults.at(-1) ?? "";

      const approved = await files.turn("Skús to znova, schválim to.", () => "once");
      expect(approved).toHaveLength(1);
      expect(approved[0].permission).toBe("edit");
      expect((await readdir(matter)).sort()).toEqual(["01_Zmluva.txt", "SYN-overenie.txt"]);
      expect(await readFile(join(matter, "01_Zmluva.txt"), "utf8")).toBe("SYN zmluva");
      const approvedResult = toolResults.at(-1) ?? "";
      expect(approvedResult).toContain('"status":"done"');
      expect(approvedResult).toContain('"complete":true');
      evidence.files = { rejectedCards: rejected.map(card => ({ permission: card.permission, patterns: card.patterns, always: card.always, metadata: card.metadata })),
        rejectedResult: rejectedResult.slice(0, 300), approvedCards: approved.length, approvedResult: approvedResult.slice(0, 300), files: (await readdir(matter)).sort() };
    } finally { await files.stop(); }

    // 3. YOLO on: the same tool renames without any card.
    await writeYoloMode(config, true);
    call = { tool: "lawoss_files", args: { operations: [{ operation: "move", from: "01_Zmluva.txt", to: "02_Zmluva.txt" }] } };
    const yolo = await engine("yolo");
    try {
      const cards = await yolo.turn("Premenuj 01_Zmluva.txt na 02_Zmluva.txt.", () => "reject");
      expect(cards).toEqual([]);
      expect(hostCards).toEqual([]);
      expect((await readdir(matter)).sort()).toEqual(["02_Zmluva.txt", "SYN-overenie.txt"]);
      evidence.yolo = { cards: cards.length, hostCards: hostCards.length, files: (await readdir(matter)).sort() };
    } finally { await yolo.stop(); }
    // The wire schema the model sees: a flat object every provider accepts (no anyOf/oneOf).
    expect(JSON.stringify(advertised)).toContain('"operations"');
    expect(JSON.stringify(advertised)).not.toMatch(/anyOf|oneOf/);
    evidence.schema = advertised;
    console.log(JSON.stringify(evidence));
  } finally {
    fixture.stop(true); service.stop();
    await closeRuntimeOpencodeConfig(config); Bun.gc(true);
    if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    await rm(root, { recursive: true, force: true });
  }
}, 240000);
