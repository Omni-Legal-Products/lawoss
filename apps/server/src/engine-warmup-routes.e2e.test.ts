import { expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startServer } from "./server.js";

for (const scenario of ["cold", "warm-body", "cancelled"]) test(scenario === "warm-body"
  ? "ready SDK metadata is not blocked by another directory's slow response body"
  : scenario === "cancelled" ? "cancelled SDK metadata never dispatches after its queued readiness completes"
  : "SDK session reads wait for the shared cold instance bootstrap before initializing another directory", async () => {
  const warmBody = scenario === "warm-body";
  const root = await realpath(await mkdtemp(join(tmpdir(), "engine-warmup-routes-")));
  const first = join(root, "first"), second = join(root, "second");
  await Promise.all([mkdir(first), mkdir(second)]);
  let release!: () => void, arrived!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { arrived = resolve; });
  let booting = false;
  const overlaps: string[] = [], authentication: string[] = [], sessions: string[] = [];
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    authentication.push(request.headers.get("authorization") ?? "");
    if (url.pathname === "/mcp") {
      if (!warmBody) { booting = true; arrived(); await held; booting = false; }
      return Response.json({});
    }
    if (url.pathname === "/session") {
      sessions.push(request.headers.get("x-opencode-directory") ?? "");
      if (booting) overlaps.push(request.headers.get("x-opencode-directory") ?? "");
      if (warmBody && request.headers.get("x-opencode-directory") === first) {
        arrived();
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(new TextEncoder().encode("["));
          void held.then(() => { controller.enqueue(new TextEncoder().encode("]")); controller.close(); });
        } }), { headers: { "content-type": "application/json" } });
      }
      return Response.json([]);
    }
    return new Response(null, { status: 404 });
  } });
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const pending: Promise<Response | null>[] = [];
  const controller = new AbortController();
  try {
    server = await startServer({
      host: "127.0.0.1", port: 0, token: "client", hostToken: "host", configPath: join(root, "server.json"),
      approval: { mode: "auto", timeoutMs: 1_000 }, corsOrigins: [],
      workspaces: [first, second].map((path, index) => ({ id: `w${index}`, name: `Matter ${index}`, path,
        preset: "starter", workspaceType: "local", baseUrl: upstream.url.origin,
        opencodeUsername: "fixture", opencodePassword: "secret" })),
      authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli",
      logFormat: "pretty", logRequests: false,
    });
    const base = `http://127.0.0.1:${server.port}`;
    pending.push(fetch(`${base}/workspace/w0/${warmBody ? "sessions" : "opencode/mcp"}`, { headers: { authorization: "Bearer client" } }));
    await entered;
    const secondRequest = fetch(`${base}/workspace/w1/sessions`, { headers: { authorization: "Bearer client" }, signal: controller.signal });
    pending.push(scenario === "cancelled" ? secondRequest.catch(error => {
      expect(error).toMatchObject({ name: "AbortError" }); return null;
    }) : secondRequest);
    if (warmBody) expect(await Promise.race([pending[1]!.then(() => true), delay(1_000).then(() => false)])).toBe(true);
    else await delay(100);
    if (scenario === "cancelled") { controller.abort(); await pending[1]; await delay(25); }
    release();
    const responses = await Promise.all(pending);
    expect(responses.map(response => response?.status ?? null)).toEqual([200, scenario === "cancelled" ? null : 200]);
    expect(await responses[0]!.json()).toEqual(warmBody ? { items: [] } : {});
    if (responses[1]) expect(await responses[1].json()).toEqual({ items: [] });
    await delay(50);
    expect(sessions).toEqual(scenario === "cancelled" ? [] : warmBody ? [first, second] : [second]);
    expect(authentication.length).toBeGreaterThanOrEqual(2);
    expect(new Set(authentication)).toEqual(new Set(["Basic Zml4dHVyZTpzZWNyZXQ="]));
    expect(overlaps).toEqual([]);
  } finally {
    controller.abort();
    release();
    await Promise.allSettled(pending);
    await server?.stop();
    await upstream.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});
