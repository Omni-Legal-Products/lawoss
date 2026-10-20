import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { viewStreamHeaders } from "./view-stream-bridge.js";
import type { ViewGenerationChunk } from "../views/generation-stream.js";

// CI regression (file-order dependent, runs first on purpose): another test installed the bridge over its temporary fetch mock
// and then restored the original fetch, silently dropping the bridge for the rest of the process.
test("the bridge reinstalls itself when global fetch was replaced after installation", async () => {
  let headers: Headers | undefined;
  const server = createServer((request, response) => {
    headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(name, value);
    response.end("ok");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server port");
  const original = globalThis.fetch;
  try {
    globalThis.fetch = Object.assign((input: Parameters<typeof fetch>[0], init?: RequestInit) => original(input, init), original);
    viewStreamHeaders(async () => {});
  } finally { globalThis.fetch = original; }
  try {
    // As in production, correlation headers are created before the provider request is sent.
    const local = viewStreamHeaders(async () => {});
    const response = await fetch(`http://127.0.0.1:${address.port}`, { headers: local });
    expect(await response.text()).toBe("ok");
    expect(headers?.has("x-legalwork-view-stream")).toBe(false);
  } finally { server.closeAllConnections(); server.close(); }
});

test.each([undefined, "text/event-stream"])("the bridge forwards provider bytes and strips local correlation headers (Content-Type: %s)", async contentType => {
  const payload = [
    { type: "response.output_item.added", item: { id: "item", call_id: "call", type: "function_call", name: "view_create", arguments: "" } },
    { type: "response.function_call_arguments.delta", item_id: "item", delta: '{"input":{"program":"' },
    { type: "response.function_call_arguments.delta", item_id: "item", delta: 'root = Stack()"}}' },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join("");
  let headers: Headers | undefined;
  const server = createServer((request, response) => {
    headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) if (typeof value === "string") headers.set(name, value);
    if (contentType) response.setHeader("content-type", contentType);
    response.end(payload);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server port");
  const url = `http://127.0.0.1:${address.port}`;
  try {
    const chunks: ViewGenerationChunk[] = [];
    const local = viewStreamHeaders(async chunk => { chunks.push(chunk); });
    const response = await fetch(url, { headers: { ...local, authorization: "Bearer provider-credential" } });
    expect(response.headers.get("content-type")).toBe(contentType ?? null);
    expect(await response.text()).toBe(payload);
    expect(headers?.has("x-legalwork-view-stream")).toBe(false);
    expect(headers?.get("authorization")).toBe("Bearer provider-credential");
    await new Promise(resolve => setTimeout(resolve, 1));
    expect(chunks.at(-1)).toEqual({ callId: "call", tool: "view_create", raw: '{"input":{"program":"root = Stack()"}}' });
    // A failed preview destination does not interrupt the provider response.
    const failure = await fetch(url, { headers: viewStreamHeaders(async () => { throw new Error("offline"); }) });
    expect(await failure.text()).toBe(payload);
  } finally { server.closeAllConnections(); server.close(); }
});
