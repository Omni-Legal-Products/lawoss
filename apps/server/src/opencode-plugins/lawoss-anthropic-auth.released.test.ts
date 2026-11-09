// LAWOSS: prihlásenie Anthropic v skutočnom engine v2 (LEGALWORK_TEST_OPENCODE_BIN). Engine načíta pribalený
// plugin, ponúkne jeho metódy na integrácii anthropic a požiadavka modelu so syntetickým záznamom predplatného
// príde na falošné API Anthropic s hlavičkami a telom predplatného. Žiadny skutočný token ani sieť mimo loopbacku.
import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { nativeDomainEngine } from "./native-domain-engine.test-support.js";
import { CLAUDE_CODE_SYSTEM, CLAUDE_CODE_USER_AGENT, CREATE_KEY_METHOD, SUBSCRIPTION_METHOD } from "./lawoss-anthropic-auth.js";

const sse = (events: Array<[string, unknown]>) => events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
const reply = () => new Response(sse([
  ["message_start", { type: "message_start", message: { id: "msg_fixture", type: "message", role: "assistant", model: "claude-fixture", content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
  ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Fixture checked." } }],
  ["content_block_stop", { type: "content_block_stop", index: 0 }],
  ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } }],
  ["message_stop", { type: "message_stop" }],
]), { headers: { "content-type": "text/event-stream" } });

test.skipIf(!process.env.LEGALWORK_TEST_OPENCODE_BIN)("released engine loads the bundled Anthropic sign-in and sends subscription requests", async () => {
  const received: Array<{ url: string; headers: Record<string, string>; body: { system?: Array<{ text?: string }>; tools?: Array<{ name: string }> } }> = [];
  const anthropic = Bun.serve({ port: 0, async fetch(request) {
    received.push({ url: request.url, headers: Object.fromEntries(request.headers), body: await request.json() });
    return reply();
  } });
  let host: Awaited<ReturnType<typeof nativeDomainEngine>> | undefined;
  try {
    host = await nativeDomainEngine({ binary: process.env.LEGALWORK_TEST_OPENCODE_BIN!, modelURL: `${anthropic.url.origin}/v1`,
      plugins: [resolve(import.meta.dir, "lawoss-anthropic-auth.ts")],
      configuration: {
        model: "anthropic/claude-fixture",
        agents: { legalwork: { mode: "primary" } },
        permissions: [{ action: "*", resource: "*", effect: "allow" }],
        providers: { anthropic: { package: "@opencode/ai/providers/anthropic", settings: { baseURL: `${anthropic.url.origin}/v1` }, models: {
          "claude-fixture": { limit: { context: 200000, output: 4096 }, capabilities: { tools: true } },
        } } },
        policies: [{ action: "provider.use", resource: "*", effect: "deny" }, { action: "provider.use", resource: "anthropic", effect: "allow" }],
      },
    });
    const integration = (await host.client.integration.get({ location: host.location, integrationID: "anthropic" })).data;
    const methods = integration.methods.map(method => [method.type, "id" in method ? method.id : undefined, "label" in method ? method.label : undefined]);
    expect(methods).toEqual(expect.arrayContaining([["oauth", SUBSCRIPTION_METHOD, "Claude Pro/Max"], ["oauth", CREATE_KEY_METHOD, "Create an API Key"]]));
    expect(methods.some(([type]) => type === "key")).toBe(true);

    await host.client.credential.create({ integrationID: "anthropic", label: "Synthetic subscription", activate: true,
      value: { type: "oauth", methodID: SUBSCRIPTION_METHOD, access: "synthetic-subscription-access", refresh: "synthetic-refresh", expires: Date.now() + 3_600_000 } });
    const session = await host.client.session.create({ location: host.location, agent: "legalwork", model: { providerID: "anthropic", id: "claude-fixture" } });
    await host.client.session.prompt({ sessionID: session.id, text: "Synthetic question." });
    await host.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(30_000) });

    const primary = received.find(request => (request.body.tools?.length ?? 0) > 0) ?? received[0];
    if (!primary) throw new Error(`The fake Anthropic API received no request: ${JSON.stringify(await host.client.session.context({ sessionID: session.id })).slice(0, 2000)}`);
    const url = new URL(primary.url);
    expect(url.pathname).toBe("/v1/messages");
    expect(url.searchParams.get("beta")).toBe("true");
    expect(primary.headers.authorization).toBe("Bearer synthetic-subscription-access");
    expect(primary.headers["x-api-key"]).toBeUndefined();
    expect(primary.headers["user-agent"]).toBe(CLAUDE_CODE_USER_AGENT);
    expect(primary.headers["anthropic-beta"]?.split(",").slice(0, 2)).toEqual(["oauth-2025-04-20", "interleaved-thinking-2025-05-14"]);
    expect(primary.body.system?.[0]?.text).toBe(CLAUDE_CODE_SYSTEM);
    expect(JSON.stringify(primary.body.system)).not.toContain("OpenCode");
    for (const tool of primary.body.tools ?? []) expect(tool.name.startsWith("mcp_")).toBe(true);
    // Every model request of the turn went through the subscription headers, title requests included.
    for (const request of received) expect(request.headers.authorization).toBe("Bearer synthetic-subscription-access");
    expect(JSON.stringify(await host.client.session.context({ sessionID: session.id }))).toContain("Fixture checked.");
  } finally { await host?.close(); anthropic.stop(true); }
}, 90_000);
