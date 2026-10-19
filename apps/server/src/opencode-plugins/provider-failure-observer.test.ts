import { afterAll, expect, test } from "bun:test";
import { LegalWorkCapabilitiesKnowledge } from "./legalwork-capabilities-knowledge.js";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";

const originalFetch = globalThis.fetch;
afterAll(() => { globalThis.fetch = originalFetch; });

test("managed capabilities expose the scoped provider failure header hook", async () => {
  const hooks = await LegalWorkCapabilitiesKnowledge();
  expect(Reflect.get(hooks, "chat.headers")).toBeTypeOf("function");
});

test("observes a native-correlated rejection without leaking headers or changing provider bytes", async () => {
  const previous = { url: process.env.LEGALWORK_SERVER_URL, token: process.env.LEGALWORK_WIKI_AGENT_TOKEN };
  const root = await realpath(tmpdir());
  const witnesses: unknown[] = [];
  let releaseLookup!: () => void;
  const lookupGate = new Promise<void>(resolve => { releaseLookup = resolve; });
  let lookupStarted!: () => void;
  const lookupEntered = new Promise<void>(resolve => { lookupStarted = resolve; });
  let witnessArrived!: () => void;
  const witnessReceived = new Promise<void>(resolve => { witnessArrived = resolve; });
  let releasePost!: () => void;
  const postGate = new Promise<void>(resolve => { releasePost = resolve; });
  let releaseProvider!: () => void;
  const providerGate = new Promise<void>(resolve => { releaseProvider = resolve; });
  let providerStarted!: () => void;
  const providerEntered = new Promise<void>(resolve => { providerStarted = resolve; });
  let aborting: Promise<Response> | undefined;
  let reading: Promise<string> | undefined;
  let dispose: (() => Promise<void>) | undefined;
  const upstreamHeaders: Headers[] = [];
  const rejected = JSON.stringify({ error: { message: "Provider returned error", metadata: { raw: JSON.stringify({ error: { message: "Corrupted thought signature." } }) } } });
  let providerBody = rejected;
  const fixture = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (new URL(request.url).pathname === "/workspaces") { lookupStarted(); await lookupGate; return Response.json({ items: [{ id: "ws_1", path: root }] }); }
    if (new URL(request.url).pathname.endsWith("/provider-failure")) { witnesses.push(await request.json()); witnessArrived(); await postGate; return Response.json({ ok: true }); }
    upstreamHeaders.push(request.headers);
    if (new URL(request.url).pathname === "/slow-provider") { providerStarted(); await providerGate; }
    return new Response(providerBody, { status: 400, headers: { "content-type": "application/json", "x-fixture": "retained" } });
  } });
  process.env.LEGALWORK_SERVER_URL = fixture.url.origin;
  process.env.LEGALWORK_WIKI_AGENT_TOKEN = "synthetic-token";
  try {
    let current = { id: "msg_a", sessionID: "ses_1", role: "assistant", parentID: "msg_u", providerID: "openrouter", modelID: "google/gemini-3-flash-preview" };
    const hooks = await LegalWorkCapabilitiesKnowledge({ directory: root, client: { session: { async messages(options) { expect(Reflect.get(options.query, "limit")).toBe(1); return { data: [{ info: current, parts: [] }] }; } } } });
    dispose = hooks.dispose;
    const input = { sessionID: "ses_1", model: { providerID: "openrouter", id: "google/gemini-3-flash-preview" }, message: { id: "msg_u" } };
    const output = { headers: { Authorization: "Bearer synthetic-provider" } };
    await hooks["chat.headers"](input, output);
    expect(Object.keys(output.headers)).toContain("x-lawoss-provider-observation");
    const controller = new AbortController();
    const original = new Request(fixture.url.origin + "/v1/chat/completions", { method: "POST", headers: output.headers, body: "opaque request body", signal: controller.signal });
    const response = await fetch(original);
    reading = response.text();
    await lookupEntered;
    expect(await Promise.race([reading.then(() => true), Bun.sleep(25).then(() => false)])).toBe(true);
    releaseLookup();
    expect(await reading).toBe(rejected);
    await witnessReceived;
    expect(response.headers.get("x-fixture")).toBe("retained");
    expect(original.bodyUsed).toBe(true);
    expect(upstreamHeaders[0]?.has("x-lawoss-provider-observation")).toBe(false);
    expect(upstreamHeaders[0]?.get("Authorization")).toBe("Bearer synthetic-provider");
    expect(witnesses).toEqual([{ messageId: "msg_a", userMessageId: "msg_u", providerId: "openrouter", modelId: "google/gemini-3-flash-preview", code: "gemini_thought_signature" }]);
    providerBody = "x".repeat(40000) + rejected;
    expect(await (await fetch(fixture.url.origin, { headers: output.headers })).text()).toBe(providerBody);
    expect(witnesses).toHaveLength(1);
    const abort = new AbortController();
    const reason = new Error("synthetic provider cancellation");
    aborting = fetch(new Request(fixture.url.origin + "/slow-provider", { headers: output.headers }), { signal: abort.signal });
    await providerEntered;
    abort.abort(reason);
    expect(await Promise.race([aborting.catch(error => error), Bun.sleep(500).then(() => "provider abort not propagated")])).toBe(reason);
    current = { ...current, parentID: "different_user" };
    const foreign = { headers: {} };
    await hooks["chat.headers"](input, foreign);
    expect(foreign.headers).toEqual({});
    expect(await Promise.race([hooks.dispose().then(() => true), Bun.sleep(100).then(() => false)])).toBe(true);
  } finally {
    releaseLookup();
    releasePost();
    releaseProvider();
    await aborting?.catch(() => {});
    await reading?.catch(() => {});
    await dispose?.();
    fixture.stop(true);
    if (previous.url === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = previous.url;
    if (previous.token === undefined) delete process.env.LEGALWORK_WIKI_AGENT_TOKEN; else process.env.LEGALWORK_WIKI_AGENT_TOKEN = previous.token;
  }
});

