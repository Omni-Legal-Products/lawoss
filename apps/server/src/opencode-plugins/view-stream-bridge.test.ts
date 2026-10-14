import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { viewStreamHeaders } from "./view-stream-bridge.js";
import type { ViewGenerationChunk } from "../views/generation-stream.js";

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
