import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ApprovalService } from "../approvals.js";
import { ApiError } from "../errors.js";
import { explicitFileApprovals, managedPermissionRules } from "../agent-sandbox/engine-policy.js";
import { AgentSandboxService, type AgentPermissionRule } from "../agent-sandbox/service.js";
import { buildLegalworkRuntimeConfigObject } from "../legalwork-runtime-config.js";
import { closeRuntimeOpencodeConfig, GLOBAL_TOOL_PERMISSIONS_ID, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { writeYoloMode } from "./yolo-mode.js";

/**
 * The shipped engine with the production permission map (desktop: managed shell, protected
 * environment off): with YOLO Mode off a `mv` in the client folder stops at an approval prompt;
 * on, it runs without one. Opt-in: needs the built server plugins and an engine binary.
 *   pnpm --filter legalwork-server build
 *   LAWOSS_YOLO_ENGINE=1 LEGALWORK_TEST_OPENCODE_BIN=/Applications/LAWOSS.app/Contents/Resources/sidecars/opencode \
 *     pnpm --filter legalwork-server exec bun test src/lawoss/yolo-mode.integration.test.ts
 */
const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const agentRuleSchema = z.array(z.object({ name: z.string(), permission: z.array(z.object({ permission: z.string(), pattern: z.string(), action: z.enum(["allow", "ask", "deny"]) })) }));

test.skipIf(!binary || process.env.LAWOSS_YOLO_ENGINE !== "1")("a real engine moves a client file without a prompt only while YOLO Mode is on", async () => {
  if (!binary) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-yolo-engine-")));
  const matter = join(root, "Klient"); await mkdir(matter);
  await writeFile(join(matter, "zmluva.txt"), "text");
  const previousDb = process.env.LEGALWORK_RUNTIME_DB;
  process.env.LEGALWORK_RUNTIME_DB = join(root, "private", "runtime.sqlite");
  const workspace: WorkspaceInfo = { id: "matter", name: "Klient", path: matter, preset: "starter", workspaceType: "local" };
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture-host", configPath: join(root, "private", "server.json"),
    approval: { mode: "auto", timeoutMs: 5000 }, corsOrigins: [], workspaces: [workspace], authorizedRoots: [matter], agentSandboxEnabled: true,
    readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };
  // The lawyer asks before edits and commands; internet access has no rule (the app default).
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, () => ({ permission: { edit: "ask", bash: "ask" } }));
  const hostApprovals: string[] = [];
  const approvals: ApprovalService = new ApprovalService(config.approval, undefined, () => queueMicrotask(() => {
    for (const request of approvals.list()) { hostApprovals.push(request.action); approvals.respond(request.id, "deny"); }
  }));
  const service = new AgentSandboxService(config, approvals, { status: async () => ({ available: true }), prepare: async () => "fixture",
    run: async () => { throw new Error("The protected environment stays off in this test."); } });
  let engineBase = "";
  const shellCalls: string[] = [];
  const fixture = Bun.serve({ port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/workspaces") return Response.json({ items: [{ id: workspace.id, path: matter }] });
    if (path.includes("/sandbox/session/")) return Response.json({ enabled: false, networkMode: "allow", shell: "zsh", platform: process.platform, cwd: matter });
    if (path === "/workspace/matter/sandbox/execute") {
      const command = z.object({ command: z.string(), write: z.boolean(), agent: z.string(), sessionID: z.string() }).parse(await request.json());
      shellCalls.push(command.command);
      // As the server derives them: the engine's agent rules under its current config.
      const agents = agentRuleSchema.parse(await (await fetch(`${engineBase}/agent`)).json());
      const engineConfig = z.object({ permission: z.unknown(), agent: z.record(z.string(), z.object({ permission: z.unknown() }).partial()).optional() })
        .parse(await (await fetch(`${engineBase}/config`)).json());
      const rules: AgentPermissionRule[] = managedPermissionRules(explicitFileApprovals(agents.find(agent => agent.name === command.agent)?.permission ?? [],
        [engineConfig.permission, engineConfig.agent?.[command.agent]?.permission]), []);
      try { return Response.json(await service.run(workspace, { ...command, timeoutMs: 10000 }, { type: "host" }, request.signal, rules, [command.sessionID])); }
      catch (error) { return Response.json({ code: error instanceof ApiError ? error.code : "failed" }, { status: error instanceof ApiError ? error.status : 500 }); }
    }
    const input = z.object({ messages: z.array(z.object({ role: z.string() })), tools: z.array(z.object({ function: z.object({ name: z.string() }) })).optional() }).parse(await request.json());
    const tools = input.tools?.map(tool => tool.function.name) ?? [];
    const invoke = input.messages.every(message => message.role !== "tool") && tools.includes("legalwork_shell");
    const delta = invoke ? { tool_calls: [{ index: 0, id: "call_move", type: "function", function: { name: "legalwork_shell",
      arguments: JSON.stringify({ command: "mv zmluva.txt 01_Zmluva.txt", description: "Premenuj zmluvu", write: true }) } }] } : { content: "Hotovo." };
    const chunk = (value: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`;
    return new Response(chunk({ role: "assistant", ...delta }, null) + chunk({}, invoke ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });

  // One fresh engine per phase, as after the app's engine reload.
  const runPhase = async (phase: string, agent = "legalwork") => {
    const production = await buildLegalworkRuntimeConfigObject(config, workspace.id);
    const file = join(root, `config-${phase}.json`);
    await writeFile(file, JSON.stringify({ enabled_providers: ["fixture"], model: "fixture/fixture", small_model: "fixture/fixture", share: "disabled", autoupdate: false,
      provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "Fixture", options: { baseURL: fixture.url.origin + "/v1", apiKey: "fixture" }, models: { fixture: { name: "Fixture", limit: { context: 100000, output: 4000 } } } } },
      plugin: [pathToFileURL(join(import.meta.dir, "../../dist/opencode-plugins/legalwork-sandbox.js")).href],
      permission: production.permission, agent: production.agent, lsp: false, formatter: false }));
    const reservation = Bun.serve({ port: 0, fetch: () => new Response() }), port = reservation.port;
    reservation.stop(true);
    const engine = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: matter, env: {
      ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
      OPENCODE_TEST_HOME: root, OPENCODE_CONFIG: file, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
      LEGALWORK_SERVER_URL: fixture.url.origin, LEGALWORK_WIKI_AGENT_TOKEN: "fixture",
    }, stdout: "pipe", stderr: "pipe" });
    const logs = new Response(engine.stderr).text();
    engineBase = `http://127.0.0.1:${port}`;
    try {
      let ready = false;
      for (let i = 0; i < 300 && !ready && engine.exitCode === null; i++) {
        try { ready = (await fetch(engineBase + "/global/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { await Bun.sleep(100); }
      }
      if (!ready) throw new Error("Engine did not start: " + (engine.exitCode !== null ? await logs : "timed out"));
      const session = z.object({ id: z.string() }).parse(await (await fetch(engineBase + "/session", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json());
      const accepted = await fetch(`${engineBase}/session/${session.id}/prompt_async`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent, model: { providerID: "fixture", modelID: "fixture" }, parts: [{ type: "text", text: "Premenuj zmluvu." }] }) });
      expect(accepted.ok).toBe(true);
      const prompts: string[] = [];
      for (let i = 0; i < 300; i++) {
        const pending = z.array(z.object({ id: z.string(), permission: z.string() })).parse(await (await fetch(`${engineBase}/permission`)).json());
        for (const ask of pending) {
          prompts.push(ask.permission);
          await fetch(`${engineBase}/permission/${ask.id}/reply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reply: "reject" }) });
        }
        const status = z.record(z.string(), z.object({ type: z.string() })).parse(await (await fetch(`${engineBase}/session/status`)).json());
        if (i > 5 && (status[session.id]?.type ?? "idle") === "idle") break;
        await Bun.sleep(100);
      }
      return { prompts, permission: production.permission };
    } finally {
      engine.kill("SIGKILL"); await engine.exited;
    }
  };

  try {
    const off = await runPhase("off");
    expect(off.permission).toMatchObject({ legalwork_shell: "ask", edit: "ask" });
    // Off: the managed shell asks in the chat (the server's approval for this command), the lawyer declines.
    const offApprovals = [...hostApprovals];
    expect([...off.prompts, ...offApprovals]).toContain("sandbox.bash");
    expect(await readFile(join(matter, "zmluva.txt"), "utf8")).toBe("text");

    await writeYoloMode(config, true);
    hostApprovals.length = 0; shellCalls.length = 0;
    const on = await runPhase("on");
    // The shared map keeps the lawyer's rules; the chat agent carries the YOLO allows.
    expect(on.permission).toMatchObject({ legalwork_shell: "ask", edit: "ask" });
    expect(on.prompts).toEqual([]);
    expect(hostApprovals).toEqual([]);
    expect(shellCalls).toEqual(["mv zmluva.txt 01_Zmluva.txt"]);
    expect(await readFile(join(matter, "01_Zmluva.txt"), "utf8")).toBe("text");
    const onApprovals = [...hostApprovals], onCalls = [...shellCalls];

    // A scheduled run under YOLO still asks before the command and moves nothing.
    hostApprovals.length = 0;
    const scheduled = await runPhase("scheduled", "legalwork-scheduled-all");
    expect([...scheduled.prompts, ...hostApprovals]).toContain("sandbox.bash");
    expect(await readFile(join(matter, "01_Zmluva.txt"), "utf8")).toBe("text");
    console.log(JSON.stringify({ off: { enginePrompts: off.prompts, chatApprovals: offApprovals }, on: { enginePrompts: on.prompts, chatApprovals: onApprovals, shellCalls: onCalls },
      scheduled: { enginePrompts: scheduled.prompts, chatApprovals: hostApprovals } }));
  } finally {
    fixture.stop(true); service.stop();
    await closeRuntimeOpencodeConfig(config); Bun.gc(true);
    if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    await rm(root, { recursive: true, force: true });
  }
}, 120000);
