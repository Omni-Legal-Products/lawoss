import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { startServer } from "../server.js";
import type { serve } from "../serve-node.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(next => { resolve = next; });
  return { promise, resolve };
}

async function observed(predicate: () => boolean) {
  const deadline = Date.now() + 1_000;
  while (!predicate() && Date.now() < deadline) await delay(10);
  return predicate();
}

export const proxyCancellationCases = ["idle disconnect", "before headers", "before metadata headers", "success and persistence"] as const;
export type ProxyCancellationCase = typeof proxyCancellationCases[number];

// Only the engine protocol is a fixture. Authentication, directory resolution,
// proxy, HTTP adapter, filesystem writes and server lifetime are production code.
export async function verifyProxyCancellation(start: typeof startServer, scenario: ProxyCancellationCase) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "proxy-cancellation-")));
  const path = join(root, "Matter Č");
  await mkdir(path);
  const streams = new Map<string, ServerResponse>();
  const closed = new Set<string>();
  const arrived = deferred();
  const protocolErrors: string[] = [];
  const prompts: unknown[] = [];
  const upstream = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture");
    if (request.headers.authorization !== "Basic Zml4dHVyZTpzZWNyZXQ=") protocolErrors.push("engine authentication");
    if (decodeURIComponent(String(request.headers["x-opencode-directory"])) !== path) protocolErrors.push("current directory");
    if (request.headers["x-legalwork-host-token"] || request.headers["x-legalwork-client-id"]) protocolErrors.push("client credential leak");
    if (url.pathname === "/event") {
      const id = url.searchParams.get("stream") ?? "";
      streams.set(id, response);
      response.once("close", () => { closed.add(id); });
      if (id === "before") { arrived.resolve(); return; }
      response.writeHead(200, { "Content-Type": "text/event-stream", "X-Fixture": "kept" });
      response.write('data: {"type":"server.connected"}\n\n');
      // Deliberately idle: disconnect must not wait for another chunk/read.
      return;
    }
    if (scenario === "before metadata headers" && url.pathname === "/session/synthetic") {
      streams.set("metadata", response);
      response.once("close", () => closed.add("metadata"));
      arrived.resolve();
      return;
    }
    if (url.pathname === "/session/synthetic") {
      // The proxy checks that a session belongs to the workspace before forwarding.
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ id: "synthetic", directory: path }));
      return;
    }
    if (url.pathname === "/session/synthetic/prompt_async") {
      let body = "";
      for await (const chunk of request) body += chunk;
      prompts.push(JSON.parse(body));
      response.writeHead(204).end();
      return;
    }
    if (url.pathname === "/path") {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ directory: path }));
      return;
    }
    response.writeHead(404).end();
  });
  const controllers: AbortController[] = [];
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
  let server: Awaited<ReturnType<typeof start>> | undefined;
  try {
    await new Promise<void>(resolve => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    assert.ok(address && typeof address !== "string");
    server = await start({
      host: "127.0.0.1", port: 0, token: "client", hostToken: "host",
      configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 1_000 }, corsOrigins: ["*"],
      workspaces: [{ id: "stable", name: "Matter", path, preset: "starter", workspaceType: "local", baseUrl: `http://127.0.0.1:${address.port}`, opencodeUsername: "fixture", opencodePassword: "secret", ...(scenario === "before metadata headers" ? { appFilesStorageKey: "synthetic-storage" } : {}) }],
      authorizedRoots: [path], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
    });
    const base = `http://127.0.0.1:${server.port}/workspace/stable`;
    const selected = `${base}/opencode`;
    const headers = { Authorization: "Bearer client", "x-legalwork-client-id": "fixture-client", "x-legalwork-host-token": "synthetic-not-host" };
    const denied = await fetch(`${selected}/event`);
    assert.equal(denied.status, 401); await denied.arrayBuffer();
    assert.equal(streams.size, 0, "unauthorized request must never reach engine");
    const escape = await fetch(`${selected}/event?directory=${encodeURIComponent(root)}`, { headers });
    assert.equal(escape.status, 400);
    assert.equal((await escape.json()).code, "path_escape");
    assert.equal(streams.size, 0, "out-of-workspace directory must never reach engine");
    const open = async (id: string) => {
      const controller = new AbortController(); controllers.push(controller);
      const response = await fetch(`${selected}/event?stream=${id}`, { headers, signal: controller.signal });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-fixture"), "kept");
      assert.equal(response.headers.get("content-type"), "text/event-stream");
      const reader = response.body!.getReader(); readers.push(reader);
      assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: {"type":"server.connected"}\n\n');
      return { controller, reader };
    };
    if (scenario === "idle disconnect") {
      const first = await open("first"), survivor = await open("survivor");
      assert.deepEqual(protocolErrors, []);
      first.controller.abort();
      await first.reader.read().catch(() => undefined);
      const firstClosed = await observed(() => closed.has("first"));
      console.info(JSON.stringify({ scenario, upstreamOpened: streams.size, cancelledUpstreamClosed: firstClosed, survivorClosed: closed.has("survivor") }));
      assert.equal(firstClosed, true, "downstream abort must close its idle upstream SSE connection");
      assert.equal(closed.has("survivor"), false, "independent upstream stream must survive");
      streams.get("survivor")!.write('data: {"type":"session.status"}\n\n');
      assert.equal(new TextDecoder().decode((await survivor.reader.read()).value), 'data: {"type":"session.status"}\n\n');
      streams.get("survivor")!.end();
      assert.equal((await survivor.reader.read()).done, true);
    } else if (scenario === "before headers" || scenario === "before metadata headers") {
      const controller = new AbortController(); controllers.push(controller);
      const pending = fetch(`${selected}/${scenario === "before headers" ? "event?stream=before" : "session/synthetic/message"}`, { headers, signal: controller.signal });
      const outcome = pending.then(() => "response", () => "aborted");
      await arrived.promise;
      assert.deepEqual(protocolErrors, []);
      controller.abort();
      assert.equal(await outcome, "aborted");
      assert.equal(await observed(() => closed.has(scenario === "before headers" ? "before" : "metadata")), true, "client abort before engine headers must close the upstream request");
    } else {
      const stream = await open("success");
      streams.get("success")!.end('data: {"type":"session.idle"}\n\n');
      assert.equal(new TextDecoder().decode((await stream.reader.read()).value), 'data: {"type":"session.idle"}\n\n');
      assert.equal((await stream.reader.read()).done, true);
      const prompt = { messageID: "synthetic-message", parts: [{ type: "text", text: "Synthetic accepted request" }] };
      const accepted = await fetch(`${selected}/session/synthetic/prompt_async`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(prompt) });
      assert.equal(accepted.status, 204); await accepted.arrayBuffer();
      assert.deepEqual(prompts, [prompt]);
      const save = await fetch(`${base}/files/content`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ path: "result.txt", content: "Persisted synthetic output" }) });
      assert.equal(save.status, 200); await save.arrayBuffer();
      assert.equal(await readFile(join(path, "result.txt"), "utf8"), "Persisted synthetic output");
      const reread = await fetch(`${base}/files/content?path=result.txt`, { headers });
      assert.equal(reread.status, 200);
      assert.equal((await reread.json()).content, "Persisted synthetic output");
    }
    const health = await fetch(`${selected}/path`, { headers });
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { directory: path });
    assert.deepEqual(protocolErrors, []);
  } finally {
    for (const controller of controllers) controller.abort();
    for (const reader of readers) { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    // Force-close only fixture-owned responses, including the intentional RED leak.
    for (const response of streams.values()) response.destroy();
    const upstreamClosed = new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
    upstream.closeAllConnections();
    await server?.stop();
    await upstreamClosed;
    assert.equal(upstream.listening, false);
    const allClosed = await observed(() => closed.size === streams.size);
    await rm(root, { recursive: true });
    assert.equal(allClosed, true, "all fixture upstream responses must close during cleanup");
  }
}

