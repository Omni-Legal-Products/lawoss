import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { createMcpOAuthCallbackBroker } from "../../desktop/electron/mcp-oauth-callback.mjs";
import { createManagedOpencodeServer } from "./managed-opencode.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const repo = resolve(import.meta.dir, "../../..");
const target = process.platform === "darwin" ? "apple-darwin" : process.platform === "win32" ? "pc-windows-msvc.exe" : "unknown-linux-gnu";
const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
const binary = process.env.OPENCODE_TEST_BINARY ?? join(repo, "apps/desktop/resources/sidecars", `opencode-${arch}-${target}`);
if (process.env.OPENCODE_TEST_BINARY && !existsSync(binary)) throw new Error("OPENCODE_TEST_BINARY does not exist");
const statusesSchema = z.record(z.string(), z.object({ status: z.string() }));

async function freePort() {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = server.port;
  server.stop(true);
  if (!port) throw new Error("No local port allocated");
  return port;
}

async function waitFor(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return;
    await Bun.sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

test.skipIf(!existsSync(binary))("OAuth MCPs recover after an offline engine rebuild without another sign-in", async () => {
  const root = await mkdtemp(join(tmpdir(), "legalwork-mcp-network-"));
  const directory = join(root, "project");
  await mkdir(directory);
  let offline = false;
  const oauthPort = await freePort();
  const relay = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (offline) return new Response("Temporary network outage", { status: 503 });
    const url = new URL(request.url);
    url.port = String(oauthPort);
    return fetch(url, {
      method: request.method, headers: request.headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
      redirect: "manual",
    }).catch(() => new Response("Provider unavailable", { status: 503 }));
  } });
  const oauth = spawn("node", [join(repo, "scripts/mock-oauth-mcp-server.mjs")], {
    env: { ...process.env, PORT: String(oauthPort), ISSUER: relay.url.origin, AUTO_APPROVE: "1" }, stdio: "ignore",
  });
  const captures: Array<{ tools: string[]; results: string[] }> = [];
  let emitted = new Set<string>();
  const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const input = z.object({
      tools: z.array(z.object({ function: z.object({ name: z.string() }) })).default([]),
      messages: z.array(z.object({ role: z.string(), content: z.unknown().optional() })),
    }).parse(await request.json());
    const tools = input.tools.map(tool => tool.function.name);
    if (tools.length) captures.push({ tools, results: input.messages.filter(message => message.role === "tool").map(message => JSON.stringify(message.content)) });
    const next = ["notes_mock_echo", "tasks_mock_echo"].find(name => tools.includes(name) && !emitted.has(name));
    if (next) emitted.add(next);
    const delta = next ? { tool_calls: [{ index: 0, id: `call_${next}`, type: "function", function: {
      name: next, arguments: JSON.stringify({ text: `RECOVERED_${next}` }),
    } }] } : { content: "Synthetic connector check complete." };
    const chunk = (value: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "local-network-check", object: "chat.completion.chunk", created: 1, model: "local", choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`;
    return new Response(chunk({ role: "assistant", ...delta }, null) + chunk({}, next ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const callbacks = createMcpOAuthCallbackBroker();
  let engine: Awaited<ReturnType<typeof createManagedOpencodeServer>> | undefined;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "local-network-test", hostToken: "local-host-test",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], readOnly: false,
    workspaces: [{ id: "network", name: "Network check", path: directory, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [directory], configPath: join(root, "legalwork.json"), startedAt: Date.now(),
    tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  async function engineRequest(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
    if (!engine) throw new Error("Engine unavailable");
    const url = new URL(path, engine.url);
    url.searchParams.set("directory", directory);
    const response = await fetch(url, { method,
      headers: { authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    return response.json();
  }
  async function appRequest(path: string, body?: unknown) {
    if (!server) throw new Error("Server unavailable");
    const response = await fetch(`http://127.0.0.1:${server.port}/workspace/network/opencode${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: "Bearer local-network-test", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    return response.json();
  }
  async function prompt() {
    captures.length = 0;
    emitted = new Set();
    const session = z.object({ id: z.string() }).parse(await appRequest("/session", { title: "Synthetic network check" }));
    await appRequest(`/session/${session.id}/message`, {
      model: { providerID: "local", modelID: "local" },
      parts: [{ type: "text", text: "Read the synthetic notes and tasks using their connectors." }],
    });
    expect(captures[0]?.tools).toContain("notes_mock_echo");
    expect(captures[0]?.tools).toContain("tasks_mock_echo");
    expect(captures.at(-1)?.results.some(result => result.includes("RECOVERED_notes_mock_echo"))).toBe(true);
    expect(captures.at(-1)?.results.some(result => result.includes("RECOVERED_tasks_mock_echo"))).toBe(true);
  }
  try {
    await waitFor(async () => (await fetch(relay.url + "health")).ok, "local OAuth provider");
    const callbackPort = await freePort();
    const engineConfig = join(directory, "opencode.jsonc");
    const remote = { type: "remote", url: relay.url.origin + "/mcp", enabled: true, timeout: 1000, oauth: { callbackPort } };
    await writeFile(engineConfig, JSON.stringify({
      mcp: { notes: remote, tasks: remote }, permission: { "*": "allow" },
      provider: { local: { npm: "@ai-sdk/openai-compatible", name: "Local test", options: { baseURL: model.url.origin + "/v1", apiKey: "local-test" }, models: { local: { name: "Local", limit: { context: 128000, output: 4096 } } } } },
      enabled_providers: ["local"], model: "local/local", small_model: "local/local", share: "disabled", autoupdate: false, lsp: false, formatter: false,
    }));
    engine = await createManagedOpencodeServer({ bin: binary, cwd: directory, timeoutMs: 30_000, env: {
      OPENCODE_CONFIG: engineConfig, OPENCODE_CONFIG_CONTENT: "", OPENCODE_CONFIG_DIR: join(root, "policy"),
      OPENCODE_TEST_HOME: join(root, "home"), OPENCODE_DB: join(root, "engine.db"),
      XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
    } });
    config.opencodeBaseUrl = engine.url;
    config.opencodeUsername = engine.username;
    config.opencodePassword = engine.password;
    server = await startServer(config);
    await engineRequest("/mcp");
    for (const name of ["notes", "tasks"]) {
      const listener = await callbacks.listen({ redirectUri: `http://127.0.0.1:${callbackPort}/mcp/oauth/callback` });
      const flow = z.object({ authorizationUrl: z.string() }).parse(await engineRequest(`/mcp/${name}/auth`, {}));
      const state = new URL(flow.authorizationUrl).searchParams.get("state");
      if (!state) throw new Error("Missing OAuth state");
      const waiting = callbacks.wait({ listenerId: listener.listenerId, state });
      const consent = await fetch(flow.authorizationUrl, { redirect: "manual" });
      const redirect = consent.headers.get("location");
      if (!redirect) throw new Error("Missing OAuth redirect");
      expect((await fetch(redirect)).ok).toBe(true);
      expect(await engineRequest(`/mcp/${name}/auth/callback`, await waiting)).toEqual({ status: "connected" });
      await callbacks.close();
    }
    await prompt();
    const authFile = join(root, "data", "opencode", "mcp-auth.json");
    const savedAuth = await readFile(authFile, "utf8");
    const savedConfig = await readFile(engineConfig, "utf8");
    offline = true;
    await engineRequest("/instance/dispose", {});
    const failed = statusesSchema.parse(await engineRequest("/mcp"));
    expect(failed.notes.status).toBe("failed");
    expect(failed.tasks.status).toBe("failed");
    offline = false;
    // The same status refresh used by the desktop must repair the transports.
    await appRequest("/mcp");
    await waitFor(async () => {
      const statuses = statusesSchema.parse(await engineRequest("/mcp"));
      return statuses.notes.status === "connected" && statuses.tasks.status === "connected";
    }, "automatic connector recovery");
    await prompt();
    expect(await readFile(authFile, "utf8")).toBe(savedAuth);
    expect(await readFile(engineConfig, "utf8")).toBe(savedConfig);
    // A new chat turn must also recover tools without waiting for the next
    // status-bar poll or requiring the Integrations screen to be opened.
    offline = true;
    await engineRequest("/instance/dispose", {});
    expect(statusesSchema.parse(await engineRequest("/mcp")).notes.status).toBe("failed");
    offline = false;
    await prompt();
    expect(await readFile(authFile, "utf8")).toBe(savedAuth);
    expect(await readFile(engineConfig, "utf8")).toBe(savedConfig);
  } finally {
    callbacks.close();
    await engine?.close();
    await server?.stop();
    oauth.kill();
    relay.stop(true);
    model.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);
