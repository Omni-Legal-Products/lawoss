import { expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { startServer } from "./server.js";

// LAWOSS v2: engine 2.1.4 builds a location (its plugins and every MCP) only on location-bound
// routes; `GET /api/session` is location-free (lawoss/engine-mcp-budget.ts, LOCATION_FREE). A
// session list therefore never starts a second cold bootstrap and must not wait for another
// directory's one. Engine 1.x built the instance (with npm install) on `GET /session`, which the
// former shared readiness lane before the list (engine-warmup-gate.ts) serialized.
const emptyPage = JSON.stringify({ data: [], cursor: { next: null } });

for (const scenario of ["cold", "warm-body"] as const) test(scenario === "warm-body"
  ? "ready SDK metadata is not blocked by another directory's slow response body"
  : "SDK session reads do not wait for another directory's cold location bootstrap and build no location", async () => {
  const warmBody = scenario === "warm-body";
  const root = await realpath(await mkdtemp(join(tmpdir(), "engine-warmup-routes-")));
  const first = join(root, "first"), second = join(root, "second");
  await Promise.all([mkdir(first), mkdir(second)]);
  let release!: () => void, arrived!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const entered = new Promise<void>(resolve => { arrived = resolve; });
  let observing = false;
  const authentication: string[] = [], sessions: string[] = [], afterEntered: string[] = [];
  const upstream = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    const directory = url.searchParams.get("location[directory]") ?? url.searchParams.get("directory") ?? "";
    authentication.push(request.headers.get("authorization") ?? "");
    if (observing) afterEntered.push(`${request.method} ${url.pathname} ${directory}`);
    if (url.pathname === "/api/mcp") {
      if (!warmBody) { arrived(); await held; }
      return Response.json({});
    }
    if (url.pathname === "/api/session") {
      sessions.push(directory);
      if (warmBody && directory === first) {
        arrived();
        const bytes = new TextEncoder().encode(emptyPage);
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(bytes.slice(0, 1));
          void held.then(() => { controller.enqueue(bytes.slice(1)); controller.close(); });
        } }), { headers: { "content-type": "application/json" } });
      }
      return new Response(emptyPage, { headers: { "content-type": "application/json" } });
    }
    return new Response(null, { status: 404 });
  } });
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const pending: Promise<Response>[] = [];
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
    observing = true;
    pending.push(fetch(`${base}/workspace/w1/sessions`, { headers: { authorization: "Bearer client" } }));
    // The other directory's list completes while the first request is still held.
    expect(await Promise.race([pending[1]!.then(() => true), delay(1_000).then(() => false)])).toBe(true);
    const listed = await pending[1]!;
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({ items: [] });
    // Nothing location-bound (no readiness probe, no MCP) was sent for the second directory: only its
    // scoped list and, for case chats in subfolders (session-ownership.ts), the unscoped whole list.
    expect([...new Set(afterEntered)].sort()).toEqual(["GET /api/session ", `GET /api/session ${second}`]);
    release();
    const held0 = await pending[0]!;
    expect(held0.status).toBe(200);
    expect(await held0.json()).toEqual(warmBody ? { items: [] } : {});
    expect(sessions.filter(Boolean)).toEqual(warmBody ? [first, second] : [second]);
    expect(authentication.length).toBeGreaterThanOrEqual(2);
    expect(new Set(authentication)).toEqual(new Set(["Basic Zml4dHVyZTpzZWNyZXQ="]));
  } finally {
    release();
    await Promise.allSettled(pending);
    await server?.stop();
    await upstream.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});

test.skip("cancelled SDK metadata never dispatches after its queued readiness completes", () => {
  // LAWOSS v2: pred zoznamom chatov už nie je fronta pripravenosti, na ktorú by zrušená požiadavka čakala.
  // Engine 2.1.4 zoznam chatov (`GET /api/session`) obslúži bez postavenia lokácie, studený štart
  // iného priečinka ho nezdrží (test vyššie), takže niet čo neskôr odoslať.
});
