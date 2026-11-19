import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApiError } from "../errors.js";
import { rawHttpRequest, type RawHttpNetwork } from "../agent-sandbox/raw-http.js";
import { writeSandboxDefault } from "../agent-sandbox/settings.js";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";

const cleanups: Array<() => unknown> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

async function closedPort() {
  const server = createNetServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

async function failure(promise: Promise<unknown>) {
  try { await promise; } catch (error) { return error; }
  throw new Error("The request unexpectedly succeeded.");
}

const allow = async () => true;
const get = (url: string) => ({ url, method: "GET", headers: {} });

test("#565 sandbox/http: zatvorený port vráti 502 sandbox_http_unreachable bez neošetrenej chyby v logu", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-565-"));
  cleanups.push(() => rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const directory = join(root, "matter"); await mkdir(directory);
  const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname, location = { directory };
    if (path === "/api/model") return Response.json({ location, data: [] });
    if (path === "/api/config") return Response.json([]);
    if (path === "/api/agent") return Response.json({ location, data: [{ id: "legalwork", permissions: [] }] });
    if (path.startsWith("/api/session/")) return Response.json({ data: { id: path.split("/").pop(), location } });
    return new Response("Not found", { status: 404 });
  } });
  cleanups.push(() => engine.stop(true));
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "client", hostToken: "host", configPath: join(root, "private", "server.json"),
    approval: { mode: "auto", timeoutMs: 5000 }, corsOrigins: [], workspaces: [{ id: "matter", name: "Matter", path: directory, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [directory], opencodeBaseUrl: engine.url.origin, readOnly: false, agentSandboxEnabled: true, startedAt: Date.now(),
    tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false };
  await writeSandboxDefault(config, { enabled: false, networkMode: "allow" });
  const server = await startServer(config);
  cleanups.push(() => server.stop());
  const logged = spyOn(console, "error");
  cleanups.push(() => logged.mockRestore());

  const port = await closedPort();
  const response = await fetch(`http://127.0.0.1:${server.port}/workspace/matter/sandbox/http`, {
    method: "POST", headers: { authorization: "Bearer client", "content-type": "application/json" },
    body: JSON.stringify({ sessionID: "chat", agent: "legalwork", ...get(`http://127.0.0.1:${port}/`) }),
  });
  const body = await response.json();
  expect({ status: response.status, code: body.code }).toEqual({ status: 502, code: "sandbox_http_unreachable" });
  expect(body.message).toContain("ECONNREFUSED");
  expect(logged.mock.calls.flat().join(" ")).not.toContain("Unhandled error");
});

test("#565 neexistujúca doména (.invalid) je nedosiahnuteľný cieľ, nie chyba servera", async () => {
  const error = await failure(rawHttpRequest(get("http://lawoss-565.invalid/"), allow, new AbortController().signal, { allowPrivate: true }));
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status: 502, code: "sandbox_http_unreachable" });
});

test.skipIf(process.platform === "win32")("#565 neplatný TLS certifikát cieľa je nedosiahnuteľný cieľ so stručnou príčinou", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-565-tls-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const key = join(root, "key.pem"), cert = join(root, "cert.pem");
  const generated = Bun.spawnSync(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"]);
  expect(generated.exitCode).toBe(0);
  const server = createHttpsServer({ key: await readFile(key), cert: await readFile(cert) }, (_request, response) => { response.end("must not be read"); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const { port } = server.address() as AddressInfo;
  const network: RawHttpNetwork = { resolve: async () => [{ address: "127.0.0.1", family: 4 }], send: (await import("../agent-sandbox/raw-http-hop.js")).sendPinned };
  const error = await failure(rawHttpRequest(get(`https://localhost:${port}/`), allow, new AbortController().signal, { allowPrivate: true, network }));
  expect(error).toMatchObject({ status: 502, code: "sandbox_http_unreachable" });
  expect((error as Error).message).toContain("certificate");
});

test("#565 vyčerpaný 30 s rozpočet vráti 504 sandbox_http_timeout", async () => {
  let now = 0;
  const clock = spyOn(performance, "now").mockImplementation(() => now);
  cleanups.push(() => clock.mockRestore());
  const network: RawHttpNetwork = { resolve: async () => [{ address: "192.0.2.1", family: 4 }],
    send: async () => { now += 31_000; return { status: 200, statusText: "OK", headers: {}, bodyBase64: "" }; } };
  const error = await failure(rawHttpRequest(get("https://blackhole.example/"), allow, new AbortController().signal, { allowPrivate: true, network }));
  expect(error).toMatchObject({ status: 504, code: "sandbox_http_timeout" });
});

test("#565 zamietnutie politikou, zrušenie volajúcim a neznáme chyby ostávajú bez zmeny", async () => {
  const network: RawHttpNetwork = { resolve: async () => [{ address: "93.184.216.34", family: 4 }], send: async () => { throw new Error("internal bug"); } };
  const denied = await failure(rawHttpRequest(get("https://example.com/"), async () => false, new AbortController().signal, { allowPrivate: false, network }));
  expect(denied).not.toBeInstanceOf(ApiError);
  expect((denied as Error).message).toContain("denied");
  const controller = new AbortController();
  const reason = new Error("Permissions changed. Try again with the current permissions.");
  const cancelled = rawHttpRequest(get("https://example.com/"), allow, controller.signal, { allowPrivate: false,
    network: { ...network, send: async (_request, _address, signal) => new Promise((_resolve, reject) => { signal.addEventListener("abort", () => reject(Object.assign(new Error("socket closed"), { code: "ECONNRESET" }))); queueMicrotask(() => controller.abort(reason)); }) } });
  expect(await failure(cancelled)).toBe(reason);
  expect(await failure(rawHttpRequest(get("https://example.com/"), allow, new AbortController().signal, { allowPrivate: false, network }))).toMatchObject({ message: "internal bug" });
});

test("#565 tvary chýb z aplikácie: Undici ConnectTimeoutError a AggregateError (ETIMEDOUT + EHOSTUNREACH)", async () => {
  const attempt = (code: string) => Object.assign(new Error(`connect ${code}`), { code });
  const thrown = [
    { error: Object.assign(new Error("Connect Timeout Error"), { name: "ConnectTimeoutError", code: "UND_ERR_CONNECT_TIMEOUT" }), status: 504, code: "sandbox_http_timeout" },
    { error: new AggregateError([attempt("ETIMEDOUT"), attempt("EHOSTUNREACH")]), status: 504, code: "sandbox_http_timeout" },
    { error: new AggregateError([attempt("EHOSTUNREACH"), attempt("ENETUNREACH")]), status: 502, code: "sandbox_http_unreachable" },
  ];
  for (const { error, status, code } of thrown) {
    const network: RawHttpNetwork = { resolve: async () => [{ address: "194.213.41.185", family: 4 }], send: async () => { throw error; } };
    expect(await failure(rawHttpRequest(get("https://judikatura.example/"), allow, new AbortController().signal, { allowPrivate: false, network }))).toMatchObject({ status, code });
  }
});
