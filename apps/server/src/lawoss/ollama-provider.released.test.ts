// LEGALWORK_TEST_OPENCODE_BIN selects the real engine; no installed profile or Ollama is used.
import { expect, test } from "bun:test";
import { nativeMcpBinary, nativeMcpEngine } from "../native-mcp-engine.test-support.js";
import { repairRuntimeProviders } from "../runtime-provider-repair.js";

test.skipIf(!nativeMcpBinary)("repaired Ollama is selectable and generates through Chat Completions before and after restart", async () => {
  const paths: string[] = [];
  const receiver = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    paths.push(path);
    if (request.method !== "POST" || path !== "/v1/chat/completions") return new Response(null, { status: 404 });
    const body = await request.json();
    expect(body.model).toBe("synthetic:latest");
    expect(body.stream).toBe(true);
    const chunk = (delta: unknown, finish_reason: string | null) => `data: ${JSON.stringify({
      id: "fixture", object: "chat.completion.chunk", created: 1, model: body.model,
      choices: [{ index: 0, delta, finish_reason }],
    })}\n\n`;
    return new Response(chunk({ role: "assistant", content: "local chat works" }, null) + chunk({}, "stop") + "data: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
  } });
  let engine: Awaited<ReturnType<typeof nativeMcpEngine>> | undefined;
  try {
    const repaired = repairRuntimeProviders({ ollama: {
      package: "@opencode/ai/providers/openai/responses", name: "Synthetic Ollama",
      settings: { baseURL: "http://localhost:11434/v1" },
      models: { "synthetic:latest": { name: "Synthetic model", limit: { context: 8192, output: 1024 } } },
    } });
    expect(repaired.repaired).toEqual(["ollama"]);
    const provider = repaired.providers.ollama;
    // Keep the production-repaired driver, but route inference to our disposable receiver, not port 11434.
    engine = await nativeMcpEngine({ providers: { ollama: {
      ...provider, settings: { ...provider.settings, baseURL: `${receiver.url.origin}/v1` },
    } } });
    for (const cycle of ["initial", "restart"]) {
      if (cycle === "restart") await engine.restart();
      const client = engine.client(), location = engine.location;
      const catalog = (await client.model.list({ location })).data;
      expect((await client.provider.list({ location })).data.some(item => item.id === "ollama")).toBe(true);
      expect(catalog.find(model => model.providerID === "ollama" && model.id === "synthetic:latest")?.package).toBe("@opencode/ai/providers/openai-compatible");
      const session = await client.session.create({ location, model: { providerID: "ollama", id: "synthetic:latest" } });
      const reply = await client.session.generate({ sessionID: session.id, prompt: "Synthetic transport check." }, { signal: AbortSignal.timeout(10_000) });
      expect(reply.text).toBe("local chat works");
    }
    expect(paths.filter(path => path === "/v1/chat/completions")).toHaveLength(2);
    expect(paths).not.toContain("/v1/responses");
  } finally {
    try { await engine?.close(); }
    finally { await receiver.stop(true); }
  }
}, 60_000);
