import { describe, expect, test } from "bun:test";
import type { OpenCodeClient } from "@opencode/client";

import { scopedNativeEvents } from "./native-proxy-events.js";

// LAWOSS #505: a quiet engine sends nothing, so the desktop's Node fetch ends the
// proxied stream after undici's 300 s body timeout unless the proxy writes a keepalive.
function quietClient(events: unknown[] = []) {
  let ended = false;
  let release: () => void = () => {};
  const client = {
    session: { get: async () => null },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        async *[Symbol.asyncIterator]() {
          for (const event of events) yield event;
          await new Promise<void>(resolve => {
            if (ended || signal.aborted) return resolve();
            release = resolve;
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
        },
      }),
    },
  };
  // The fake engine stays an untyped double: only the members scopedNativeEvents reads exist.
  return { client: client as unknown as OpenCodeClient, end: () => { ended = true; release(); } };
}

async function readFor(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number) {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const next = await Promise.race([
      reader.read(),
      new Promise<null>(resolve => setTimeout(() => resolve(null), deadline - Date.now())),
    ]);
    if (!next || next.done) break;
    text += decoder.decode(next.value);
  }
  return text;
}

describe("scopedNativeEvents keepalive (#505)", () => {
  test("a quiet stream carries SSE comment pings", async () => {
    const { client } = quietClient();
    const abort = new AbortController();
    const response = scopedNativeEvents(client, async () => true, abort.signal, undefined, { pingMs: 20 });
    const reader = response.body!.getReader();
    const text = await readFor(reader, 120);
    expect(text).toContain(": ping\n\n");
    await reader.cancel();
    abort.abort();
  });

  test("pings stop once the window cancels the stream", async () => {
    const { client } = quietClient();
    const abort = new AbortController();
    const response = scopedNativeEvents(client, async () => true, abort.signal, undefined, { pingMs: 10 });
    const reader = response.body!.getReader();
    await readFor(reader, 40);
    await reader.cancel();
    // A ping enqueued after cancel would throw inside the timer; give it a few periods.
    await new Promise(resolve => setTimeout(resolve, 60));
    abort.abort();
  });

  test("events still pass and the stream closes when the engine ends it", async () => {
    const event = { type: "server.connected", properties: {} };
    const { client, end } = quietClient([event]);
    const abort = new AbortController();
    const response = scopedNativeEvents(client, async () => true, abort.signal, undefined, { pingMs: 1_000 });
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe(`data: ${JSON.stringify(event)}\n\n`);
    end();
    const rest = await readFor(reader, 200);
    expect(rest).toBe("");
    const done = await reader.read();
    expect(done.done).toBe(true);
    abort.abort();
  });
});
