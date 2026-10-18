import type { ViewGenerationChunk } from "./schema.js";
export { ViewGenerationChunkSchema, type ViewGenerationChunk } from "./schema.js";

/** Ephemeral previews only. Saving still goes through the revision/approval checked view tools. */
export function viewGenerationStreams() {
  const sessions = new Map<string, { at: number; chunks: Map<string, ViewGenerationChunk> }>();
  const listeners = new Map<string, Set<(chunk: ViewGenerationChunk) => void>>();
  return {
    publish(key: string, chunk: ViewGenerationChunk) {
      const now = Date.now();
      for (const [id, session] of sessions) if (session.at < now - 600_000) sessions.delete(id);
      if (!sessions.has(key) && sessions.size >= 32) sessions.delete(sessions.keys().next().value!);
      const session = sessions.get(key) ?? { at: now, chunks: new Map() };
      const previous = session.chunks.get(chunk.callId);
      if (previous && previous.raw.length >= chunk.raw.length) return;
      if (!previous && session.chunks.size >= 4) session.chunks.delete(session.chunks.keys().next().value!);
      session.at = now;
      session.chunks.set(chunk.callId, chunk);
      sessions.set(key, session);
      for (const listener of listeners.get(key) ?? []) listener(chunk);
    },
    subscribe(key: string, signal: AbortSignal) {
      let stop = (_cancelled = false) => {};
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(": connected\n\n"));
          const own = listeners.get(key) ?? new Set();
          const send = (chunk: ViewGenerationChunk) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          own.add(send);
          listeners.set(key, own);
          const session = sessions.get(key);
          if (session && session.at > Date.now() - 600_000) for (const chunk of session.chunks.values()) send(chunk);
          const ping = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 25_000);
          ping.unref?.();
          let closed = false;
          stop = (cancelled = false) => {
            if (closed) return;
            closed = true;
            clearInterval(ping);
            own.delete(send);
            if (!own.size) listeners.delete(key);
            signal.removeEventListener("abort", abort);
            if (!cancelled) controller.close();
          };
          const abort = () => stop();
          signal.addEventListener("abort", abort, { once: true });
          if (signal.aborted) stop();
        },
        cancel() { stop(true); },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform" } });
    },
  };
}
