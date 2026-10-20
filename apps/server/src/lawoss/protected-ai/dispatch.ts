import { z } from "zod";
import type { ServerConfig } from "../../types.js";
import { activeProtectedRuntime, type ProtectedDocumentRuntime } from "./runtime.js";

const owners = new WeakMap<ServerConfig, Set<ProtectedDocumentRuntime>>();
const sessionsSchema = z.array(z.object({id: z.string()}).passthrough());
const statusesSchema = z.record(z.string(), z.unknown());

/** Several listeners can share a config; each session retains its creating owner. */
export function registerProtectedRuntime(config: ServerConfig, runtime: ProtectedDocumentRuntime): () => void {
  const current = owners.get(config) ?? new Set<ProtectedDocumentRuntime>();
  current.add(runtime); owners.set(config, current);
  return () => {current.delete(runtime); if (!current.size) owners.delete(config);};
}

function sessionOwner(config: ServerConfig, workspaceId: string, path: string) {
  const id = /^\/session\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(path)?.[1];
  const runtime = id ? protectedRuntimeForSession(config, workspaceId, id) : undefined;
  return runtime && id ? { runtime, id } : undefined;
}

/** Trusted host registry lookup; a session-shaped HTTP ID alone grants nothing. */
export function protectedRuntimeForSession(config: ServerConfig, workspaceId: string, sessionId: string): ProtectedDocumentRuntime | undefined {
  return activeProtectedRuntime(config, workspaceId, sessionId) ?? [...owners.get(config) ?? []].find(runtime => runtime.ownsSession(workspaceId, sessionId));
}

export async function protectedSessionResponse(config: ServerConfig, workspaceId: string, request: Request): Promise<Response | null> {
  const owner = sessionOwner(config, workspaceId, new URL(request.url).pathname);
  return owner ? owner.runtime.proxy({workspaceId, sessionId: owner.id, request}) : null;
}

/** Multiplex complete real SSE frames, never interleave arbitrary byte chunks. */
function mergeEvents(responses: Response[], signal: AbortSignal): Response {
  const readers = responses.map(response => response.body?.getReader()).filter(reader => reader !== undefined);
  let closed = false;
  const closeReaders = async () => {await Promise.allSettled(readers.map(reader => reader.cancel()));};
  const body = new ReadableStream<Uint8Array>({start(controller) {
    const abort = () => {if (!closed) {closed = true; controller.close();} void closeReaders();};
    signal.addEventListener("abort", abort, {once: true});
    if (signal.aborted) {abort(); return;}
    void Promise.race(readers.map(async reader => {
      const decoder = new TextDecoder("utf-8", {fatal: true}); let buffered = "";
      while (!closed) {
        const result = await reader.read(); if (result.done) return;
        buffered += decoder.decode(result.value, {stream: true});
        if (Buffer.byteLength(buffered) > 4 * 1024 * 1024) throw new Error("Engine event frame exceeds its bound.");
        for (;;) {
          const boundary = /\r?\n\r?\n/.exec(buffered); if (!boundary) break;
          const end = boundary.index + boundary[0].length, bytes = new TextEncoder().encode(buffered.slice(0, end)); buffered = buffered.slice(end);
          if ((controller.desiredSize ?? 0) < bytes.byteLength) throw new Error("Engine event consumer exceeded its bound.");
          controller.enqueue(bytes);
        }
      }
    })).then(() => {if (!closed) {closed = true; controller.close();}}, () => {if (!closed) {closed = true; controller.error(new Error("Engine event transport ended."));}})
      .finally(() => {signal.removeEventListener("abort", abort); void closeReaders();});
  }, cancel() {closed = true; return closeReaders();}}, {highWaterMark: 4 * 1024 * 1024, size: chunk => chunk?.byteLength ?? 0});
  const headers = new Headers(responses[0]?.headers);
  for (const name of ["content-length", "content-encoding", "transfer-encoding"]) headers.delete(name);
  headers.set("content-type", "text/event-stream");
  return new Response(body, {headers, status: responses[0]?.status ?? 200});
}

/** Add actual confined sessions to the existing SDK read model without granting
 * ordinary engine execution any of the confined transport's capabilities. */
export function protectedEngineFetch(config: ServerConfig, workspaceId: string, fallback: typeof fetch): typeof fetch {
  return Object.assign(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request = new Request(input, init);
    const direct = await protectedSessionResponse(config, workspaceId, request);
    if (direct) return direct;
    const runtimes = [...owners.get(config) ?? []];
    if (!runtimes.length || request.method !== "GET") return fallback(request);
    const path = new URL(request.url).pathname;
    const response = await fallback(request);
    if (!response.ok) return response;
    if (path === "/event" || path === "/global/event") return mergeEvents([response, ...runtimes.map(runtime => runtime.events(workspaceId, request.signal))], request.signal);
    if (!runtimes.some(runtime => runtime.sessionIds(workspaceId).length)) return response;
    if (path === "/session/status") {
      let current: z.infer<typeof statusesSchema>;
      try {current = statusesSchema.parse(await response.json());}
      catch {return Response.json({code: "opencode_invalid_response", message: "The ordinary engine returned invalid session statuses."}, {status: 502});}
      for (const runtime of runtimes) Object.assign(current, statusesSchema.parse(await (await runtime.workspaceStatus(workspaceId, request)).json()));
      return Response.json(current);
    }
    if (path === "/session") {
      let current: z.infer<typeof sessionsSchema>;
      try {current = sessionsSchema.parse(await response.json());}
      catch {return Response.json({code: "opencode_invalid_response", message: "The ordinary engine returned an invalid session list."}, {status: 502});}
      const merged = new Map(current.map(session => [session.id, session]));
      for (const runtime of runtimes) for (const id of runtime.sessionIds(workspaceId)) {
        const target = new URL(`/session/${id}`, request.url);
        const session = await runtime.proxy({workspaceId, sessionId: id, request: new Request(target, {signal: request.signal})});
        if (session.ok) {
          const [actual] = sessionsSchema.parse([await session.json()]); merged.set(actual.id, actual);
        }
      }
      return Response.json([...merged.values()]);
    }
    return response;
  }, {preconnect: fallback.preconnect});
}
