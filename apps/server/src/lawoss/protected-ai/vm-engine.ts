import { randomUUID } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import { z } from "zod";
import { VmSandbox, type SandboxRun, type SandboxResult, type SandboxRequestBroker } from "../../agent-sandbox/vm.js";
import { MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, type OutboundRequest, type OutboundResponse } from "../../agent-sandbox/network.js";

const ORIGIN = "http://protected-lawoss.invalid";
const CHUNK_BYTES = 32 * 1024;
const MAX_IN_FLIGHT = 12;
const TOOL_NAMES = ["lawoss_documents_list", "lawoss_documents_read", "lawoss_documents_export", "lawoss_documents_validate"] as const;
const idSchema = z.string().uuid();
const headersSchema = z.record(z.string().max(128), z.string().max(8192)).refine((headers) => Object.keys(headers).length <= 64);
const resultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("head"), id: idSchema, status: z.number().int().min(200).max(599), headers: headersSchema }).strict(),
  z.object({ kind: z.literal("chunk"), id: idSchema, data: z.string().max(Math.ceil(CHUNK_BYTES / 3) * 4).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/) }).strict(),
  z.object({ kind: z.literal("end"), id: idSchema }).strict(),
  z.object({ kind: z.literal("error"), id: idSchema, message: z.string().max(1024) }).strict(),
]);
const toolSchema = z.object({ name: z.enum(TOOL_NAMES), arguments: z.unknown(), sessionId: z.string().min(1).max(256).optional() }).strict();
export type ProtectedVmToolCall = z.infer<typeof toolSchema>;
export type ProtectedVmBroker = SandboxRequestBroker;
export type ProtectedVmSandbox = { run(input: SandboxRun): Promise<SandboxResult> };
type StartupClock = { now(): number; schedule(callback: () => void, delay: number): () => void };
const startupClock: StartupClock = {
  now: () => performance.now(),
  schedule(callback, delay) { const timer = setTimeout(callback, delay); return () => clearTimeout(timer); },
};
export type ProtectedVmOpen = {
  bundleDirectory: string;
  emptyDirectory: string;
  signal: AbortSignal;
  handleOutbound: (request: OutboundRequest, signal: AbortSignal) => Promise<OutboundResponse>;
  handleTool: (request: ProtectedVmToolCall, signal: AbortSignal) => Promise<unknown>;
};
type Command = { kind: "request"; id: string; method: string; path: string; headers: Record<string, string>; bodyBase64: string } | { kind: "cancel"; id: string };
type Pending = {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  body?: ReadableStreamDefaultController<Uint8Array>;
  resume?: () => void;
  bytes: number;
  head: boolean;
  checkpoint: boolean;
  signal: AbortSignal;
  abort: () => void;
};

function failure(error: unknown): Error { return error instanceof Error ? error : new Error("Protected VM request failed."); }
function jsonResponse(value: unknown): OutboundResponse {
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > MAX_RESPONSE_BYTES) throw new Error("Protected capability response is too large.");
  return { status: 200, headers: { "content-type": "application/json" }, bodyBase64: bytes.toString("base64") };
}
function parsedBody(request: OutboundRequest): unknown {
  if (request.bodyBytes > MAX_REQUEST_BYTES) throw new Error("Protected capability body is too large.");
  return JSON.parse(Buffer.from(request.bodyBase64, "base64").toString("utf8"));
}
function enginePath(request: Request): string {
  const url = new URL(request.url);
  if (url.pathname === "/_protected/checkpoint") {
    if (request.method !== "GET" || url.search || url.hash) throw new Error("Unsupported protected checkpoint route.");
    return url.pathname;
  }
  // Session-only bridge: no provider/auth/config mutation, arbitrary proxy or shell endpoint.
  if (!/^(?:\/session(?:\/[^/]+(?:\/(?:message(?:\/[^/]+)?|prompt_async|abort|status|children|todo))?)?|\/event|\/global\/(?:event|health)|\/provider|\/agent|\/path|\/project\/current)$/.test(url.pathname) ||
      /%2f|%5c|%2e/i.test(url.pathname) || url.pathname.split("/").some((part) => part === "." || part === "..") ||
      !["GET", "POST", "DELETE", "PATCH"].includes(request.method) ||
      (request.method !== "GET" && !url.pathname.startsWith("/session"))) throw new Error("Unsupported protected engine route.");
  if (url.search.length > 8192) throw new Error("Protected engine query is too large.");
  return url.pathname + url.search;
}

