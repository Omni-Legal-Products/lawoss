import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { lawossEngineEnv } from "./engine-network.js";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const integration = test.skipIf(!binary);

integration("pinned engine actual provider requests identify the supported hook coverage", async () => {
  if (!binary) return;
  const root = await mkdtemp(join(tmpdir(), "lawoss-engine-egress-"));
  const folder = join(root, "public-synthetic"); await mkdir(folder);
  let mode: "text" | "task" = "text";
  const privateSource = join(root, "private-canary.txt"); await writeFile(privateSource, "PRIVATE-FILESYSTEM-CANARY");
  const calls: Array<{kind: string; body: string}> = [];
  const hooks: string[] = [];
  const receiver = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/hook") {hooks.push(await request.text()); return Response.json({ok: true});}
    const body = await request.text(); calls.push({kind: url.pathname, body});
    const input = z.object({stream: z.boolean().optional(), messages: z.array(z.object({role: z.string()})).optional(), tools: z.array(z.object({function: z.object({name: z.string()})})).optional()}).parse(JSON.parse(body));
    const shouldTask = mode === "task" && !body.includes("PUBLIC-SUBAGENT-CANARY") && input.messages?.at(-1)?.role !== "tool"
      && input.tools?.some(tool => tool.function.name === "task");
    const delta = shouldTask ? {tool_calls: [{index: 0, id: "call_public_task", type: "function", function: {name: "task", arguments: JSON.stringify({description: "Synthetic child", prompt: "PUBLIC-SUBAGENT-CANARY", subagent_type: "general"})}}]}
      : {role: "assistant", content: "Synthetic answer"};
    if (!input.stream) return Response.json({id: "synthetic", object: "chat.completion", created: 1, model: "fixture", choices: [{index: 0, message: {role: "assistant", content: "Synthetic answer"}, finish_reason: "stop"}], usage: {prompt_tokens: 2, completion_tokens: 2, total_tokens: 4}});
    const event = (delta: unknown, finish_reason: string | null) => `data: ${JSON.stringify({id: "synthetic", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{index: 0, delta, finish_reason}]})}\n\n`;
    return new Response(event(delta, null) + event({}, shouldTask ? "tool_calls" : "stop") + "data: [DONE]\n\n", {headers: {"content-type": "text/event-stream"}});
  }});
  const control = join(root, "control.txt"); await writeFile(control, "allow");
  const plugin = join(root, "guard.mjs");
  await writeFile(plugin, `import {readFile} from "node:fs/promises";
export default async () => {
  const hook = name => async input => { await fetch(${JSON.stringify(receiver.url.origin + "/hook")},{method:"POST",body:name});
    if ((await readFile(${JSON.stringify(control)},"utf8")) === "deny") throw new Error("synthetic-governance-denied"); };
  return {"chat.params":hook("chat.params"),"chat.headers":hook("chat.headers"),"experimental.chat.system.transform":hook("system.transform"),"experimental.session.compacting":hook("compacting"),"tool.execute.before":hook("tool.before")};
};`);
  const config = join(root, "engine.json");
  await writeFile(config, JSON.stringify({enabled_providers: ["fixture"], model: "fixture/fixture", small_model: "fixture/fixture", share: "disabled", autoupdate: false,
    provider: {fixture: {npm: "@ai-sdk/openai-compatible", name: "Synthetic only", options: {baseURL: receiver.url.origin + "/v1", apiKey: "synthetic-only"},
      models: {fixture: {name: "Synthetic", limit: {context: 100000, output: 4000}}}}},
    plugin: [pathToFileURL(plugin).href], permission: {"*": "deny", task: "allow"}, lsp: false, formatter: false}));
  const reserve = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response()}); const port = reserve.port; reserve.stop(true);
  const engine = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {cwd: folder,
    env: {PATH: process.env.PATH ?? "/usr/bin:/bin", XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
      OPENCODE_TEST_HOME: root, OPENCODE_CONFIG: config, OPENCODE_DB: join(root, "engine.sqlite"), OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", ...lawossEngineEnv({})}, stdout: "pipe", stderr: "pipe"});
  const stdout = new Response(engine.stdout).text(), stderr = new Response(engine.stderr).text();
  const base = `http://127.0.0.1:${port}`;
  const json = async (path: string, body?: unknown) => {
    const response = await fetch(base + path, {method: body === undefined ? "GET" : "POST", headers: {"content-type": "application/json"}, ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: AbortSignal.timeout(30000)});
    return {status: response.status, body: await response.json()};
  };
  try {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try {ready = (await fetch(base + "/global/health", {signal: AbortSignal.timeout(300)})).ok;} catch {}
      if (ready || engine.exitCode !== null) break;
      await Bun.sleep(100);
    }
    if (!ready) throw new Error("Synthetic engine startup failed: " + (engine.exitCode === null ? "timeout" : await stderr));
    const session = z.object({id: z.string()}).parse((await json("/session", {})).body);
    const allowed = await json(`/session/${session.id}/message`, {model: {providerID: "fixture", modelID: "fixture"}, parts: [{type: "text", text: "PUBLIC-SYNTHETIC-CANARY"}]});
    expect(allowed.status).toBe(200);
    expect(JSON.stringify(allowed.body)).toContain("Synthetic answer");
    expect(calls.some(call => call.body.includes("PUBLIC-SYNTHETIC-CANARY"))).toBe(true);
    expect(hooks).toContain("chat.params");
    const attachment = await json(`/session/${session.id}/message`, {model: {providerID: "fixture", modelID: "fixture"}, parts: [
      {type: "text", text: "PUBLIC-ATTACHMENT-PROMPT"},
      {type: "file", mime: "text/plain", filename: "synthetic.txt", url: "data:text/plain;base64," + Buffer.from("PUBLIC-ATTACHMENT-CANARY").toString("base64")},
    ]});
    expect(attachment.status).toBe(200);
    expect(calls.some(call => call.body.includes("PUBLIC-ATTACHMENT-CANARY"))).toBe(true);
    const beforeCompaction = calls.length;
    const compacted = await json(`/session/${session.id}/summarize`, {providerID: "fixture", modelID: "fixture", auto: false});
    expect(compacted.status).toBe(200);
    expect(calls.length).toBeGreaterThan(beforeCompaction);
    expect(hooks).toContain("compacting");
    mode = "task";
    const beforeTask = calls.length;
    const task = await json(`/session/${session.id}/message`, {model: {providerID: "fixture", modelID: "fixture"}, parts: [{type: "text", text: "Launch a public synthetic task."}]});
    expect(task.status).toBe(200);
    expect(calls.slice(beforeTask).some(call => call.body.includes("PUBLIC-SUBAGENT-CANARY"))).toBe(true);
    mode = "text";
    const beforeDeny = calls.length;
    await writeFile(control, "deny");
    const denied = await json(`/session/${session.id}/message`, {model: {providerID: "fixture", modelID: "fixture"}, parts: [{type: "text", text: "DENIED-SYNTHETIC-CANARY"}]});
    expect(calls.slice(beforeDeny).some(call => call.body.includes("DENIED-SYNTHETIC-CANARY"))).toBe(false);
    expect(JSON.stringify(denied.body)).toContain("synthetic-governance-denied");
    await json(`/session/${session.id}/summarize`, {providerID: "fixture", modelID: "fixture", auto: false});
    expect(calls.length).toBe(beforeDeny);
    const shell = await json(`/session/${session.id}/shell`, {agent: "build", command: "cat " + JSON.stringify(privateSource)});
    const shellReadPrivate = JSON.stringify(shell.body).includes("PRIVATE-FILESYSTEM-CANARY");
    expect(await readFile(privateSource, "utf8")).toBe("PRIVATE-FILESYSTEM-CANARY");
    console.log(JSON.stringify({engineSha256: createHash("sha256").update(await readFile(binary)).digest("hex"), hooks, allowedRequests: beforeDeny, deniedStatus: denied.status, deniedRequests: calls.length - beforeDeny, shellStatus: shell.status, shellReadPrivate}));
  } finally {
    engine.kill("SIGKILL"); await engine.exited; receiver.stop(true);
    const logs = await Promise.all([stdout, stderr]);
    if (process.env.LEGALWORK_TEST_ENGINE_DIAGNOSTICS === "1") console.log(logs.join("\n"));
    await rm(root, {recursive: true});
  }
}, 90000);
