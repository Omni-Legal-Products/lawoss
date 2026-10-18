import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;

for (const rejection of [false, true]) test.skipIf(!binary)(`pinned engine Gemini stream/tool round trip ${rejection ? "records a scoped provider rejection" : "preserves opaque reasoning"}`, async () => {
  if (!binary) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "gemini-wire-")));
  const project = join(root, "project"); await mkdir(project);
  await writeFile(join(project, "fixture.txt"), "synthetic fixture");
  const wires: Record<string, unknown>[] = [];
  const witnesses: Record<string, unknown>[] = [];
  const detail = { type: "reasoning.encrypted", data: "synthetic-opaque-signature", id: "call_fixture", format: "google-gemini-v1", index: 0 };
  const fixture = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/workspaces") return Response.json({ items: [{ id: "fixture", path: project }] });
    if (url.pathname.endsWith("/provider-failure")) { witnesses.push(await request.json()); return Response.json({ ok: true }); }
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") return Response.json({}, { status: 404 });
    const body = z.object({ messages: z.array(z.object({ role: z.string() }).passthrough()) }).passthrough().parse(await request.json()); wires.push(body);
    const hasTool = body.messages.some(message => message.role === "tool");
    expect(request.headers.has("x-lawoss-provider-observation")).toBe(false);
    if (rejection && hasTool) return Response.json({ error: { message: "Corrupted thought signature." } }, { status: 400 });
    const chunk = (delta: unknown, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "google/gemini-3-flash-preview", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    return new Response(hasTool ? chunk({ role: "assistant", content: "Fixture read." }) + chunk({}, "stop") + "data: [DONE]\n\n"
      : chunk({ role: "assistant", reasoning_details: [{ type: "reasoning.text", text: "Read the fixture.", format: "google-gemini-v1", index: 0 }] })
        + chunk({ reasoning_details: [detail], tool_calls: [{ index: 0, id: "call_fixture", type: "function", function: { name: "read", arguments: JSON.stringify({ filePath: join(project, "fixture.txt") }) } }] })
        + chunk({}, "tool_calls") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }), port = reservation.port;
  reservation.stop(true);
  const config = join(root, "config.json");
  await writeFile(config, JSON.stringify({ enabled_providers: ["openrouter"], model: "openrouter/google/gemini-3-flash-preview", small_model: "openrouter/google/gemini-3-flash-preview", share: "disabled", autoupdate: false,
    provider: { openrouter: { npm: "@openrouter/ai-sdk-provider", options: { baseURL: fixture.url.origin + "/v1", apiKey: "synthetic" }, models: { "google/gemini-3-flash-preview": { name: "Synthetic Gemini", limit: { context: 100000, output: 4000 } } } } },
    permission: { read: "allow" }, lsp: false, formatter: false,
    plugin: [pathToFileURL(join(import.meta.dir, "legalwork-capabilities-knowledge.ts")).href],
  }));
  const engine = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: project, env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("OPENCODE_") && !key.startsWith("LEGALWORK_"))),
    XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
    OPENCODE_TEST_HOME: root, OPENCODE_CONFIG: config, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
    LEGALWORK_SERVER_URL: fixture.url.origin, LEGALWORK_WIKI_AGENT_TOKEN: "synthetic-engine",
  }, stdout: "pipe", stderr: "pipe" });
  const logs = new Response(engine.stderr).text();
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 200; i++) {
      try { ready = (await fetch(base + "/global/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { /* Startup. */ }
      if (ready || engine.exitCode !== null) break;
      await Bun.sleep(100);
    }
    if (!ready) throw new Error("Engine did not start: " + (engine.exitCode !== null ? await logs : "timed out"));
    const session = await (await fetch(base + "/session", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    const response = await fetch(`${base}/session/${session.id}/message`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "build", model: { providerID: "openrouter", modelID: "google/gemini-3-flash-preview" }, parts: [{ type: "text", text: "Read the synthetic fixture." }] }), signal: AbortSignal.timeout(60000) });
    expect(response.status, await response.text()).toBe(200);
    if (!rejection) {
      expect((await fetch(base + "/instance/dispose", { method: "POST" })).status).toBe(200);
      const resumed = await fetch(`${base}/session/${session.id}/message`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: "build", model: { providerID: "openrouter", modelID: "google/gemini-3-flash-preview" }, parts: [{ type: "text", text: "Confirm the previously read fixture after reload." }] }), signal: AbortSignal.timeout(60000) });
      expect(resumed.status, await resumed.text()).toBe(200);
    }
    const tools = wires.filter(wire => JSON.stringify(wire.messages).includes('"role":"tool"'));
    expect(tools.length).toBeGreaterThan(0);
    for (const wire of tools) {
      const messages = z.array(z.object({ role: z.string(), reasoning_details: z.array(z.unknown()).optional() })).parse(wire.messages);
      expect(messages.filter(message => message.role === "assistant").flatMap(message => message.reasoning_details ?? [])).toEqual([detail]);
    }
    const messages = await (await fetch(`${base}/session/${session.id}/message`)).json();
    if (rejection) {
      expect(witnesses.length).toBeGreaterThan(0);
      expect(witnesses.every(witness => witness.messageId === messages.at(-1).info.id && witness.userMessageId === messages.at(-1).info.parentID)).toBe(true);
    } else expect(witnesses).toEqual([]);
  } finally {
    engine.kill("SIGKILL"); await engine.exited; fixture.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 90000);