export const adapterCancellationCases = ["idle body", "late response", "cancel rejection", "normal completion", "read error before chunk", "read error after chunk"] as const;
export type AdapterCancellationCase = typeof adapterCancellationCases[number];

export async function verifyAdapterCancellation(start: typeof serve, scenario: AdapterCancellationCase) {
  const ready = deferred(), cancelled = deferred();
  let body: ReadableStream<Uint8Array> | undefined;
  let incoming: Request | undefined;
  let cancelCalls = 0;
  const primary = new Error("synthetic primary read failure");
  const cleanupFailure = new Error("synthetic cancellation failure");
  const errors: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  let producer: ReadableStreamDefaultController<Uint8Array> | undefined;
  let server: Awaited<ReturnType<typeof start>> | undefined;
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    server = await start({
      hostname: "127.0.0.1", port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname === "/health") return Response.json({ ok: true });
        incoming = request;
        ready.resolve();
        if (scenario === "late response") {
          await new Promise<void>(resolve => request.signal.addEventListener("abort", () => resolve(), { once: true }));
        }
        let reads = 0;
        body = new ReadableStream<Uint8Array>({
          start(controller) { producer = controller; },
          pull(controller) {
            if (scenario === "read error before chunk" || (scenario === "read error after chunk" && reads > 0)) {
              controller.error(primary); return;
            }
            if (reads++ === 0) controller.enqueue(new TextEncoder().encode("first"));
            if (scenario === "normal completion") controller.close();
          },
          cancel() {
            cancelCalls++; cancelled.resolve();
            if (scenario === "cancel rejection") throw cleanupFailure;
          },
        });
        return new Response(body, { headers: { "X-Fixture": "kept" } });
      },
    });
    const pending = fetch(`http://127.0.0.1:${server.port}/stream`, { signal: controller.signal });
    const outcome = pending.catch(() => undefined);
    await ready.promise;
    if (scenario === "late response") {
      controller.abort(); await outcome;
      assert.equal(await observed(() => cancelCalls === 1), true, "body returned after disconnect must be cancelled");
    } else {
      const response = await outcome;
      assert.ok(response);
      assert.equal(response.headers.get("x-fixture"), "kept");
      if (scenario.startsWith("read error")) {
        await response.text().catch(() => undefined);
        assert.equal(await observed(() => errors.some(args => args.includes(primary))), true, "cleanup must preserve the primary body-read error");
        assert.equal(errors.some(args => args.includes(cleanupFailure)), false);
      } else {
        reader = response.body!.getReader();
        assert.equal(new TextDecoder().decode((await reader.read()).value), "first");
        if (scenario === "normal completion") {
          assert.equal((await reader.read()).done, true);
          assert.equal(cancelCalls, 0);
          assert.equal(incoming?.signal.aborted, false);
        } else {
          controller.abort(); await reader.read().catch(() => undefined);
          assert.equal(await observed(() => cancelCalls === 1), true, "idle reader must be cancelled on downstream disconnect");
          await cancelled.promise;
          assert.equal(errors.length, 0, "cancel rejection must not become an unhandled error");
        }
      }
    }
    assert.equal(await observed(() => body?.locked === false), true, "response reader must release its lock");
    const health = await fetch(`http://127.0.0.1:${server.port}/health`);
    assert.deepEqual(await health.json(), { ok: true });
  } finally {
    try {
      controller.abort();
      await reader?.cancel().catch(() => undefined); reader?.releaseLock();
      // Release the unchanged adapter's pending read in intentional RED runs.
      if (body?.locked) { try { producer?.close(); } catch { /* already errored/closed */ } }
      await server?.stop();
    } finally {
      console.error = originalError;
    }
  }
}

