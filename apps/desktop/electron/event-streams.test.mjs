import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import { createEventStreams } from "./event-streams.mjs";

class Owner extends EventEmitter {
  isDestroyed() { return false; }
}

test("multiple windows can stream while ordinary requests still complete; owners cannot read each other's streams", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/events") {
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.write("data: Frist geändert\n\n");
    } else response.end("ready");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  const base = `http://127.0.0.1:${address.port}`;
  const bridge = createEventStreams();
  const windows = Array.from({ length: 8 }, () => new Owner());
  try {
    for (const owner of windows) {
      const metadata = await bridge.open(owner, "same-id", `${base}/events`, {});
      assert.equal(metadata.status, 200);
      assert.equal(new TextDecoder().decode(await bridge.read(owner, "same-id")), "data: Frist geändert\n\n");
    }
    assert.equal(await (await fetch(base, { signal: AbortSignal.timeout(2000) })).text(), "ready");
    await assert.rejects(bridge.read(new Owner(), "same-id"), /another window/);
    const pending = bridge.read(windows[0], "same-id");
    bridge.cancel(windows[0], "same-id");
    assert.equal(await pending, null);
    await assert.rejects(bridge.read(windows[0], "same-id"), /closed/);
  } finally {
    for (const owner of windows) owner.emit("destroyed");
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve()));
  }
});

test("closing a window aborts a connection still waiting for headers", async () => {
  const owner = new Owner();
  const bridge = createEventStreams((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const opening = bridge.open(owner, "pending", "http://localhost/events", {});
  owner.emit("destroyed");
  assert.equal(await opening, null);
  await assert.rejects(bridge.read(owner, "pending"), /closed/);
});

test("completed streams are released and unsupported protocols are rejected", async () => {
  const owner = new Owner();
  const bridge = createEventStreams(async () => new Response("done"));
  await assert.rejects(bridge.open(owner, "bad", "file:///etc/passwd", {}), /HTTP URL/);
  await bridge.open(owner, "complete", "http://localhost/events", {});
  assert.equal(new TextDecoder().decode(await bridge.read(owner, "complete")), "done");
  assert.equal(await bridge.read(owner, "complete"), null);
  await assert.rejects(bridge.read(owner, "complete"), /closed/);
});

test("a stream the window cancels while it opens resolves without an IPC error (#506)", async () => {
  const owner = new Owner();
  const bridge = createEventStreams((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const opening = bridge.open(owner, "cancelled", "http://localhost/events", {});
  bridge.cancel(owner, "cancelled");
  assert.equal(await opening, null);
  await assert.rejects(bridge.read(owner, "cancelled"), /closed/);
});

test("a failed open that nobody cancelled still rejects (#506)", async () => {
  const owner = new Owner();
  const bridge = createEventStreams(async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(bridge.open(owner, "down", "http://localhost/events", {}), /fetch failed/);
});

// LAWOSS #561: the app quits by stopping its embedded server, which closes the sockets of
// streams a window still holds (/sync/events). Main ends them first; mid-run closes still reject.
async function streamingServer() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    response.write("data: {}\n\n");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  let closing;
  const stop = () => closing ??= (server.closeAllConnections(), new Promise((resolve) => server.close(() => resolve())));
  return { url: `http://127.0.0.1:${address.port}/sync/events`, stop };
}

test("app quit ends open streams before the server closes their sockets, and later opens and reads (#561)", async () => {
  const { url, stop } = await streamingServer();
  const bridge = createEventStreams();
  const owner = new Owner();
  try {
    await bridge.open(owner, "sync", url, {});
    await bridge.read(owner, "sync");
    const pending = bridge.read(owner, "sync");
    bridge.closeAll();
    await stop();
    assert.equal(await pending, null);
    assert.equal(await bridge.read(owner, "sync"), null);
    assert.equal(await bridge.open(owner, "again", url, {}), null);
  } finally {
    owner.emit("destroyed");
    await stop();
  }
});

test("a server that closes a stream while the app runs still rejects the read (#561)", async () => {
  const { url, stop } = await streamingServer();
  const bridge = createEventStreams();
  const owner = new Owner();
  try {
    await bridge.open(owner, "sync", url, {});
    await bridge.read(owner, "sync");
    const pending = bridge.read(owner, "sync");
    await stop();
    await assert.rejects(pending, /terminated/);
  } finally {
    owner.emit("destroyed");
    await stop();
  }
});

test("main ends window streams and requests when quit begins, before the embedded server stops (#561)", () => {
  const source = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  const quit = source.slice(source.indexOf('app.on("before-quit"'), source.indexOf('app.on("second-instance"'));
  const shutdown = quit.indexOf("boundedShutdown(");
  assert.ok(shutdown > 0);
  for (const call of ["eventStreams.closeAll()", "httpRequests.closeAll()"]) {
    const at = quit.indexOf(call);
    assert.ok(at > 0 && at < shutdown, `${call} runs before the runtime stops`);
  }
});
