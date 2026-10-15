import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
// Build the plugin with `pnpm --filter legalwork-server build` before running.
const cases = [
  { name: "allowed", permission: {}, available: true, permitted: true },
  { name: "read denied", permission: { read: "deny" }, available: true, permitted: false },
  { name: "tool denied", permission: { legalwork_tool_output_read: "deny" }, available: false, permitted: false },
  { name: "wildcard denied", permission: { "*": "deny" }, available: false, permitted: false },
];

for (const scenario of cases) test.skipIf(!binary)(`bundled saved-output retrieval through a native explore child: ${scenario.name}`, async () => {
  if (!binary) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "tool-output-engine-")));
  const project = join(root, "project"); await mkdir(project);
  const offered: string[][] = [];
  const childTools: string[][] = [];
  const recovered: string[] = [];
  const payload = JSON.stringify({ padding: "a".repeat(80000), result: "requested section beyond the long line" });
  let savedPath = "";
  const fixture = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp") {
      if (request.method !== "POST") return new Response(null, { status: 405 });
      const rpc = z.object({ id: z.union([z.string(), z.number()]).optional(), method: z.string() }).parse(await request.json());
      if (rpc.id === undefined) return new Response(null, { status: 202 });
      const result = rpc.method === "initialize" ? { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } }
        : rpc.method === "tools/list" ? { tools: [{ name: "large_output", description: "Return a synthetic large output", inputSchema: { type: "object", properties: {} } }] }
        : rpc.method === "tools/call" ? { content: [{ type: "text", text: payload }] } : {};
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result });
    }
    const input = z.object({ messages: z.array(z.object({ role: z.string(), content: z.unknown() })), tools: z.array(z.object({ function: z.object({ name: z.string() }) })).optional() }).parse(await request.json());
    const names = input.tools?.map(tool => tool.function.name) ?? [];
    if (names.length) offered.push(names);
    const toolResults = input.messages.filter(message => message.role === "tool");
    const isExplore = input.messages.some(message => message.role === "user" && JSON.stringify(message.content).includes("Inspect saved response marker"));
    if (isExplore) childTools.push(names);
    let call: { name: string; arguments: string } | undefined;
    if (names.includes("fixture_large_output") && toolResults.length === 0) call = { name: "fixture_large_output", arguments: "{}" };
    else if (names.includes("fixture_large_output") && toolResults.length === 1) {
      const output = JSON.stringify(toolResults[0]?.content);
      savedPath = output.match(/Full output saved to: (.*?)(?:\\n|"|$)/)?.[1] ?? "";
      call = { name: "task", arguments: JSON.stringify({ description: "Inspect saved response", subagent_type: "explore", prompt: `Inspect saved response marker. Use legalwork_tool_output_read to search the saved output at ${savedPath} for requested section.` }) };
    } else if (isExplore && names.includes("legalwork_tool_output_read") && toolResults.length === 0) {
      call = { name: "legalwork_tool_output_read", arguments: JSON.stringify({ outputPath: savedPath, query: "requested section" }) };
    } else if (isExplore && toolResults.length) recovered.push(JSON.stringify(toolResults));
    const chunk = (delta: unknown, finish_reason: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    return new Response(chunk({ role: "assistant", ...(call ? { tool_calls: [{ index: 0, id: "call_fixture_" + toolResults.length, type: "function", function: call }] } : { content: "Finished reading the fixture." }) }, null)
      + chunk({}, call ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() }), port = reservation.port;
  reservation.stop(true);
  const config = join(root, "config.json");
  await writeFile(config, JSON.stringify({ enabled_providers: ["fixture"], model: "fixture/fixture", small_model: "fixture/fixture", share: "disabled", autoupdate: false,
    provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "Fixture", options: { baseURL: fixture.url.origin + "/v1", apiKey: "fixture" }, models: { fixture: { name: "Fixture", limit: { context: 100000, output: 4000 } } } } },
    plugin: [pathToFileURL(join(import.meta.dir, "../../dist/opencode-plugins/legalwork-tool-output.js")).href],
    mcp: { fixture: { type: "remote", url: fixture.url.origin + "/mcp", oauth: false } },
    // Mirrors the runtime default. Explore keeps its native deny-* boundary.
    permission: { legalwork_tool_output_read: "allow", read: "allow", task: "allow", ...scenario.permission },
    // Keep the producer and delegation available even when testing a global denial.
    agent: { build: { permission: { fixture_large_output: "allow", task: "allow" } } }, lsp: false, formatter: false,
  }));
  const engine = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: project, env: {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("OPENCODE_") && !key.startsWith("LEGALWORK_"))),
    XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
    OPENCODE_TEST_HOME: root, OPENCODE_CONFIG: config, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
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
    const session = z.object({ id: z.string() }).parse(await (await fetch(base + "/session", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json());
    const response = await fetch(`${base}/session/${session.id}/message`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "build", model: { providerID: "fixture", modelID: "fixture" }, parts: [{ type: "text", text: "Inspect the synthetic oversized connector result through a child agent." }] }), signal: AbortSignal.timeout(60000) });
    expect(response.status, await response.text()).toBe(200);
    expect(savedPath).toContain("tool-output");
    expect(offered.some(names => names.includes("fixture_large_output"))).toBe(true);
    expect(childTools.length).toBeGreaterThan(0);
    expect(childTools.some(names => names.includes("legalwork_tool_output_read"))).toBe(scenario.available);
    if (scenario.permitted) {
      expect(recovered).toHaveLength(1);
      expect(recovered[0]).toContain("requested section beyond the long line");
      expect(recovered[0]).toContain('\\"found\\":true');
    } else {
      expect(recovered.join(" ")).not.toContain("requested section beyond the long line");
      if (scenario.available) {
        expect(recovered).toHaveLength(1);
        expect(recovered[0]).toContain("permission");
      }
    }
  } finally {
    engine.kill("SIGKILL"); await engine.exited; fixture.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 90000);
