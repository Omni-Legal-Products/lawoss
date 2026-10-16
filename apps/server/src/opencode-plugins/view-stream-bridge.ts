import { randomBytes } from "node:crypto";
import { viewStreamParser } from "./view-stream-parser.js";
import type { ViewGenerationChunk } from "../views/generation-stream.js";

const HEADER = "x-legalwork-view-stream";
const requests = new Map<string, { at: number; publish: (chunk: ViewGenerationChunk) => Promise<void> }>();
let installed = false;

/** Compatibility for engines that discard tool-input-delta (including bundled OpenCode 1.18.29).
 * Local request correlation is stripped before the request reaches the model provider. */
export function installViewStreamBridge() {
  if (!installed) {
    installed = true;
    const base = globalThis.fetch;
    const patched = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const key = headers.get(HEADER);
      if (!key) return base(input, init);
      headers.delete(HEADER);
      const source = requests.get(key);
      const response = await base(input, { ...init, headers });
      // Some compatible providers omit Content-Type on otherwise valid SSE responses.
      const contentType = response.headers.get("content-type");
      if (!source || !response.ok || !response.body || (contentType && !contentType.includes("text/event-stream"))) return response;
      const latest = new Map<string, ViewGenerationChunk>();
      let publishing = false;
      const flush = async () => {
        if (publishing) return;
        publishing = true;
        try {
          while (latest.size) {
            const chunks = [...latest.values()]; latest.clear();
            await Promise.all(chunks.map(chunk => source.publish(chunk).catch(() => {})));
          }
        } finally { publishing = false; }
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const feed = viewStreamParser(chunk => {
        latest.set(chunk.callId, chunk);
        if (!timer) timer = setTimeout(() => { timer = undefined; void flush(); }, 80);
      });
      const decoder = new TextDecoder();
      const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) { controller.enqueue(chunk); feed(decoder.decode(chunk, { stream: true })); },
        flush() { feed(decoder.decode()); if (timer) clearTimeout(timer); void flush(); },
      }));
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    };
    globalThis.fetch = Object.assign(patched, base);
  }
}

export function viewStreamHeaders(publish: (chunk: ViewGenerationChunk) => Promise<void>) {
  installViewStreamBridge();
  const now = Date.now();
  for (const [key, entry] of requests) if (entry.at < now - 600_000) requests.delete(key);
  if (requests.size >= 256) requests.delete(requests.keys().next().value!);
  const key = randomBytes(16).toString("hex");
  requests.set(key, { at: now, publish });
  return { [HEADER]: key };
}