export const adapterLoggerIsolationCases = ["startup rejection", "stop rejection"] as const;

export async function verifyAdapterLoggerIsolation(start: typeof serve, scenario: typeof adapterLoggerIsolationCases[number]) {
  const originalError = console.error;
  let failure: unknown = new Error("synthetic stop failure after real listener close");
  let ownedServer: Awaited<ReturnType<typeof start>> | undefined;
  let stopped = false;
  try {
    await assert.rejects(() => verifyAdapterCancellation(async options => {
      if (scenario === "startup rejection") {
        try {
          ownedServer = await start({ ...options, port: -1 });
        } catch (error) {
          failure = error;
          throw error;
        }
        throw new Error("invalid port unexpectedly started a listener");
      }
      ownedServer = await start(options);
      const server = ownedServer;
      return {
        ...server,
        async stop() {
          await server.stop();
          stopped = true;
          throw failure;
        },
      };
    }, "normal completion"), error => error === failure);
    if (scenario === "stop rejection") {
      assert.equal(stopped, true, "real listener must stop before the synthetic cleanup rejection");
      assert.ok(ownedServer);
      const replacement = await start({ hostname: "127.0.0.1", port: ownedServer.port, fetch: () => Response.json({ ok: true }) });
      try {
        assert.equal(replacement.port, ownedServer.port, "the stopped listener's port must be reusable");
      } finally {
        await replacement.stop();
      }
    }
    assert.equal(console.error, originalError, "fixture must restore the original global logger after setup or cleanup rejects");
  } finally {
    // A RED must not capture subsequent diagnostics for the rest of the suite.
    console.error = originalError;
    await ownedServer?.stop();
  }
}
