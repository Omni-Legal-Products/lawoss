/** Protocol-only substitute of the confined engine v2 guest (synthetic, test-only).
 * It proves host routing/lifecycle, never VM isolation or real pinned-engine answers;
 * those need the native VM acceptance (vm-engine.integration). */
export const GUEST_DIRECTORY = "/tmp/home/protected-engine/workspace";
type Message = Record<string, unknown> & { id: string; type: string };
export type GuestReceipt = "succeeded" | "failed" | "interrupted" | "foreign-message" | "nonterminal";
export type GuestCall = { method: string; path: string; body: string };

export function guestSession(id: string, title = "Synthetic", directory = GUEST_DIRECTORY) {
  return { id, projectID: "synthetic", title, location: { directory }, cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: 1, updated: 1 } };
}

export function fakeProtectedGuest(options: {
  sessionId: string; title?: string; directory?: string;
  checkpoint?: { bytes: Buffer; sha256: string };
  /** Active sessions in the engine v2 `session.active` shape (idle = absent). */
  active?: () => Record<string, unknown>;
  receipt?: () => GuestReceipt;
  /** Runs before the defaults; a returned response wins. */
  intercept?: (request: Request, path: string) => Promise<Response | undefined> | Response | undefined;
  /** Awaited inside the guest `wait` barrier before the turn becomes terminal. */
  beforeTerminal?: () => Promise<void>;
  onStop?: () => void;
}) {
  const calls: GuestCall[] = [], prompts: Array<{ id: string; text: string }> = [], history: Message[] = [];
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  let counter = 0;
  const next = () => `msg_guest${String(++counter).padStart(8, "0")}`;
  const session = `/api/session/${options.sessionId}`;
  const emit = (event: unknown) => { const frame = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`); for (const stream of streams) stream.enqueue(frame); };
  const raw = (bytes: string) => { const frame = new TextEncoder().encode(bytes); for (const stream of streams) stream.enqueue(frame); };
  const engine = {
    stop: async () => { options.onStop?.(); for (const stream of streams) { try { stream.close(); } catch {} } streams.clear(); },
    fetch: async (request: Request) => {
      const url = new URL(request.url), path = url.pathname;
      const body = request.method === "GET" ? "" : await request.text();
      calls.push({ method: request.method, path: path + url.search, body });
      const intercepted = await options.intercept?.(new Request(request.url, { method: request.method, headers: request.headers, signal: request.signal, ...(body ? { body } : {}) }), path);
      if (intercepted) return intercepted;
      if (path === "/_protected/checkpoint") {
        if (!options.checkpoint) return new Response(null, { status: 404 });
        return new Response(new Uint8Array(options.checkpoint.bytes), { headers: { "content-type": "application/octet-stream", "x-protected-sha256": options.checkpoint.sha256 } });
      }
      if (path === "/api/event") return new Response(new ReadableStream<Uint8Array>({ start(controller) { streams.add(controller); }, cancel() {} }), { headers: { "content-type": "text/event-stream" } });
      if (path === "/api/session/active") return Response.json({ data: options.active?.() ?? {} });
      if ((path === "/api/session" && request.method === "POST") || (path === session && request.method === "GET"))
        return Response.json({ data: guestSession(options.sessionId, options.title, options.directory) });
      if (path === `${session}/model` && request.method === "POST") return new Response(null, { status: 204 });
      if (path === `${session}/prompt` && request.method === "POST") {
        const prompt = JSON.parse(body) as { id: string; text: string };
        prompts.push(prompt);
        const receipt = options.receipt?.() ?? "succeeded";
        const id = receipt === "foreign-message" ? next() : prompt.id;
        history.push({ id, type: "user", text: prompt.text, time: { created: Date.now() } });
        return Response.json({ data: { id, sessionID: options.sessionId, type: "user", payload: { text: prompt.text } } });
      }
      if (path === `/api/experimental/session/${options.sessionId}/wait` && request.method === "POST") {
        await options.beforeTerminal?.();
        const receipt = options.receipt?.() ?? "succeeded";
        if (receipt !== "foreign-message") {
          history.push({ id: next(), type: "assistant", agent: "legalwork", model: { id: "fixture", providerID: "protected-documents" },
            content: [{ type: "text", text: "ACTUAL-PROTOCOL-RESPONSE" }], finish: receipt === "nonterminal" ? "tool-calls" : "stop",
            time: { created: 1, ...(receipt === "nonterminal" ? {} : { completed: 2 }) } });
          if (receipt !== "nonterminal") history.push({ id: next(), type: "idle", outcome: receipt, time: { created: 3 } });
        }
        return new Response(null, { status: 204 });
      }
      if (path === `${session}/message` && request.method === "GET") {
        const ordered = url.searchParams.get("order") === "desc" ? [...history].reverse() : history;
        return Response.json({ data: url.searchParams.has("cursor") ? [] : ordered, cursor: { next: "synthetic-end" } });
      }
      if (path === `${session}/interrupt` && request.method === "POST") return Response.json({ interrupted: false });
      return new Response(null, { status: 204 });
    },
  };
  return { engine, calls, prompts, history, emit, raw, streams };
}
