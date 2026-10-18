import { expect, test } from "bun:test";
import { LegalWorkCapabilitiesKnowledge } from "./legalwork-capabilities-knowledge.js";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";

test("managed capabilities expose the scoped provider failure header hook", async () => {
  const hooks = await LegalWorkCapabilitiesKnowledge();
  expect(Reflect.get(hooks, "chat.headers")).toBeTypeOf("function");
});

test("observes a native-correlated rejection without leaking headers or changing provider bytes", async () => {
  const previousFetch = globalThis.fetch;
  const previous = { url: process.env.LEGALWORK_SERVER_URL, token: process.env.LEGALWORK_WIKI_AGENT_TOKEN };
  const root = await realpath(tmpdir());
  const witnesses: unknown[] = [];
  const upstreamHeaders: Headers[] = [];
  const rejected = JSON.stringify({ error: { message: "Provider returned error", metadata: { raw: JSON.stringify({ error: { message: "Corrupted thought signature." } }) } } });
  let providerBody = rejected;
  const fixture = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    if (new URL(request.url).pathname === "/workspaces") return Response.json({ items: [{ id: "ws_1", path: root }] });
    if (new URL(request.url).pathname.endsWith("/provider-failure")) { witnesses.push(await request.json()); return Response.json({ ok: true }); }
    upstreamHeaders.push(request.headers);
    return new Response(providerBody, { status: 400, headers: { "content-type": "application/json", "x-fixture": "retained" } });
  } });
  process.env.LEGALWORK_SERVER_URL = fixture.url.origin;
  process.env.LEGALWORK_WIKI_AGENT_TOKEN = "synthetic-token";
  try {
    let current = { id: "msg_a", sessionID: "ses_1", role: "assistant", parentID: "msg_u", providerID: "openrouter", modelID: "google/gemini-3-flash-preview" };
    const hooks = await LegalWorkCapabilitiesKnowledge({ directory: root, client: { session: { async messages(options) { expect(Reflect.get(options.query, "limit")).toBe(1); return { data: [{ info: current, parts: [] }] }; } } } });
    const input = { sessionID: "ses_1", model: { providerID: "openrouter", id: "google/gemini-3-flash-preview" }, message: { id: "msg_u" } };
    const output = { headers: { Authorization: "Bearer synthetic-provider" } };
    await hooks["chat.headers"](input, output);
    expect(Object.keys(output.headers)).toContain("x-lawoss-provider-observation");
    const controller = new AbortController();
    const original = new Request(fixture.url.origin + "/v1/chat/completions", { method: "POST", headers: output.headers, body: "opaque request body", signal: controller.signal });
    const response = await fetch(original);
    expect(await response.text()).toBe(rejected);
    expect(response.headers.get("x-fixture")).toBe("retained");
    expect(original.bodyUsed).toBe(true);
    expect(upstreamHeaders[0]?.has("x-lawoss-provider-observation")).toBe(false);
    expect(upstreamHeaders[0]?.get("Authorization")).toBe("Bearer synthetic-provider");
    expect(witnesses).toEqual([{ messageId: "msg_a", userMessageId: "msg_u", providerId: "openrouter", modelId: "google/gemini-3-flash-preview", code: "gemini_thought_signature" }]);
    providerBody = "x".repeat(40000) + rejected;
    expect(await (await fetch(fixture.url.origin, { headers: output.headers })).text()).toBe(providerBody);
    expect(witnesses).toHaveLength(1);
    current = { ...current, parentID: "different_user" };
    const foreign = { headers: {} };
    await hooks["chat.headers"](input, foreign);
    expect(foreign.headers).toEqual({});
  } finally {
    globalThis.fetch = previousFetch; fixture.stop(true);
    if (previous.url === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = previous.url;
    if (previous.token === undefined) delete process.env.LEGALWORK_WIKI_AGENT_TOKEN; else process.env.LEGALWORK_WIKI_AGENT_TOKEN = previous.token;
  }
});
