import { afterEach, expect, test } from "bun:test";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { adoptWikiAgentSecret, wikiAgentSecret } from "./wiki-agent-secret.js";
import { bindTurn, registerProviderFailureObserver, signatureRejection } from "./provider-failure-observer.js";
import { nativePluginTestRuntime } from "./native-plugin-test-support.js";

const previous = { url: process.env.LEGALWORK_SERVER_URL, token: wikiAgentSecret() };
afterEach(() => {
  if (previous.url === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = previous.url;
  adoptWikiAgentSecret(previous.token ?? "");
});

const MODEL = { providerID: "openrouter", id: "google/gemini-3-flash-preview" };
const REJECTED = JSON.stringify({ error: { message: "Provider returned error", metadata: { raw: JSON.stringify({ error: { message: "Corrupted thought signature." } }) } } });

function turn(completed = false) {
  return [{ type: "user", id: "msg_u", time: { created: 1 } },
    { type: "assistant", id: "msg_a", model: MODEL, time: { created: 2, ...(completed ? { completed: 3 } : {}) }, content: [] }];
}

test("binds the running native assistant and its user message; anything else stays unknown", () => {
  expect(bindTurn(turn(), MODEL)).toEqual({ messageId: "msg_a", userMessageId: "msg_u" });
  expect(bindTurn(turn(true), MODEL)).toBeNull();
  expect(bindTurn(turn(), { ...MODEL, id: "google/gemini-2.5-pro" })).toBeNull();
  expect(bindTurn([{ type: "assistant", id: "msg_a", model: MODEL, time: { created: 2 } }], MODEL)).toBeNull();
  expect(bindTurn("not a history", MODEL)).toBeNull();
  expect(signatureRejection(REJECTED)).toBe(true);
  expect(signatureRejection(JSON.stringify({ error: { message: "rate limited" } }))).toBe(false);
});

test("observes a native-correlated rejection through the engine hooks without changing provider bytes", async () => {
  const root = await realpath(tmpdir());
  const witnesses: unknown[] = [];
  let witnessArrived!: () => void;
  const witnessReceived = new Promise<void>(resolve => { witnessArrived = resolve; });
  const fixture = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/workspaces") return Response.json({ items: [{ id: "ws_1", path: root }] });
    if (path.endsWith("/provider-failure")) {
      expect(request.headers.get("x-legalwork-wiki-agent-session")).toBe("ses_1");
      witnesses.push(await request.json()); witnessArrived(); return Response.json({ ok: true });
    }
    return new Response("not found", { status: 404 });
  } });
  process.env.LEGALWORK_SERVER_URL = fixture.url.origin;
  adoptWikiAgentSecret("synthetic-token");
  const runtime = nativePluginTestRuntime(root);
  const dispose = await registerProviderFailureObserver(runtime.ctx);
  try {
    runtime.histories.set("ses_1", turn());
    const exchange = async (status: number, body: string) => {
      const request = new Request("https://openrouter.test/v1/chat/completions", { method: "POST", body: "opaque request body" });
      await runtime.hook("session", "http.request", { sessionID: "ses_1", agent: "legalwork", model: MODEL, kind: "primary", request });
      const original = new Response(body, { status, headers: { "content-type": "application/json", "x-fixture": "retained" } });
      const event = { sessionID: "ses_1", agent: "legalwork", model: MODEL, kind: "primary", request, response: original };
      await runtime.hook("session", "http.response", event);
      return { original, response: event.response };
    };
    const rejected = await exchange(400, REJECTED);
    expect(rejected.response).not.toBe(rejected.original);
    expect(rejected.response.headers.get("x-fixture")).toBe("retained");
    expect(await rejected.response.text()).toBe(REJECTED);
    await witnessReceived;
    expect(witnesses).toEqual([{ messageId: "msg_a", userMessageId: "msg_u", providerId: "openrouter", modelId: MODEL.id, code: "gemini_thought_signature" }]);
    // A large body is forwarded unchanged and never inspected beyond the bound; success responses are untouched.
    const large = "x".repeat(40000) + REJECTED;
    expect(await (await exchange(400, large)).response.text()).toBe(large);
    const ok = await exchange(200, "{}");
    expect(ok.response).toBe(ok.original);
    // A completed assistant is not the running turn: nothing is bound or reported.
    runtime.histories.set("ses_1", turn(true));
    const later = await exchange(400, REJECTED);
    expect(later.response).toBe(later.original);
    await Bun.sleep(0);
    expect(witnesses).toHaveLength(1);
  } finally {
    await dispose();
    await fixture.stop(true);
  }
});

test("without the engine credential nothing is observed", async () => {
  adoptWikiAgentSecret("");
  process.env.LEGALWORK_SERVER_URL = "http://127.0.0.1:9";
  const runtime = nativePluginTestRuntime();
  const dispose = await registerProviderFailureObserver(runtime.ctx);
  runtime.histories.set("ses_1", turn());
  const request = new Request("https://openrouter.test/v1/chat/completions", { method: "POST" });
  await runtime.hook("session", "http.request", { sessionID: "ses_1", agent: "legalwork", model: MODEL, kind: "primary", request });
  const original = new Response(REJECTED, { status: 400 });
  const event = { sessionID: "ses_1", agent: "legalwork", model: MODEL, kind: "primary", request, response: original };
  await runtime.hook("session", "http.response", event);
  expect(event.response).toBe(original);
  await dispose();
});
