// LAWOSS: chat prípadu v skutočnom engine (voliteľné, LEGALWORK_TEST_OPENCODE_BIN = pribalený 1.18.29).
// Chat založený pod prípadom (podpriečinok klienta) dostane prvú správu cez front servera a jeho nástroje
// bežia v priečinku prípadu: vstavaný `read` s relatívnou cestou aj spravovaný shell (`legalwork_shell`
// cez server). Chat klienta beží v koreni klienta. Údaje sú syntetické; HOME/XDG enginu sú dočasné.
//   LEGALWORK_TEST_OPENCODE_BIN=/Applications/LAWOSS.app/Contents/Resources/sidecars/opencode \
//     pnpm --filter legalwork-server exec bun test src/lawoss/matter-chat-engine.integration.test.ts
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { startServer } from "../server.js";
import { closeRuntimeOpencodeConfig, GLOBAL_TOOL_PERMISSIONS_ID, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { ensureWikiAgentToken } from "../wiki/agent-access.js";
import { removeTestDir } from "./test-support/remove-test-dir.js";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const toolPart = z.object({ type: z.literal("tool"), tool: z.string(), state: z.object({ status: z.string(), output: z.string().optional(), error: z.string().optional() }).passthrough() }).passthrough();
const messages = z.array(z.object({ parts: z.array(z.object({ type: z.string() }).passthrough()) }));

test.skipIf(!binary)("chat prípadu prijme prvú správu cez front a jeho nástroje bežia v priečinku prípadu; chat klienta v koreni klienta", async () => {
  if (!binary) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-matter-chat-")));
  const clientA = join(root, "prax", "Klient_A"), matterA = join(clientA, "Spisy", "M001-Úhrada"), clientB = join(root, "prax", "Klient-A");
  for (const folder of [matterA, clientB, join(root, "engine")]) await mkdir(folder, { recursive: true });
  await writeFile(join(matterA, "podklad.txt"), "OBSAH-PRIPADU");
  await writeFile(join(clientA, "podklad.txt"), "OBSAH-KLIENTA");

  const env = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE, db: process.env.LEGALWORK_RUNTIME_DB };
  process.env.LEGALWORK_DATA_DIR = join(root, "data"); process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json"); process.env.LEGALWORK_RUNTIME_DB = join(root, "private", "runtime.sqlite");
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() }), enginePort = reservation.port;
  reservation.stop(true);
  const engineUrl = `http://127.0.0.1:${enginePort}`;
  const workspace = (id: string, path: string) => ({ id, name: id, preset: "starter", path, workspaceType: "local" as const, baseUrl: engineUrl });
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, configPath: join(root, "private", "server.json"), token: "client", hostToken: "host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [workspace("klient-a", clientA), workspace("klient-b", clientB)],
    authorizedRoots: [clientA, clientB], agentSandboxEnabled: true, readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  // Advokát povolil príkazy a čítanie bez otázky; ide o priečinok, nie o povolenia.
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, () => ({ permission: { bash: "allow", read: "allow", edit: "allow", webfetch: "allow" } }));

  // Model na skúšku: v prvom kroku zavolá spravovaný shell (`pwd`) a `read` s relatívnou cestou.
  const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const input = z.object({ messages: z.array(z.object({ role: z.string() })) }).parse(await request.json());
    const first = input.messages.every((message) => message.role !== "tool");
    const calls = [
      { index: 0, id: "call_pwd", type: "function", function: { name: "legalwork_shell", arguments: JSON.stringify({ command: "pwd", description: "Pracovný priečinok" }) } },
      { index: 1, id: "call_read", type: "function", function: { name: "read", arguments: JSON.stringify({ filePath: "podklad.txt" }) } },
    ];
    const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    return new Response(chunk({ role: "assistant", ...(first ? { tool_calls: calls } : { content: "Hotovo." }) }, null) + chunk({}, first ? "tool_calls" : "stop") + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } });
  } });
  const server = await startServer(config);
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, "..", "opencode-plugins", "legalwork-sandbox.ts")], outdir: join(root, "plugin"), target: "node", format: "esm" });
  expect(build.success).toBe(true);
  const engineConfig = join(root, "engine", "opencode.json");
  await writeFile(engineConfig, JSON.stringify({
    enabled_providers: ["fixture"], model: "fixture/fixture", small_model: "fixture/fixture", share: "disabled", autoupdate: false, lsp: false, formatter: false,
    provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "Fixture", options: { baseURL: model.url.origin + "/v1", apiKey: "fixture" }, models: { fixture: { name: "Fixture", limit: { context: 100000, output: 4000 } } } } },
    plugin: [pathToFileURL(build.outputs[0]!.path).href], permission: { "*": "allow" },
  }));
  const home = join(root, "engine");
  const engine = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(enginePort)], { cwd: home, env: {
    PATH: process.env.PATH ?? "", HOME: join(home, "home"), OPENCODE_TEST_HOME: join(home, "home"),
    XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "data"), XDG_CACHE_HOME: join(home, "cache"), XDG_STATE_HOME: join(home, "state"),
    OPENCODE_CONFIG: engineConfig, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
    LEGALWORK_SERVER_URL: `http://127.0.0.1:${server.port}`, LEGALWORK_WIKI_AGENT_TOKEN: await ensureWikiAgentToken(config),
  }, stdout: "ignore", stderr: "pipe" });
  const logs = new Response(engine.stderr).text();
  const call = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { ...init, headers: { authorization: "Bearer client", "content-type": "application/json" }, signal: AbortSignal.timeout(90_000) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };

  /** Založí chat v `directory` cez proxy klienta A (ako appka), pošle prvú správu cez front a vráti výsledky nástrojov. */
  const chat = async (directory: string) => {
    const created = await call(`/workspace/klient-a/opencode/session?${new URLSearchParams({ directory })}`, { method: "POST", body: "{}" });
    expect(created.status).toBe(200);
    const session = z.object({ id: z.string(), directory: z.string() }).parse(created.body);
    expect(session.directory).toBe(directory);
    const id = crypto.randomUUID();
    const enqueued = await call(`/workspace/klient-a/sessions/${session.id}/queue`, { method: "POST", body: JSON.stringify({ type: "enqueue", id,
      draft: { mode: "prompt", text: "Kde si?", parts: [], attachments: [], editor: { mentions: {}, pasteParts: [] } },
      execution: { kind: "prompt", agent: "build", model: { providerID: "fixture", modelID: "fixture" }, parts: [{ type: "text", text: "Kde si?" }] } }) });
    expect(enqueued.status).toBe(200);
    const queue = z.object({ entries: z.array(z.object({ status: z.string(), error: z.string().optional() }).passthrough()), completedIds: z.array(z.string()) }).passthrough();
    let state = queue.parse((await call(`/workspace/klient-a/sessions/${session.id}/queue`)).body);
    for (let attempt = 0; attempt < 600 && !state.completedIds.includes(id) && !state.entries.some((entry) => entry.status === "failed"); attempt++) {
      await Bun.sleep(100);
      state = queue.parse((await call(`/workspace/klient-a/sessions/${session.id}/queue`)).body);
    }
    expect({ completed: state.completedIds.includes(id), entries: state.entries }).toEqual({ completed: true, entries: [] });
    const read = await call(`/workspace/klient-a/opencode/session/${session.id}/message?${new URLSearchParams({ directory })}`);
    expect(read.status).toBe(200);
    const tools = messages.parse(read.body).flatMap((message) => message.parts).flatMap((part) => { const parsed = toolPart.safeParse(part); return parsed.success ? [parsed.data] : []; });
    return { id: session.id, tools: Object.fromEntries(tools.map((tool) => [tool.tool, { status: tool.state.status, output: tool.state.output ?? tool.state.error ?? "" }])) };
  };

  try {
    let ready = false;
    for (let i = 0; i < 300 && !ready && engine.exitCode === null; i++) {
      try { ready = (await fetch(`${engineUrl}/global/health`, { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Engine štartuje. */ }
      if (!ready) await Bun.sleep(100);
    }
    if (!ready) throw new Error(`Engine did not start: ${engine.exitCode !== null ? await logs : "timed out"}`);

    const matter = await chat(matterA);
    expect(matter.tools.legalwork_shell).toEqual({ status: "completed", output: expect.stringContaining(matterA) });
    expect(matter.tools.legalwork_shell?.output.trim()).toBe(matterA);
    expect(matter.tools.read).toEqual({ status: "completed", output: expect.stringContaining("OBSAH-PRIPADU") });
    expect(matter.tools.read?.output).toContain(join(matterA, "podklad.txt"));

    const client = await chat(clientA);
    expect(client.tools.legalwork_shell?.output.trim()).toBe(clientA);
    expect(client.tools.read).toEqual({ status: "completed", output: expect.stringContaining("OBSAH-KLIENTA") });

    // Klient B (súrodenec `Klient-A`) chat prípadu klienta A nevidí ani neriadi.
    expect((await call(`/workspace/klient-b/sessions/${matter.id}/queue`)).status).toBe(404);
    expect((await call(`/workspace/klient-b/sandbox/session/${matter.id}`)).status).toBe(403);
  } finally {
    engine.kill("SIGKILL");
    await engine.exited;
    await server.stop();
    model.stop(true);
    closeRuntimeOpencodeConfig(config);
    for (const [key, value] of Object.entries({ LEGALWORK_DATA_DIR: env.data, LEGALWORK_TOKEN_STORE: env.tokens, LEGALWORK_RUNTIME_DB: env.db }))
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await removeTestDir(root);
  }
}, 240_000);
