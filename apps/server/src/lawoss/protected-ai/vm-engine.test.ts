import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProtectedVmEngine, type ProtectedVmBroker, type ProtectedVmSandbox } from "./vm-engine.js";
import { prepareOutboundRequest, type OutboundResponse } from "../../agent-sandbox/network.js";

// Protocol tests deliberately replace VM execution, never the production broker.
// They prove bridge framing/lifetime only; actual NIC-free execution is a separate gate.
async function harness() {
  const root = await mkdtemp(join(tmpdir(), "lawoss-vm-bridge-"));
  const bundleDirectory = join(root, "bundle"), emptyDirectory = join(root, "empty");
  await Promise.all([mkdir(bundleDirectory), mkdir(emptyDirectory)]);
  let broker!: ProtectedVmBroker;
  let runSignal!: AbortSignal;
  let stopped = false;
  const sandbox: ProtectedVmSandbox = { run: async (input) => {
    runSignal = input.signal;
    await send("/rpc/ready", { version: 1 });
    await new Promise<void>((resolve) => {
      input.signal.addEventListener("abort", () => { stopped = true; resolve(); }, { once: true });
      if (input.signal.aborted) { stopped = true; resolve(); }
    });
    return { exitCode: 0, output: "", truncated: false };
  } };
  async function send(path: string, body?: unknown): Promise<OutboundResponse> {
    const encoded = body === undefined ? "" : JSON.stringify(body);
    return broker(prepareOutboundRequest({ url: `http://protected-lawoss.invalid${path}`, method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" }, bodyBase64: Buffer.from(encoded).toString("base64") }), runSignal);
  }
  const opening = ProtectedVmEngine.open({ bundleDirectory, emptyDirectory,
    signal: new AbortController().signal,
    handleOutbound: async () => { throw new Error("No model dispatch in protocol fixture"); },
    handleTool: async (call) => ({ name: call.name }),
  }, { createSandbox: (callback) => { broker = callback; return sandbox; } });
  return { opening, send, stopped: () => stopped, close: async () => { await (await opening).stop(); await rm(root, { recursive: true }); } };
}
function decoded(response: OutboundResponse): unknown { return JSON.parse(Buffer.from(response.bodyBase64, "base64").toString()); }

describe("protected VM bridge protocol (stub worker, no VM confinement claim)", () => {
  test("forwards actual HTTP response chunks beyond stdout limits with demand and exact status", async () => {
    const h = await harness();
    const engine = await h.opening;
    try {
      const fetching = engine.fetch(new Request("http://private-engine/session", { method: "POST", body: '{"title":"Synthetic"}' }));
      const command = decoded(await h.send("/rpc/next"));
      expect(command).toMatchObject({ kind: "request", method: "POST", path: "/session" });
      if (!command || typeof command !== "object" || !("id" in command) || typeof command.id !== "string") throw new Error("Missing request ID");
      await h.send("/rpc/result", { kind: "head", id: command.id, status: 201, headers: { "content-type": "application/json" } });
      const response = await fetching;
      const reading = response.arrayBuffer();
      const chunk = Buffer.alloc(32 * 1024, 120);
      for (let i = 0; i < 40; i++) await h.send("/rpc/result", { kind: "chunk", id: command.id, data: chunk.toString("base64") });
      await h.send("/rpc/result", { kind: "end", id: command.id });
      expect(response.status).toBe(201);
      expect((await reading).byteLength).toBe(40 * chunk.length);
    } finally { await h.close(); }
    expect(h.stopped()).toBe(true);
  });

  test("rejects arbitrary destinations, malformed capabilities, and unknown tool names", async () => {
    const h = await harness(); const engine = await h.opening;
    try {
      await expect(h.send("/not-a-capability", {})).rejects.toThrow("capability");
      await expect(h.send("/tools", { name: "shell", arguments: {} })).rejects.toThrow("tool");
      await expect(h.send("/rpc/result", { kind: "head", id: "guessed", status: 200, headers: {} })).rejects.toThrow();
      await expect(engine.fetch(new Request("http://private-engine/config", { method: "PATCH", body: "{}" }))).rejects.toThrow("route");
      expect(decoded(await h.send("/tools", { name: "lawoss_documents_list", arguments: {} }))).toEqual({ name: "lawoss_documents_list" });
    } finally { await h.close(); }
  });

  test("caller cancellation reaches the guest and stop rejects owned requests before returning", async () => {
    const h = await harness(); const engine = await h.opening;
    const controller = new AbortController();
    const fetching = engine.fetch(new Request("http://private-engine/event", { signal: controller.signal }));
    const rejected = fetching.then(() => null, (error: unknown) => error);
    const request = decoded(await h.send("/rpc/next"));
    controller.abort(new Error("Caller disconnected"));
    expect(await rejected).toBeInstanceOf(Error);
    expect(decoded(await h.send("/rpc/next"))).toMatchObject({ kind: "cancel", id: request && typeof request === "object" && "id" in request ? request.id : null });
    await engine.stop();
    expect(h.stopped()).toBe(true);
    await expect(engine.fetch(new Request("http://private-engine/session"))).rejects.toThrow();
    await h.close();
  });

  test("stopping while the caller body is idle cancels the owned reader", async () => {
    const h = await harness(); const engine = await h.opening;
    let cancelled = 0;
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(controller) { bodyController = controller; }, cancel() { cancelled++; } });
    const fetching = engine.fetch(new Request("http://private-engine/session", { method: "POST", body }));
    const settled = fetching.then(() => null, (error: unknown) => error);
    await Promise.resolve();
    try {
      await engine.stop();
      expect(cancelled).toBe(1);
      expect(await settled).toBeInstanceOf(Error);
    } finally {
      if (!cancelled) bodyController.close();
      await settled;
      await h.close();
    }
  });

  test("refuses a populated scratch mount before worker start", async () => {
    const root = await mkdtemp(join(tmpdir(), "lawoss-vm-not-empty-"));
    let started = false;
    try {
      await writeFile(join(root, "private-client-document.txt"), "synthetic canary");
      const opening = ProtectedVmEngine.open({ bundleDirectory: root, emptyDirectory: root, signal: new AbortController().signal,
        handleOutbound: async () => { throw new Error("No dispatch permitted"); }, handleTool: async () => null },
      { createSandbox: () => ({ run: async () => { started = true; throw new Error("Started populated scratch"); } }) });
      await expect(opening).rejects.toThrow("empty");
      expect(started).toBe(false);
    } finally { await rm(root, { recursive: true }); }
  });

  test("checkpoint is an exact internal GET and returns only its bound binary digest", async () => {
    const h = await harness(); const engine = await h.opening;
    try {
      await expect(engine.fetch(new Request("http://private-engine/_protected/checkpoint", { method: "POST" }))).rejects.toThrow("checkpoint route");
      await expect(engine.fetch(new Request("http://private-engine/_protected/checkpoint?source=foreign"))).rejects.toThrow("checkpoint route");
      const fetching = engine.fetch(new Request("http://private-engine/_protected/checkpoint"));
      const command = decoded(await h.send("/rpc/next"));
      expect(command).toMatchObject({ method: "GET", path: "/_protected/checkpoint" });
      if (!command || typeof command !== "object" || !("id" in command) || typeof command.id !== "string") throw new Error("Missing request ID");
      const digest = "a".repeat(64);
      await h.send("/rpc/result", { kind: "head", id: command.id, status: 200, headers: { "content-type": "application/octet-stream", "x-protected-sha256": digest } });
      const response = await fetching;
      const reading = response.arrayBuffer();
      await h.send("/rpc/result", { kind: "chunk", id: command.id, data: Buffer.from("SQLite format 3\0").toString("base64") });
      await h.send("/rpc/result", { kind: "end", id: command.id });
      expect(response.headers.get("x-protected-sha256")).toBe(digest);
      expect(Buffer.from(await reading).toString()).toBe("SQLite format 3\0");
    } finally { await h.close(); }
  });
});
