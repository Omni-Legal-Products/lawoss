import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { startServer } from "../server.js";
import { upsertSkill } from "../skills.js";
import { upsertSkillResource } from "../skill-resources.js";
import { writeSandboxDefault } from "../agent-sandbox/settings.js";
import type { ServerConfig } from "../types.js";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
test.skipIf(!binary)("shipped engine reads global workflow resources with sandbox on and off while other folders still ask", async () => {
  if (!binary) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "skill-resource-engine-")));
  const previous = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = join(root, "config");
  const directory = join(root, "matter"); await mkdir(directory);
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture-host", configPath: join(root, "private/server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: [{ id: "matter", name: "Matter", path: directory, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [directory], readOnly: false, startedAt: Date.now(),
    tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };
  const server = await startServer(config);
  const name = "workflow-assistant-intake";
  await upsertSkill(directory, { name, description: "Intake workflow", scope: "global", content: "Read the attached fields and template." });
  await upsertSkillResource(directory, name, { name: "fields.md", content: "Intake field: matter number" });
  const template = await readFile(new URL("../../resources/core-opencode/skills/workflow-assistant-due-diligence/resources/DD-Report-Template.docx", import.meta.url));
  await upsertSkillResource(directory, name, { name: "template.docx", contentBase64: template.toString("base64") });
  const unrelated = join(root, "unrelated.txt"); await writeFile(unrelated, "Private unrelated text");
  let externalProbe = false;
  const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const input = z.object({ messages: z.array(z.object({ role: z.string() })) }).parse(await request.json());
    const step = input.messages.filter(message => message.role === "tool").length;
    const calls = externalProbe ? [{ name: "read", args: { filePath: unrelated } }] : [
      { name: "legalwork_skill_load", args: { name } },
      { name: "legalwork_skill_read", args: { name, path: "resources/fields.md" } },
      { name: "legalwork_skill_read", args: { name, path: "resources/template.docx" } },
    ];
    const call = calls[step];
    const delta = call ? { tool_calls: [{ index: 0, id: "resource_" + step, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: "Resources checked." };
    const chunk = (delta: unknown, finish_reason: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    return new Response(chunk({ role: "assistant", ...delta }, null) + chunk({}, call ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, "legalwork-skill-tools.ts")], outdir: join(root, "plugin"), target: "node", format: "esm" });
  expect(build.success).toBe(true);
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() }), port = reservation.port; reservation.stop(true);
  const engineConfig = join(root, "engine.json");
  await writeFile(engineConfig, JSON.stringify({ enabled_providers: ["fixture"], model: "fixture/fixture", small_model: "fixture/fixture", share: "disabled", autoupdate: false,
    provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "Fixture", options: { baseURL: model.url.origin + "/v1", apiKey: "fixture" }, models: { fixture: { name: "Fixture", limit: { context: 100000, output: 4000 } } } } },
    plugin: [pathToFileURL(build.outputs[0]!.path).href], permission: { "*": "allow", external_directory: "ask" }, lsp: false, formatter: false,
  }));
  const engine = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: directory, env: {
    ...process.env, XDG_CONFIG_HOME: join(root, "engine-config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
    OPENCODE_TEST_HOME: root, OPENCODE_CONFIG: engineConfig, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
    LEGALWORK_SERVER_URL: `http://127.0.0.1:${server.port}`, LEGALWORK_SERVER_TOKEN: "fixture",
  }, stdout: "ignore", stderr: "pipe" });
  const logs = new Response(engine.stderr).text(), base = `http://127.0.0.1:${port}`;
  const jsonHeaders = { "content-type": "application/json" };
  const session = async () => z.object({ id: z.string() }).parse(await (await fetch(base + "/session", { method: "POST", headers: jsonHeaders, body: "{}", signal: AbortSignal.timeout(30000) })).json()).id;
  const prompt = (id: string) => fetch(`${base}/session/${id}/message`, { method: "POST", headers: jsonHeaders,
    body: JSON.stringify({ agent: "build", model: { providerID: "fixture", modelID: "fixture" }, parts: [{ type: "text", text: "Read the workflow resources." }] }), signal: AbortSignal.timeout(60000) });
  try {
    let ready = false;
    for (let i = 0; i < 200; i++) {
      try { ready = (await fetch(base + "/global/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Starting. */ }
      if (ready || engine.exitCode !== null) break;
      await Bun.sleep(100);
    }
    if (!ready) throw new Error("Engine did not start: " + (engine.exitCode !== null ? await logs : "timed out"));
    for (const enabled of [false, true]) {
      await writeSandboxDefault(config, { enabled, networkMode: "block" });
      const id = await session(), response = await prompt(id);
      const result = await response.text(); expect(response.status, result).toBe(200);
      const messages = z.array(z.object({ parts: z.array(z.object({ tool: z.string().optional(), state: z.object({ status: z.string(), output: z.string().optional() }).optional() })) })).parse(await (await fetch(`${base}/session/${id}/message`)).json());
      const reads = messages.flatMap(message => message.parts).filter(part => part.tool === "legalwork_skill_read");
      expect(reads.map(part => part.state?.status)).toEqual(["completed", "completed"]);
      expect(reads[0].state?.output).toContain(enabled ? "Updated intake fields" : "Intake field: matter number");
      expect(reads[1].state?.output).toContain("{{matter_name}}");
      expect(await (await fetch(base + "/permission")).json()).toEqual([]);
      await upsertSkillResource(directory, name, { name: "fields.md", content: "Updated intake fields" });
    }
    externalProbe = true;
    const id = await session(), pending = prompt(id);
    let approvals: Array<{ id: string; permission: string }> = [];
    for (let i = 0; i < 200 && !approvals.length; i++) {
      approvals = z.array(z.object({ id: z.string(), permission: z.string() })).parse(await (await fetch(base + "/permission")).json());
      if (!approvals.length) await Bun.sleep(50);
    }
    expect(approvals).toHaveLength(1); expect(approvals[0].permission).toBe("external_directory");
    await fetch(`${base}/permission/${approvals[0].id}/reply`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ reply: "reject" }) });
    await (await pending).text();
  } finally {
    engine.kill("SIGKILL"); await engine.exited; model.stop(true); await server.stop();
    if (previous === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous;
    Bun.gc(true); await rm(root, { recursive: true, force: true });
  }
}, 120000);
