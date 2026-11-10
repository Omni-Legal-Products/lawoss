import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { removeTestDir } from "./test-support/remove-test-dir.js";

/**
 * Zoznam chatov klienta (`GET /workspace/:id/sessions`) posiela signál zrušenia volajúceho do enginu
 * (pôvodne `5641d3043`, pri zlúčení v0.3.0 stratené): appka, ktorá odíde, nenechá v engine visieť
 * čítanie zoznamu. Falošný engine v2 drží `GET /api/session` a zaznamená zrušenie svojej požiadavky.
 */
const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

test("an app that leaves the chat list cancels the engine's session list read too", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-session-list-cancel-")));
  cleanups.push(() => removeTestDir(root));
  const client = join(root, "Klient"); await mkdir(client);
  let entered = () => {}, cancelled = () => {};
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const aborted = new Promise<void>(resolve => { cancelled = resolve; });
  const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/api/session" && request.method === "GET") {
      request.signal.addEventListener("abort", () => cancelled(), { once: true });
      entered();
      // Held until the caller leaves; the engine then sees its own request cancelled.
      return new Promise<Response>(resolve => request.signal.addEventListener("abort", () => resolve(new Response(null, { status: 499 })), { once: true }));
    }
    if (path === "/api/info") return Response.json({ version: "2.1.4", pid: process.pid });
    if (path === "/api/session/active") return Response.json({ data: {} });
    if (path === "/api/event") return new Response(new ReadableStream({ start() {} }), { headers: { "content-type": "text/event-stream" } });
    return Response.json({ data: [] });
  } });
  cleanups.push(() => engine.stop(true));
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(root, "server.json"), token: "client", hostToken: "host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [{ id: "klient", name: "Klient", preset: "starter", path: client, workspaceType: "local", baseUrl: engine.url.origin }],
    authorizedRoots: [client], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const previous = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE };
  process.env.LEGALWORK_DATA_DIR = join(root, "data"); process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json");
  cleanups.push(() => { for (const [key, value] of Object.entries({ LEGALWORK_DATA_DIR: previous.data, LEGALWORK_TOKEN_STORE: previous.tokens })) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const server = await startServer(config);
  cleanups.push(() => server.stop());
  const leave = new AbortController();
  const listing = fetch(`http://127.0.0.1:${server.port}/workspace/klient/sessions`, { headers: { authorization: "Bearer client" }, signal: leave.signal }).catch(error => error);
  await reading;
  leave.abort();
  expect(await Promise.race([aborted.then(() => "cancelled"), Bun.sleep(5000).then(() => "still reading")])).toBe("cancelled");
  expect(await listing).toBeInstanceOf(Error);
});
