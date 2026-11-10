// LAWOSS: prihlásenie Anthropic na engine v2 (náhrada npm balíka v1 `opencode-anthropic-auth`). Skutočný setup
// pluginu nad falošným poskytovateľom: ponúknuté metódy, PKCE, výmena kódu a obnova tokenu proti falošnému
// koncovému bodu, hlavičky, telo a odpoveď požiadavky na falošné API Anthropic. Len syntetické tokeny.
import { afterEach, describe, expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin";
import type { IntegrationMethodRegistration, IntegrationOAuthMethodRegistration } from "@opencode/plugin/promise/integration";
import LawossAnthropicAuth, { CLAUDE_CODE_SYSTEM, CLAUDE_CODE_USER_AGENT, CREATE_KEY_METHOD, SUBSCRIPTION_METHOD, sanitizeSystemText } from "./lawoss-anthropic-auth.js";
import { nativePluginTestRuntime } from "./native-plugin-test-support.js";

type Connection = { type: "credential"; id: string; label: string; method: "key" | "oauth" | "external" } | { type: "env"; name: string };
type Value = { type: "oauth"; methodID: string; access: string; refresh: string; expires: number } | { type: "key"; key: string };
type Model = { id: string; providerID: string; cost: unknown[] };

/** Upstream test runtime plus the integration, model and event domains this plugin uses. */
async function anthropicRuntime(initial: { connection?: Connection; value?: Value } = {}) {
  const runtime = nativePluginTestRuntime();
  const methods: IntegrationMethodRegistration[] = [];
  const models: Model[] = [{ id: "claude-sonnet-5-5", providerID: "anthropic", cost: [{ input: 3, output: 15 }] }, { id: "gpt-6-luna", providerID: "openai", cost: [{ input: 1, output: 2 }] }];
  const state = { connection: initial.connection, value: initial.value, reloads: 0 };
  const modelTransforms: Array<(editor: unknown) => void> = [];
  const applyModels = () => { for (const transform of modelTransforms) transform({
    list: (providerID?: string) => models.filter(model => !providerID || model.providerID === providerID),
    update: (providerID: string, id: string, update: (draft: Model) => void) => { const model = models.find(item => item.providerID === providerID && item.id === id); if (model) update(model); },
  }); };
  const ctx = new Proxy(runtime.ctx, { get(target, property, receiver) {
    if (property === "options") return {};
    if (property === "integration") return {
      transform: async (callback: (editor: unknown) => void) => { callback({ method: { update: (input: IntegrationMethodRegistration) => { methods.push(input); } } }); return { dispose: async () => {} }; },
      connection: { active: async (id: string) => id === "anthropic" ? state.connection : undefined, resolve: async () => state.value },
    };
    if (property === "model") return {
      transform: async (callback: (editor: unknown) => void) => { modelTransforms.push(callback); applyModels(); return { dispose: async () => {} }; },
      reload: async () => { state.reloads++; applyModels(); },
    };
    return Reflect.get(target, property, receiver);
  } });
  const plugin: Plugin.Plugin = LawossAnthropicAuth;
  const cleanup = await plugin.setup(ctx);
  const send = async (request: Request, receive: (request: Request) => Promise<Response>) => {
    const event = { sessionID: "ses_anthropic", agent: "legalwork", model: { providerID: "anthropic", id: "claude-sonnet-5-5" }, kind: "primary", request };
    await runtime.hook("session", "http.request", event);
    const received = { ...event, response: await receive(event.request) };
    await runtime.hook("session", "http.response", received);
    return { sent: event.request, response: received.response };
  };
  return { methods, models, state, send, close: async () => { if (cleanup) await cleanup(); await runtime.close(); } };
}

const subscription = (access = "synthetic-access"): { connection: Connection; value: Value } => ({
  connection: { type: "credential", id: "cred_synthetic", label: "OAuth", method: "oauth" },
  value: { type: "oauth", methodID: SUBSCRIPTION_METHOD, access, refresh: "synthetic-refresh", expires: Date.now() + 3_600_000 },
});

const messagesRequest = (body: unknown, headers: Record<string, string> = {}) => new Request("https://api.anthropic.com/v1/messages", {
  method: "POST", headers: { "content-type": "application/json", "anthropic-beta": "fine-grained-tool-streaming-2025-05-14", "x-api-key": "", ...headers },
  body: JSON.stringify(body),
});

const oauthMethods = (methods: IntegrationMethodRegistration[]) => methods.filter((method): method is IntegrationOAuthMethodRegistration => method.method.type === "oauth");

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("LAWOSS: Anthropic sign-in on engine v2", () => {
  test("offers Claude Pro/Max and Create an API Key on the anthropic integration", async () => {
    const fixture = await anthropicRuntime();
    try {
      expect(oauthMethods(fixture.methods).map(method => [method.integrationID, method.method.id, method.method.label]))
        .toEqual([["anthropic", SUBSCRIPTION_METHOD, "Claude Pro/Max"], ["anthropic", CREATE_KEY_METHOD, "Create an API Key"]]);
      // Only the subscription renews; a created API key does not expire.
      expect(oauthMethods(fixture.methods).map(method => typeof method.refresh)).toEqual(["function", "undefined"]);
    } finally { await fixture.close(); }
  });

  test("Claude Pro/Max: PKCE URL, code exchange and token refresh against a fake token endpoint", async () => {
    const fixture = await anthropicRuntime();
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return Response.json({ access_token: `synthetic-access-${calls.length}`, refresh_token: `synthetic-refresh-${calls.length}`, expires_in: 3600 });
    }, { preconnect: originalFetch.preconnect });
    try {
      const method = oauthMethods(fixture.methods)[0]!;
      const authorization = await method.authorize({});
      expect(authorization.mode).toBe("code");
      const url = new URL(authorization.url);
      expect(url.origin + url.pathname).toBe("https://claude.ai/oauth/authorize");
      expect(Object.fromEntries(url.searchParams)).toMatchObject({ code: "true", client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e", response_type: "code",
        redirect_uri: "https://console.anthropic.com/oauth/code/callback", scope: "org:create_api_key user:profile user:inference", code_challenge_method: "S256" });
      const verifier = url.searchParams.get("state")!;
      expect(url.searchParams.get("code_challenge")).toBe(Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).toString("base64url"));
      if (authorization.mode !== "code") throw new Error("Code mode expected");
      const credential = await authorization.callback("synthetic-code#synthetic-state");
      expect(calls[0]).toEqual({ url: "https://console.anthropic.com/v1/oauth/token", body: { code: "synthetic-code", state: "synthetic-state", grant_type: "authorization_code",
        client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e", redirect_uri: "https://console.anthropic.com/oauth/code/callback", code_verifier: verifier } });
      expect(credential).toMatchObject({ type: "oauth", methodID: SUBSCRIPTION_METHOD, access: "synthetic-access-1", refresh: "synthetic-refresh-1" });
      expect(credential.expires).toBeGreaterThan(Date.now());
      const renewed = await method.refresh!(credential);
      expect(calls[1]?.body).toEqual({ grant_type: "refresh_token", refresh_token: "synthetic-refresh-1", client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e" });
      expect(renewed).toMatchObject({ type: "oauth", methodID: SUBSCRIPTION_METHOD, access: "synthetic-access-2", refresh: "synthetic-refresh-2" });
    } finally { await fixture.close(); }
  });

  test("a failed exchange is an error, not a credential", async () => {
    const fixture = await anthropicRuntime();
    globalThis.fetch = Object.assign(async () => new Response("denied", { status: 400 }), { preconnect: originalFetch.preconnect });
    try {
      const authorization = await oauthMethods(fixture.methods)[0]!.authorize({});
      if (authorization.mode !== "code") throw new Error("Code mode expected");
      await expect(authorization.callback("synthetic-code#state")).rejects.toThrow("Anthropic sign-in failed (HTTP 400).");
    } finally { await fixture.close(); }
  });

  test("Create an API Key stores the created key and sends it as x-api-key", async () => {
    const fixture = await anthropicRuntime();
    const calls: Array<{ url: string; authorization: string | null }> = [];
    globalThis.fetch = Object.assign(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization") });
      return String(input).endsWith("/create_api_key") ? Response.json({ raw_key: "synthetic-created-key" })
        : Response.json({ access_token: "synthetic-console-access", refresh_token: "synthetic-console-refresh", expires_in: 3600 });
    }, { preconnect: originalFetch.preconnect });
    try {
      const authorization = await oauthMethods(fixture.methods)[1]!.authorize({});
      expect(new URL(authorization.url).host).toBe("console.anthropic.com");
      if (authorization.mode !== "code") throw new Error("Code mode expected");
      const credential = await authorization.callback("synthetic-code#state");
      expect(calls.map(call => call.url)).toEqual(["https://console.anthropic.com/v1/oauth/token", "https://api.anthropic.com/api/oauth/claude_cli/create_api_key"]);
      expect(calls[1]?.authorization).toBe("Bearer synthetic-console-access");
      expect(credential).toMatchObject({ type: "oauth", methodID: CREATE_KEY_METHOD, access: "synthetic-created-key", refresh: "", expires: Number.MAX_SAFE_INTEGER });
      fixture.state.connection = { type: "credential", id: "cred_key", label: "OAuth", method: "oauth" };
      fixture.state.value = { type: "oauth", methodID: CREATE_KEY_METHOD, access: "synthetic-created-key", refresh: "", expires: Number.MAX_SAFE_INTEGER };
      const body = { model: "claude-sonnet-5-5", system: [{ type: "text", text: "LegalWork agent" }], messages: [] };
      const { sent } = await fixture.send(messagesRequest(body, { authorization: "Bearer synthetic-created-key" }), async () => new Response("{}"));
      expect(sent.headers.get("x-api-key")).toBe("synthetic-created-key");
      expect(sent.headers.get("authorization")).toBeNull();
      expect(new URL(sent.url).search).toBe("");
      expect(await sent.json()).toEqual(body);
    } finally { await fixture.close(); }
  });

  test("subscription request: headers, beta query, system prefix and tool names; response names restored", async () => {
    const fixture = await anthropicRuntime(subscription());
    try {
      const body = {
        model: "claude-sonnet-5-5",
        system: [{ type: "text", text: "You are OpenCode for LegalWork. Skills live in .opencode/skills and opencode.json.", cache_control: { type: "ephemeral" } }],
        tools: [{ name: "read", input_schema: {} }, { name: "lawoss_memory", input_schema: {} }],
        tool_choice: { type: "tool", name: "lawoss_memory" },
        messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }, { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "read", input: {} }] }],
      };
      let received: Request | undefined;
      const stream = ['event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"tool_use","id":"toolu_2","na', 'me": "mcp_lawoss_memory","input":{}}}\n\n', "event: message_stop\ndata: {}\n\n"];
      const { sent, response } = await fixture.send(messagesRequest(body), async request => {
        received = request;
        return new Response(new ReadableStream({ start(controller) { for (const part of stream) controller.enqueue(new TextEncoder().encode(part)); controller.close(); } }), { headers: { "content-type": "text/event-stream" } });
      });
      expect(received).toBe(sent);
      const url = new URL(sent.url);
      expect(url.pathname).toBe("/v1/messages");
      expect(url.searchParams.get("beta")).toBe("true");
      expect(sent.headers.get("authorization")).toBe("Bearer synthetic-access");
      expect(sent.headers.get("x-api-key")).toBeNull();
      expect(sent.headers.get("user-agent")).toBe(CLAUDE_CODE_USER_AGENT);
      expect(sent.headers.get("anthropic-beta")).toBe("oauth-2025-04-20,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14");
      const json = await sent.json();
      expect(json.system).toEqual([
        { type: "text", text: CLAUDE_CODE_SYSTEM },
        { type: "text", text: `${CLAUDE_CODE_SYSTEM}\n\nYou are Claude Code for LegalWork. Skills live in .opencode/skills and opencode.json.`, cache_control: { type: "ephemeral" } },
      ]);
      expect(json.tools.map((tool: { name: string }) => tool.name)).toEqual(["mcp_read", "mcp_lawoss_memory"]);
      expect(json.tool_choice).toEqual({ type: "tool", name: "mcp_lawoss_memory" });
      expect(json.messages[1].content[0].name).toBe("mcp_read");
      expect(json.messages[0]).toEqual(body.messages[0]);
      const text = await response.text();
      expect(text).toContain('"name": "lawoss_memory"');
      expect(text).not.toContain("mcp_");
    } finally { await fixture.close(); }
  });

  test("subscription zeroes Anthropic prices only; an API key leaves request and prices alone", async () => {
    const fixture = await anthropicRuntime(subscription());
    try {
      expect(fixture.models.map(model => [model.id, model.cost.length])).toEqual([["claude-sonnet-5-5", 0], ["gpt-6-luna", 1]]);
    } finally { await fixture.close(); }
    const keyed = await anthropicRuntime({ connection: { type: "credential", id: "cred_key", label: "API key", method: "key" }, value: { type: "key", key: "synthetic-key" } });
    try {
      expect(keyed.models.map(model => model.cost.length)).toEqual([1, 1]);
      const original = messagesRequest({ system: [{ type: "text", text: "OpenCode" }], tools: [{ name: "read" }] }, { "x-api-key": "synthetic-key" });
      const { sent } = await keyed.send(original, async () => new Response("{}"));
      expect(sent).toBe(original);
    } finally { await keyed.close(); }
  });

  test("switching to the subscription later updates prices through a model reload", async () => {
    const fixture = await anthropicRuntime();
    try {
      expect(fixture.models[0]?.cost.length).toBe(1);
      Object.assign(fixture.state, subscription());
      await fixture.send(messagesRequest({ messages: [] }), async () => new Response("{}"));
      await Bun.sleep(0);
      expect(fixture.state.reloads).toBe(1);
      expect(fixture.models[0]?.cost.length).toBe(0);
    } finally { await fixture.close(); }
  });

  test("system text keeps paths and file names", () => {
    expect(sanitizeSystemText("OpenCode reads ~/.opencode/skills, opencode.json and opencode-plugins; opencode runs.")).toBe("Claude Code reads ~/.opencode/skills, opencode.json and opencode-plugins; Claude runs.");
  });
});
