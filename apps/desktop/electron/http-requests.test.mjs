import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createHttpRequests } from "./http-requests.mjs";

class Owner extends EventEmitter { isDestroyed() { return false; } }

test("request cancellation is isolated to its window, including body reads", async () => {
  const connections = [];
  const server = createServer((request, response) => {
    if (request.url.startsWith("/body")) { response.writeHead(200); response.write("partial"); connections.push(response); }
    else response.end("ready");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const url = `http://127.0.0.1:${address.port}`;
  const bridge = createHttpRequests(); const a = new Owner(); const b = new Owner();
  try {
    const first = bridge.fetch(a, `${url}/body`, { requestId: "same" });
    const second = bridge.fetch(b, `${url}/body`, { requestId: "same" });
    while (connections.length < 2) await new Promise(resolve => setTimeout(resolve, 1));
    // LAWOSS #506: the window settled a cancelled request itself; main resolves instead of logging an IPC error.
    bridge.cancel(a, "same"); assert.equal(await first, null);
    connections[1].end(" complete");
    assert.equal((await second).body, "partial complete");
    assert.equal((await bridge.fetch(a, url)).body, "ready");
    await assert.rejects(bridge.fetch(a, `${url}/body?token=secret`, { timeoutMs: 25 }), /timed out after 25 ms: GET \/body$/);
  } finally {
    a.emit("destroyed"); b.emit("destroyed"); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test("window destruction aborts outstanding headers and completed IDs can be reused", async () => {
  const bridge = createHttpRequests((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const owner = new Owner();
  const pending = bridge.fetch(owner, "https://example.test", { requestId: "pending" });
  owner.emit("destroyed"); assert.equal(await pending, null);
  const fast = createHttpRequests(async () => new Response("done"));
  for (let i = 0; i < 2; i++) assert.equal((await fast.fetch(owner, "https://example.test", { requestId: "reused" })).body, "done");
  await assert.rejects(fast.fetch(owner, "file:///tmp/private"), /HTTP URL/);
});

// LAWOSS #561: requests still in flight when the app quits end before the embedded server closes their sockets.
test("app quit settles in-flight and later requests without an IPC error; a mid-run socket close still rejects (#561)", async () => {
  const connections = [];
  const server = createServer((_request, response) => { response.writeHead(200); response.write("partial"); connections.push(response); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(undefined)));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const url = `http://127.0.0.1:${address.port}`;
  const owner = new Owner();
  try {
    const running = createHttpRequests();
    const cut = running.fetch(owner, url);
    while (connections.length < 1) await new Promise(resolve => setTimeout(resolve, 1));
    server.closeAllConnections();
    await assert.rejects(cut, /terminated/);

    const quitting = createHttpRequests();
    const pending = quitting.fetch(owner, url);
    while (connections.length < 2) await new Promise(resolve => setTimeout(resolve, 1));
    quitting.closeAll();
    server.closeAllConnections();
    assert.equal(await pending, null);
    assert.equal(await quitting.fetch(owner, url), null);
  } finally {
    owner.emit("destroyed"); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