test("publication admission is bounded and plugin disposal cancels and drains blocked lookups", async () => {
  const previous = { url: process.env.LEGALWORK_SERVER_URL, token: process.env.LEGALWORK_WIKI_AGENT_TOKEN };
  const root = await realpath(tmpdir());
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let full!: () => void;
  const atCapacity = new Promise<void>(resolve => { full = resolve; });
  let lookups = 0, posts = 0;
  const body = JSON.stringify({ error: { message: "Corrupted thought signature." } });
  const fixture = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (new URL(request.url).pathname === "/workspaces") { lookups += 1; if (lookups === 8) full(); await gate; return Response.json({ items: [{ id: "ws_1", path: root }] }); }
    if (new URL(request.url).pathname.endsWith("/provider-failure")) { posts += 1; return Response.json({ ok: true }); }
    return new Response(body, { status: 400 });
  } });
  process.env.LEGALWORK_SERVER_URL = fixture.url.origin;
  process.env.LEGALWORK_WIKI_AGENT_TOKEN = "synthetic-token";
  let dispose: (() => Promise<void>) | undefined;
  try {
    let id = "msg_0";
    const hooks = await LegalWorkCapabilitiesKnowledge({ directory: root, client: { session: { async messages() { return { data: [{ info: { id, sessionID: "ses_1", role: "assistant", parentID: "msg_u", providerID: "openrouter", modelID: "google/gemini-3-flash-preview" }, parts: [] }] }; } } } });
    dispose = hooks.dispose;
    const input = { sessionID: "ses_1", model: { providerID: "openrouter", id: "google/gemini-3-flash-preview" }, message: { id: "msg_u" } };
    for (let index = 0; index < 12; index++) {
      id = `msg_${index}`;
      const output = { headers: {} };
      await hooks["chat.headers"](input, output);
      expect(await (await fetch(fixture.url.origin, { headers: output.headers })).text()).toBe(body);
    }
    await atCapacity;
    expect(lookups).toBe(8);
    expect(await Promise.race([hooks.dispose().then(() => true), Bun.sleep(100).then(() => false)])).toBe(true);
    release();
    const closed = { headers: {} };
    await hooks["chat.headers"](input, closed);
    expect(closed.headers).toEqual({});
    expect(posts).toBe(0);
  } finally {
    release(); await dispose?.(); fixture.stop(true);
    if (previous.url === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = previous.url;
    if (previous.token === undefined) delete process.env.LEGALWORK_WIKI_AGENT_TOKEN; else process.env.LEGALWORK_WIKI_AGENT_TOKEN = previous.token;
  }
});