/** One bounded, NIC-free worker. Its private broker is not a public transport grant.
 * No host engine fallback exists, including missing assets, revocation and startup failure. */
export class ProtectedVmEngine {
  private readonly controller = new AbortController();
  private readonly pending = new Map<string, Pending>();
  private reading = 0;
  private readonly commands: Command[] = [];
  private wake?: () => void;
  private polling = false;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  private readonly readiness: Promise<void>;
  private run: Promise<void> = Promise.resolve();
  private stopping?: Promise<void>;
  private ended?: Error;
  private readonly signal: AbortSignal;

  private constructor(private readonly input: ProtectedVmOpen, startupSignal: AbortSignal, private readonly confirmReady: () => void) {
    this.signal = AbortSignal.any([input.signal, startupSignal, this.controller.signal, AbortSignal.timeout(780_000)]);
    this.readiness = new Promise<void>((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    void this.readiness.catch(() => {});
    this.signal.addEventListener("abort", () => this.fail(failure(this.signal.reason)), { once: true });
  }

  static async open(input: ProtectedVmOpen, dependencies?: { createSandbox: (broker: ProtectedVmBroker) => ProtectedVmSandbox; startupClock?: StartupClock }): Promise<ProtectedVmEngine> {
    const clock = dependencies?.startupClock ?? startupClock, deadline = clock.now() + 240_000;
    const startup = new AbortController();
    const expire = () => startup.abort(new DOMException("Protected VM startup deadline exceeded.", "TimeoutError"));
    const cancelStartup = clock.schedule(expire, 240_000);
    const signal = AbortSignal.any([input.signal, startup.signal]);
    const checkStartup = () => { if (clock.now() >= deadline) expire(); signal.throwIfAborted(); };
    let onAbort!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => { onAbort = () => reject(failure(signal.reason)); signal.addEventListener("abort", onAbort, { once: true }); });
    void cancelled.catch(() => {});
    let engine: ProtectedVmEngine | undefined;
    let confirmed = false;
    try {
      checkStartup();
      const scratch = await Promise.race([lstat(input.emptyDirectory), cancelled]);
      if (!scratch.isDirectory() || scratch.isSymbolicLink() || (await Promise.race([readdir(input.emptyDirectory), cancelled])).length) throw new Error("Protected workspace mount must be an empty owned directory.");
      checkStartup();
      engine = new ProtectedVmEngine(input, signal, () => { if (!confirmed) { checkStartup(); cancelStartup(); confirmed = true; } });
      const owned = engine;
      const broker: ProtectedVmBroker = (request, signal) => owned.broker(request, signal);
      const sandbox = dependencies?.createSandbox(broker) ?? new VmSandbox(undefined, "auto", { request: broker, maxRequests: 4096 });
      checkStartup();
      engine.run = sandbox.run({
        command: "exec /usr/local/bin/node /authorized/0/protected-engine.mjs",
        cwd: "/workspace", timeoutMs: 600_000, networkMode: "approve", signal: engine.signal,
        mounts: [{ source: input.emptyDirectory, target: "/workspace", writable: false },
          { source: input.bundleDirectory, target: "/authorized/0", writable: false }],
        authorizeNetwork: async () => false,
      }).then((result) => {
        const phase = /^Protected engine failed at (bundle|copy-executable|restore-checkpoint|start-engine|engine-health|engine-initialization|publish-ready|serve)$/m.exec(result.output)?.[1];
        const health = /^Protected engine health state (unobserved|http-refused|invalid-health|version-mismatch|accepted|unreachable)$/m.exec(result.output)?.[1];
        const initialization = /^Protected engine initialization state (unobserved|pending|provider-invalid|agent-invalid|tool-schema-invalid|http-refused|invalid-json|timeout|aborted|ready)$/m.exec(result.output)?.[1];
        if (!owned.stopping) owned.fail(new Error(`Protected engine worker exited (${result.exitCode}, phase ${phase ?? "unknown"}, health ${health ?? "unknown"}, initialization ${initialization ?? "unknown"}).`));
      },
        (error: unknown) => { owned.fail(failure(error)); if (!owned.stopping) throw error; });
      void engine.run.catch(() => {});
      await engine.ready(); return engine;
    } catch (error) { await engine?.stop().catch(() => {}); throw error; }
    finally { cancelStartup(); signal.removeEventListener("abort", onAbort); }
  }

  ready(): Promise<void> { return this.readiness; }

  private fail(error: Error): void {
    if (this.ended) return;
    this.ended = error;
    this.readyReject(error);
    for (const [id, pending] of this.pending) this.release(id, pending, error);
    this.commands.length = 0;
    this.wake?.();
    this.controller.abort(error);
  }

  private release(id: string, pending: Pending, error?: Error): void {
    this.pending.delete(id);
    pending.signal.removeEventListener("abort", pending.abort);
    if (error) { pending.reject(error); pending.body?.error(error); }
    pending.resume?.();
  }

  private enqueue(command: Command): void {
    if (this.ended) return;
    if (this.commands.length >= 64) { this.fail(new Error("Protected engine command queue is full.")); return; }
    this.commands.push(command);
    this.wake?.();
  }

  async fetch(request: Request): Promise<Response> {
    this.signal.throwIfAborted(); request.signal.throwIfAborted();
    const path = enginePath(request);
    if (this.pending.size + this.reading >= MAX_IN_FLIGHT) throw new Error("Too many protected engine requests.");
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_REQUEST_BYTES) throw new Error("Protected engine request is too large.");
    const chunks: Uint8Array[] = []; let size = 0;
    this.reading++;
    try { if (request.body) {
      const reader = request.body.getReader();
      const readingSignal = AbortSignal.any([request.signal, this.signal]);
      const cancel = () => { void reader.cancel(readingSignal.reason).catch(() => {}); };
      readingSignal.addEventListener("abort", cancel, { once: true });
      try {
        while (true) {
          readingSignal.throwIfAborted();
          const chunk = await reader.read();
          readingSignal.throwIfAborted();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_REQUEST_BYTES) throw new Error("Protected engine request is too large.");
          chunks.push(chunk.value);
        }
      } catch (error) { await reader.cancel(error).catch(() => {}); throw error; }
      finally { readingSignal.removeEventListener("abort", cancel); reader.releaseLock(); }
    } } finally { this.reading--; }
    this.signal.throwIfAborted(); request.signal.throwIfAborted();
    const headers: Record<string, string> = {};
    for (const name of ["content-type", "accept"]) { const value = request.headers.get(name); if (value) headers[name] = value; }
    const id = randomUUID();
    return new Promise<Response>((resolve, reject) => {
      const pending: Pending = { resolve, reject, bytes: 0, head: false, checkpoint: path === "/_protected/checkpoint", signal: request.signal,
        abort: () => {
          if (!this.pending.has(id)) return;
          this.release(id, pending, failure(request.signal.reason));
          this.enqueue({ kind: "cancel", id });
        } };
      this.pending.set(id, pending);
      request.signal.addEventListener("abort", pending.abort, { once: true });
      this.enqueue({ kind: "request", id, method: request.method, path, headers, bodyBase64: Buffer.concat(chunks).toString("base64") });
      if (request.signal.aborted) pending.abort();
    });
  }

  private async result(raw: unknown): Promise<OutboundResponse> {
    const result = resultSchema.parse(raw);
    const pending = this.pending.get(result.id);
    // A cancelled request may have one already-in-flight terminal frame. Never resurrect it.
    if (!pending) throw new Error("Unknown protected engine request identity.");
    if (result.kind === "error") { this.release(result.id, pending, new Error(result.message)); return jsonResponse({ ok: true }); }
    if (result.kind === "head") {
      if (pending.head) throw new Error("Duplicate protected engine response headers.");
      if (pending.checkpoint && (result.status !== 200 || result.headers["content-type"] !== "application/octet-stream" ||
          !/^[a-f0-9]{64}$/.test(result.headers["x-protected-sha256"] ?? ""))) throw new Error("Invalid protected checkpoint response.");
      pending.head = true;
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => { pending.body = controller; },
        pull: () => { pending.resume?.(); pending.resume = undefined; },
        cancel: () => { this.release(result.id, pending); this.enqueue({ kind: "cancel", id: result.id }); },
      }, { highWaterMark: CHUNK_BYTES, size: (chunk) => chunk?.byteLength ?? 0 });
      const headers = new Headers();
      for (const [name, value] of Object.entries(result.headers)) {
        if (["content-type", "cache-control"].includes(name.toLowerCase())) headers.set(name, value);
        if (pending.checkpoint && name === "x-protected-sha256") headers.set(name, value);
      }
      const empty = result.status === 204 || result.status === 205 || result.status === 304;
      pending.resolve(new Response(empty ? null : body, { status: result.status, headers }));
      return jsonResponse({ ok: true });
    }
    if (!pending.head || !pending.body) throw new Error("Protected engine body arrived before response headers.");
    if (result.kind === "end") { pending.body.close(); this.release(result.id, pending); return jsonResponse({ ok: true }); }
    const data = Buffer.from(result.data, "base64");
    pending.bytes += data.length;
    if (data.length > CHUNK_BYTES || pending.bytes > MAX_RESPONSE_BYTES) {
      const error = new Error("Protected engine response is too large.");
      this.release(result.id, pending, error); this.enqueue({ kind: "cancel", id: result.id }); throw error;
    }
    while ((pending.body.desiredSize ?? 0) <= 0 && this.pending.has(result.id)) {
      await new Promise<void>((resolve) => { pending.resume = resolve; });
      this.signal.throwIfAborted();
    }
    if (this.pending.has(result.id)) pending.body.enqueue(data);
    return jsonResponse({ ok: true });
  }

  private async broker(request: OutboundRequest, signal: AbortSignal): Promise<OutboundResponse> {
    signal.throwIfAborted(); this.signal.throwIfAborted();
    const url = new URL(request.url);
    if (url.origin !== ORIGIN || url.search || url.hash) throw new Error("Unknown protected transport capability destination.");
    if (url.pathname.startsWith("/model/") && request.method === "POST") {
      if (url.pathname !== "/model/chat/completions") throw new Error("Unknown protected model capability.");
      return this.input.handleOutbound(request, signal);
    }
    if (url.pathname === "/tools" && request.method === "POST") {
      const tool = toolSchema.safeParse(parsedBody(request));
      if (!tool.success) throw new Error("Unknown or malformed protected document tool.");
      return jsonResponse(await this.input.handleTool(tool.data, signal));
    }
    if (url.pathname === "/rpc/ready" && request.method === "POST") {
      z.object({ version: z.literal(1) }).strict().parse(parsedBody(request));
      this.confirmReady();
      this.readyResolve(); return jsonResponse({ ok: true });
    }
    if (url.pathname === "/rpc/result" && request.method === "POST") return this.result(parsedBody(request));
    if (url.pathname === "/rpc/next" && request.method === "GET") {
      if (this.polling) throw new Error("Duplicate protected engine command poll.");
      this.polling = true;
      try {
        if (!this.commands.length) await new Promise<void>((resolve) => {
          let timer: ReturnType<typeof setTimeout>;
          const wake = () => { clearTimeout(timer); signal.removeEventListener("abort", wake); if (this.wake === wake) this.wake = undefined; resolve(); };
          timer = setTimeout(wake, 20_000);
          this.wake = wake;
          signal.addEventListener("abort", wake, { once: true });
          if (signal.aborted || this.signal.aborted || this.commands.length) wake();
        });
        signal.throwIfAborted(); this.signal.throwIfAborted();
        return jsonResponse(this.commands.shift() ?? { kind: "idle" });
      } finally { this.polling = false; }
    }
    throw new Error("Unknown protected transport capability.");
  }

  stop(): Promise<void> {
    this.stopping ??= (async () => {
      this.fail(new Error("Protected engine stopped."));
      await this.run;
    })();
    return this.stopping;
  }
}
