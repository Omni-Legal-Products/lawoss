import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProtectedVmEngine, type ProtectedVmBroker, type ProtectedVmSandbox } from "./vm-engine.js";
import { prepareOutboundRequest, type OutboundResponse } from "../../agent-sandbox/network.js";

// Protocol tests deliberately replace VM execution, never the production broker.
// They prove bridge framing/lifetime only; actual NIC-free execution is a separate gate.
async function harness(options: { manualReady?: boolean; drain?: Promise<void>; startupClock?: { now(): number; schedule(callback: () => void, delay: number): () => void } } = {}) {
  const root = await mkdtemp(join(tmpdir(), "lawoss-vm-bridge-"));
  const bundleDirectory = join(root, "bundle"), emptyDirectory = join(root, "empty");
  await Promise.all([mkdir(bundleDirectory), mkdir(emptyDirectory)]);
  let broker!: ProtectedVmBroker;
  let runSignal!: AbortSignal;
  let stopped = false;
  const controller = new AbortController();
  let startedResolve!: () => void;
  const started = new Promise<void>(resolve => { startedResolve = resolve; });
  const sandbox: ProtectedVmSandbox = { run: async (input) => {
    runSignal = input.signal;
    startedResolve();
    if (!options.manualReady) await send("/rpc/ready", { version: 1 });
    await new Promise<void>((resolve) => {
      input.signal.addEventListener("abort", () => { stopped = true; resolve(); }, { once: true });
      if (input.signal.aborted) { stopped = true; resolve(); }
    });
    await options.drain;
    return { exitCode: 0, output: "", truncated: false };
  } };
  async function send(path: string, body?: unknown): Promise<OutboundResponse> {
    const encoded = body === undefined ? "" : JSON.stringify(body);
    return broker(prepareOutboundRequest({ url: `http://protected-lawoss.invalid${path}`, method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" }, bodyBase64: Buffer.from(encoded).toString("base64") }), runSignal);
  }
  const opening = ProtectedVmEngine.open({ bundleDirectory, emptyDirectory,
    signal: controller.signal,
    handleOutbound: async () => { throw new Error("No model dispatch in protocol fixture"); },
    handleTool: async (call) => ({ name: call.name }),
  }, { createSandbox: (callback) => { broker = callback; return sandbox; }, startupClock: options.startupClock });
  void opening.catch(() => {});
  return { opening, started, send, cancel: () => controller.abort(), stopped: () => stopped, close: async () => { try { await (await opening).stop(); } finally { await rm(root, { recursive: true }); } } };
}
function decoded(response: OutboundResponse): unknown { return JSON.parse(Buffer.from(response.bodyBase64, "base64").toString()); }
async function holdReads(engine: ProtectedVmEngine, h: Awaited<ReturnType<typeof harness>>, count = 12) {
  const reads: Array<Promise<Response>> = [], commands: Array<{id:string}> = [];
  for (let i = 0; i < count; i++) {
    const reading = engine.fetch(new Request(`http://private-engine/session/ses_fixture/message?offset=${i}`));
    void reading.catch(() => {}); reads.push(reading);
    commands.push(decoded(await h.send("/rpc/next")) as {id:string});
  }
  return {reads,commands};
}

function startupClock() {
  let now = 0;
  const timers = new Set<{ due: number; callback: () => void }>();
  return {
    now: () => now,
    pending: () => timers.size,
    schedule(callback: () => void, delay: number) { const timer = { due: now + delay, callback }; timers.add(timer); return () => { timers.delete(timer); }; },
    advance(milliseconds: number, fire = true) { now += milliseconds; if (fire) for (const timer of [...timers]) if (timer.due <= now) { timers.delete(timer); timer.callback(); } },
  };
}

describe("protected VM bridge protocol (stub worker, no VM confinement claim)", () => {
  test("startup expiry includes scratch inspection before any worker is constructed", async () => {
    const root = await mkdtemp(join(tmpdir(), "lawoss-vm-entry-deadline-")), clock = startupClock();
    let started = false;
    try {
      const opening = ProtectedVmEngine.open({ bundleDirectory: root, emptyDirectory: root, signal: new AbortController().signal,
        handleOutbound: async () => { throw new Error("No dispatch permitted"); }, handleTool: async () => null },
      { startupClock: clock, createSandbox: () => { started = true; throw new Error("Expired startup created a worker"); } });
      clock.advance(240_000);
      await expect(opening).rejects.toMatchObject({ name: "TimeoutError" });
      expect(started).toBe(false); expect(clock.pending()).toBe(0);
    } finally { await rm(root, { recursive: true }); }
  });

  test("every pre-ready failure clears its owned startup timer", async () => {
    for (const mode of ["scratch", "aborted", "factory", "run"]) {
      const root = await mkdtemp(join(tmpdir(), "lawoss-vm-startup-cleanup-")), clock = startupClock(), controller = new AbortController();
      try {
        if (mode === "aborted") controller.abort(new Error("Cancelled before startup"));
        const opening = ProtectedVmEngine.open({ bundleDirectory: root, emptyDirectory: mode === "scratch" ? join(root, "absent") : root, signal: controller.signal,
          handleOutbound: async () => { throw new Error("No dispatch permitted"); }, handleTool: async () => null },
        { startupClock: clock, createSandbox: () => {
          if (mode === "factory") throw new Error("Fixture construction failed");
          return { run: () => { throw new Error("Fixture run failed synchronously"); } };
        } });
        await expect(opening).rejects.toThrow(); expect(clock.pending()).toBe(0);
      } finally { await rm(root, { recursive: true }); }
    }
  });

  test("absolute startup expiry rejects late readiness and awaits its owned worker drain", async () => {
    const clock = startupClock(); let drain!: () => void;
    const h = await harness({ manualReady: true, startupClock: clock, drain: new Promise<void>(resolve => { drain = resolve; }) });
    let settled = false;
    const result = h.opening.then(() => { settled = true; return null; }, (error: unknown) => { settled = true; return error; });
    try {
      await h.started;
      clock.advance(239_999); expect(h.stopped()).toBe(false);
      clock.advance(1); await Promise.resolve();
      expect(h.stopped()).toBe(true);
      await expect(h.send("/rpc/ready", { version: 1 })).rejects.toThrow("startup");
      expect(settled).toBe(false);
      drain();
      expect(await result).toMatchObject({ name: "TimeoutError" });
    } finally { h.cancel(); drain(); await h.close().catch(() => {}); }
  });

  test("validated readiness disarms only startup expiry while the actual session bridge remains live", async () => {
    const clock = startupClock(), h = await harness({ manualReady: true, startupClock: clock });
    try {
      await h.started;
      await expect(h.send("/rpc/ready", { version: 2 })).rejects.toThrow();
      await h.send("/rpc/ready", { version: 1 });
      const engine = await h.opening;
      expect(clock.pending()).toBe(0);
      clock.advance(240_000); expect(h.stopped()).toBe(false);
      expect(decoded(await h.send("/rpc/ready", { version: 1 }))).toEqual({ ok: true });
      const fetching = engine.fetch(new Request("http://private-engine/session"));
      const command = decoded(await h.send("/rpc/next")) as { id: string };
      await h.send("/rpc/result", { kind: "head", id: command.id, status: 200, headers: {} });
      const response = await fetching; const body = response.text();
      await h.send("/rpc/result", { kind: "end", id: command.id });
      expect(response.status).toBe(200); expect(await body).toBe("");
    } finally { await h.close(); }
  });

  test("elapsed absolute startup time refuses readiness even before the scheduler callback runs", async () => {
    const clock = startupClock(), h = await harness({ manualReady: true, startupClock: clock });
    try {
      await h.started; clock.advance(240_000, false);
      await expect(h.send("/rpc/ready", { version: 1 })).rejects.toThrow("startup");
      await expect(h.opening).rejects.toMatchObject({ name: "TimeoutError" });
      expect(h.stopped()).toBe(true);
    } finally { await h.close().catch(() => {}); }
  });

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

  test("an original prompt waits behind twelve owned reads and is dispatched once after EOF and guest retirement", async () => {
    const h = await harness(), engine = await h.opening;
    const reads: Array<Promise<Response>> = [], commands: Array<{id: string}> = [];
    let consumed = 0, promptError: unknown;
    try {
      for (let i = 0; i < 12; i++) {
        const reading = engine.fetch(new Request(`http://private-engine/session/ses_fixture/message?offset=${i}`));
        void reading.catch(() => {}); reads.push(reading);
        commands.push(decoded(await h.send("/rpc/next")) as {id: string});
      }
      const body = new ReadableStream<Uint8Array>({ pull(controller) {
        consumed++; controller.enqueue(new TextEncoder().encode('{"messageID":"msg_original","parts":[]}')); controller.close();
      } }, { highWaterMark: 0 });
      const prompt = engine.fetch(new Request("http://private-engine/session/ses_fixture/prompt_async", { method: "POST", body }));
      void prompt.catch(error => { promptError = error; });
      await new Promise<void>(resolve => { queueMicrotask(resolve); });
      expect(promptError).toBeUndefined(); expect(consumed).toBe(0);
      const first = commands[0];
      await h.send("/rpc/result", { kind: "head", id: first.id, status: 200, headers: {} });
      const reading = (await reads[0]).text();
      await h.send("/rpc/result", { kind: "chunk", id: first.id, data: Buffer.from("[]").toString("base64") });
      expect(consumed).toBe(0); // Headers and a partial body do not retire an RPC.
      await h.send("/rpc/result", { kind: "end", id: first.id });
      expect(await reading).toBe("[]");
      expect(consumed).toBe(0); // EOF is not proof that guest task cleanup finished.
      await h.send("/rpc/result", { kind: "retired", id: first.id });
      const command = decoded(await h.send("/rpc/next"));
      expect(command).toMatchObject({ kind: "request", method: "POST", path: "/session/ses_fixture/prompt_async", bodyBase64: Buffer.from('{"messageID":"msg_original","parts":[]}').toString("base64") });
      expect(consumed).toBe(1);
      if (!command || typeof command !== "object" || !("id" in command) || typeof command.id !== "string") throw new Error("Missing original prompt command");
      await h.send("/rpc/result", { kind: "head", id: command.id, status: 204, headers: {} });
      await h.send("/rpc/result", { kind: "end", id: command.id });
      expect((await prompt).status).toBe(204); expect(promptError).toBeUndefined();
      await h.send("/rpc/result", { kind: "retired", id: command.id });
      const probe = engine.fetch(new Request("http://private-engine/session/ses_fixture/todo"));void probe.catch(()=>{});
      const next = decoded(await h.send("/rpc/next")) as {id:string};
      expect(next).toMatchObject({kind:"request",method:"GET",path:"/session/ses_fixture/todo"});
      await h.send("/rpc/result",{kind:"head",id:next.id,status:204,headers:{}});await h.send("/rpc/result",{kind:"end",id:next.id});await probe;
    } finally { await h.close(); await Promise.allSettled(reads); }
  });

  test("retirement cannot release an active response and completed duplicate frames remain refused", async () => {
    const h = await harness(), engine = await h.opening;
    try {
      const reading = engine.fetch(new Request("http://private-engine/session"));
      const command = decoded(await h.send("/rpc/next")) as {id:string};
      await expect(h.send("/rpc/result", {kind:"retired",id:command.id})).rejects.toThrow("retirement");
      await h.send("/rpc/result", {kind:"head",id:command.id,status:200,headers:{}});
      const text = (await reading).text();
      await h.send("/rpc/result", {kind:"end",id:command.id}); expect(await text).toBe("");
      await expect(h.send("/rpc/result", {kind:"end",id:command.id})).rejects.toThrow();
      await h.send("/rpc/result", {kind:"retired",id:command.id});
      await expect(h.send("/rpc/result", {kind:"retired",id:command.id})).rejects.toThrow("retirement");
      await expect(h.send("/rpc/result", {kind:"retired",id:"23d6e5c0-dfca-4388-bc3e-0ccabfcedde1"})).rejects.toThrow("retirement");
    } finally { await h.close(); }
  });

  test("bounded FIFO admission never consumes queued bodies and removes only the cancelled waiter", async () => {
    const h = await harness(), engine = await h.opening;
    const held = await holdReads(engine,h), waiting: Array<Promise<Response>> = [];
    let consumed = 0;
    try {
      const controllers = Array.from({length:64}, () => new AbortController());
      for (const [i,controller] of controllers.entries()) {
        const body = new ReadableStream<Uint8Array>({pull(stream) {consumed++;stream.enqueue(new TextEncoder().encode(String(i)));stream.close();}}, {highWaterMark:0});
        const work = engine.fetch(new Request(`http://private-engine/session/ses_fixture/prompt_async?offset=${i}`, {method:"POST",body,signal:controller.signal}));
        void work.catch(() => {}); waiting.push(work);
      }
      await expect(engine.fetch(new Request("http://private-engine/config",{method:"PATCH",body:"{}"}))).rejects.toThrow("route");
      await expect(engine.fetch(new Request("http://private-engine/session",{method:"POST",headers:{"content-length":"4194305"}}))).rejects.toThrow("too large");
      await expect(engine.fetch(new Request("http://private-engine/session"))).rejects.toThrow("admission queue is full");
      expect(consumed).toBe(0);
      const cancelled = new Error("Cancel the first waiting caller only");controllers[0].abort(cancelled);
      await expect(waiting[0]).rejects.toBe(cancelled);
      const replacement = engine.fetch(new Request("http://private-engine/session/ses_fixture/todo"));void replacement.catch(()=>{});waiting.push(replacement);
      const id = held.commands[0].id;
      await h.send("/rpc/result",{kind:"error",id,message:"Controlled metadata failure"});
      await expect(held.reads[0]).rejects.toThrow("Controlled metadata failure");
      expect(consumed).toBe(0);
      await h.send("/rpc/result",{kind:"retired",id});
      const first = decoded(await h.send("/rpc/next")) as {id:string};
      expect(first).toMatchObject({method:"POST",path:"/session/ses_fixture/prompt_async?offset=1",bodyBase64:Buffer.from("1").toString("base64")});
      expect(consumed).toBe(1);
      await h.send("/rpc/result",{kind:"head",id:first.id,status:204,headers:{}});
      await h.send("/rpc/result",{kind:"end",id:first.id});expect((await waiting[1]).status).toBe(204);
      expect(consumed).toBe(1);
      await h.send("/rpc/result",{kind:"retired",id:first.id});
      expect(decoded(await h.send("/rpc/next"))).toMatchObject({path:"/session/ses_fixture/prompt_async?offset=2"});
      expect(consumed).toBe(2);
    } finally { await engine.stop(); await Promise.allSettled([...held.reads,...waiting]);await h.close(); }
  });

  test.each(["caller", "body"])("%s cancellation retains dispatched credit until confirmed guest retirement", async mode => {
    const h = await harness(), engine = await h.opening, held = await holdReads(engine,h);
    let consumed = 0;
    try {
      const id = held.commands[0].id;
      await h.send("/rpc/result",{kind:"head",id,status:200,headers:{}});
      const response = await held.reads[0];
      // Both public cancellation paths send the same issued UUID to the guest.
      if (mode === "body") await response.body!.cancel();
      else {
        // Admit a caller-controlled request by retiring one finite original read.
        await h.send("/rpc/result",{kind:"end",id});await response.text();await h.send("/rpc/result",{kind:"retired",id});
      }
      const controller = new AbortController();
      let cancelledId = id;
      let controlled: Promise<Response> | undefined;
      if (mode === "caller") {
        controlled = engine.fetch(new Request("http://private-engine/session/ses_fixture/todo",{signal:controller.signal}));void controlled.catch(()=>{});
        cancelledId = (decoded(await h.send("/rpc/next")) as {id:string}).id;
        controller.abort(new Error("Caller disconnected"));await expect(controlled).rejects.toThrow("Caller disconnected");
      }
      expect(decoded(await h.send("/rpc/next"))).toMatchObject({kind:"cancel",id:cancelledId});
      const body = new ReadableStream<Uint8Array>({pull(stream){consumed++;stream.enqueue(new Uint8Array());stream.close();}},{highWaterMark:0});
      const queued = engine.fetch(new Request("http://private-engine/session/ses_fixture/prompt_async",{method:"POST",body}));void queued.catch(()=>{});
      await h.send("/rpc/result",{kind:"head",id:cancelledId,status:200,headers:{}});
      await h.send("/rpc/result",{kind:"chunk",id:cancelledId,data:Buffer.from("discarded").toString("base64")});
      await h.send("/rpc/result",{kind:"end",id:cancelledId});
      expect(consumed).toBe(0);
      await h.send("/rpc/result",{kind:"retired",id:cancelledId});
      const command = decoded(await h.send("/rpc/next")) as {id:string};expect(command).toMatchObject({method:"POST",path:"/session/ses_fixture/prompt_async"});expect(consumed).toBe(1);
      await h.send("/rpc/result",{kind:"head",id:command.id,status:204,headers:{}});await h.send("/rpc/result",{kind:"end",id:command.id});expect((await queued).status).toBe(204);
    } finally {await engine.stop();await Promise.allSettled(held.reads);await h.close();}
  });

  test("a cancelled predispatch reader returns its permit only after cancellation and lock release", async () => {
    const h = await harness(), engine = await h.opening, controller = new AbortController();
    let releaseCancel!:()=>void, enteredCancel!:()=>void, consumed = 0, previousLocked: boolean | undefined;
    const cancelEntered = new Promise<void>(resolve=>{enteredCancel=resolve;});
    const cancellation = new Promise<void>(resolve=>{releaseCancel=resolve;});
    const request = new Request("http://private-engine/session",{method:"POST",signal:controller.signal,
      body:new ReadableStream<Uint8Array>({cancel(){enteredCancel();return cancellation;}},{highWaterMark:0})});
    const reading = engine.fetch(request);void reading.catch(()=>{});
    const held = await holdReads(engine,h,11);
    const body = new ReadableStream<Uint8Array>({pull(stream){consumed++;previousLocked=request.body!.locked;stream.close();}},{highWaterMark:0});
    const queued = engine.fetch(new Request("http://private-engine/session/ses_fixture/prompt_async",{method:"POST",body}));void queued.catch(()=>{});
    try {
      const reason = new Error("Cancel before private dispatch");controller.abort(reason);await cancelEntered;
      await new Promise<void>(resolve=>{setImmediate(resolve);});expect(consumed).toBe(0);
      releaseCancel();await expect(reading).rejects.toBe(reason);
      const command = decoded(await h.send("/rpc/next")) as {id:string};
      expect(command).toMatchObject({method:"POST",path:"/session/ses_fixture/prompt_async"});expect(consumed).toBe(1);expect(previousLocked).toBe(false);
      await h.send("/rpc/result",{kind:"head",id:command.id,status:204,headers:{}});await h.send("/rpc/result",{kind:"end",id:command.id});expect((await queued).status).toBe(204);
    } finally {releaseCancel();await engine.stop();await Promise.allSettled([reading,queued,...held.reads]);await h.close();}
  });

  test.each(["stop", "engine-abort"])("%s drains an admitted body reader and rejects bounded waiters without reading their bodies", async mode => {
    const h = await harness(), engine = await h.opening;
    let releaseCancel!:()=>void, enteredCancel!:()=>void;
    const cancelEntered = new Promise<void>(resolve=>{enteredCancel=resolve;});
    const cancellation = new Promise<void>(resolve=>{releaseCancel=resolve;});
    const body = new ReadableStream<Uint8Array>({cancel(){enteredCancel();return cancellation;}},{highWaterMark:0});
    const reading = engine.fetch(new Request("http://private-engine/session",{method:"POST",body}));void reading.catch(()=>{});
    const held = await holdReads(engine,h,11);
    let consumed = 0, stopped = false;
    const queuedBody = new ReadableStream<Uint8Array>({pull(stream){consumed++;stream.close();}},{highWaterMark:0});
    const queued = engine.fetch(new Request("http://private-engine/session",{method:"POST",body:queuedBody}));void queued.catch(()=>{});
    if (mode === "engine-abort") h.cancel();
    const stopping = engine.stop().then(()=>{stopped=true;});
    try {
      await cancelEntered;
      await new Promise<void>(resolve => { setImmediate(resolve); });
      expect(stopped).toBe(false);expect(consumed).toBe(0);
      await expect(queued).rejects.toBeInstanceOf(Error);
      releaseCancel();await stopping;expect(stopped).toBe(true);
      await expect(reading).rejects.toBeInstanceOf(Error);expect(consumed).toBe(0);
    } finally {releaseCancel();await stopping;await Promise.allSettled([reading,queued,...held.reads]);await h.close();}
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
