// LAWOSS: rozpočet RAM 2 GB (issue #367, ADR 0017) na engine v2 (OpenCode 2.1.4).
// Lokácia enginu (priečinok) postaví pri prvej požiadavke svoje pluginy aj všetky MCP a drží ich.
// Server smie lokáciu postaviť len pre otvoreného klienta, drží najviac LAWOSS_ENGINE_MCP_INSTANCES
// takých a nečinnú uvoľní cez `DELETE /api/debug/location`. Falošný engine hovorí protokolom v2.
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

type EngineRequest = { method: string; pathname: string; location: string | null };

const saved = { budget: process.env.LAWOSS_ENGINE_MCP_INSTANCES, db: process.env.LEGALWORK_RUNTIME_DB };
const cleanup: Array<() => unknown> = [];
beforeAll(() => { process.env.LAWOSS_ENGINE_MCP_INSTANCES = "1"; });
afterEach(async () => { while (cleanup.length) await cleanup.pop()?.(); });
afterAll(() => {
  for (const [key, value] of [["LAWOSS_ENGINE_MCP_INSTANCES", saved.budget], ["LEGALWORK_RUNTIME_DB", saved.db]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** Paths of the v2 engine that never build a location (protocol/src/groups, no location middleware). */
const LOCATION_FREE = new Set(["/api/info", "/api/session/active"]);

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-engine-mcp-budget-v2-")));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const paths = ["a", "b", "c"].map((name) => join(root, name));
  await Promise.all(paths.map((path) => mkdir(path)));
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const requests: EngineRequest[] = [];
  /** Running chats: session ID → its location directory. */
  const running = new Map<string, string>();
  const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    const header = request.headers.get("x-opencode-directory");
    const location = url.searchParams.get("location[directory]") ?? (header ? decodeURIComponent(header) : null);
    requests.push({ method: request.method, pathname: url.pathname, location });
    if (url.pathname === "/api/info") return Response.json({ version: "2.1.4-legalwork.http-policy.4", pid: process.pid });
    if (url.pathname === "/api/session/active") return Response.json({ data: Object.fromEntries([...running.keys()].map(id => [id, { type: "running" }])) });
    const session = url.pathname.match(/^\/api\/session\/([^/]+)$/);
    if (session && running.has(session[1]!)) return Response.json({ id: session[1], projectID: "p", location: { directory: running.get(session[1]!) }, time: { created: 1, updated: 1 } });
    if (url.pathname === "/api/debug/location") return new Response(null, { status: 204 });
    if (url.pathname === "/api/mcp") return Response.json({ location: { directory: location }, data: [] });
    return Response.json({ data: [] });
  } });
  cleanup.push(() => engine.stop(true));
  const baseUrl = `http://127.0.0.1:${engine.port}`;
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "client", hostToken: "host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: paths.map((path, index) => ({ id: `ws_${"abc"[index]}`, name: `Klient ${index}`, path, preset: "starter", workspaceType: "local", baseUrl })),
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli",
    logFormat: "pretty", logRequests: false,
  };
  const server = await startServer(config);
  cleanup.push(() => server.stop());
  const base = `http://127.0.0.1:${server.port}`;
  const openMcp = async (workspaceId: string) => {
    const response = await fetch(`${base}/workspace/${workspaceId}/opencode/mcp`, { headers: { Authorization: "Bearer client" } });
    await response.arrayBuffer();
    return response.status;
  };
  /** Location-bound requests (each builds its location if needed) in order. */
  const locationRequests = () => requests.filter(entry => entry.location !== null && !(entry.method === "DELETE" && entry.pathname === "/api/debug/location"));
  /** Locations built, one per admission into the budget: the admission first activates the location (`GET /api/model`). */
  const locationsBuilt = () => locationRequests().filter(entry => entry.method === "GET" && entry.pathname === "/api/model").map(entry => entry.location);
  /** The first request into each location after its admission must be the activation, never the forwarded request. */
  const unactivated = () => locationRequests().filter((entry, index, all) => (index === 0 || all[index - 1]!.location !== entry.location)
    && !(entry.method === "GET" && entry.pathname === "/api/model"));
  const evictions = () => requests.filter(entry => entry.method === "DELETE" && entry.pathname === "/api/debug/location").map(entry => entry.location);
  return { paths, requests, running, openMcp, locationsBuilt, evictions, unactivated };
}

test("engine v2: MCP sa spustí len pre otvoreného klienta, ďalší otvorený klient uvoľní nečinného", async () => {
  const { paths: [a, b, c], openMcp, locationsBuilt, evictions, unactivated } = await fixture();
  expect(await openMcp("ws_a")).toBe(200);
  expect(locationsBuilt()).toEqual([a]);
  expect(evictions()).toEqual([]);
  expect(await openMcp("ws_b")).toBe(200);
  // Klient A je nečinný a nad limitom 1: jeho lokácia (pluginy a MCP procesy) sa uvoľní pred B.
  expect(evictions()).toEqual([a]);
  expect(locationsBuilt()).toEqual([a, b]);
  // Neotvorený klient C nedostal ani jednu požiadavku viazanú na lokáciu.
  expect(locationsBuilt()).not.toContain(c);
  expect(evictions()).not.toContain(c);
  expect(unactivated()).toEqual([]);
});

test("engine v2: bežiaci chat sa neuvoľní, ani keď sa otvorí iný klient", async () => {
  const { paths: [a, b, c], running, openMcp, evictions, locationsBuilt, unactivated } = await fixture();
  expect(await openMcp("ws_a")).toBe(200);
  running.set("ses_a", a!);
  expect(await openMcp("ws_b")).toBe(200);
  expect(evictions()).toEqual([]);
  running.delete("ses_a");
  // Po dobehnutí chatu ďalší otvorený klient uvoľní oba nečinné, najdlhšie neotvorený prvý.
  expect(await openMcp("ws_c")).toBe(200);
  expect(evictions()).toEqual([a, b]);
  expect(locationsBuilt()).toEqual([a, b, c]);
  expect(unactivated()).toEqual([]);
});

test("engine v2: zisťovanie behu a pripravenosť nestavajú lokáciu (náhrada v1 /path a /session/status)", async () => {
  const { paths: [a], running, requests, openMcp } = await fixture();
  expect(await openMcp("ws_a")).toBe(200);
  running.set("ses_a", a!);
  expect(await openMcp("ws_b")).toBe(200);
  // v1 trasy (/path, /instance/dispose, /session/status, /mcp bez /api) sa už nepoužijú.
  expect(requests.filter(entry => !entry.pathname.startsWith("/api/"))).toEqual([]);
  // Dotaz na bežiace chaty a ich priečinok ide mimo lokácie, takže sám nespustí MCP.
  const probes = requests.filter(entry => LOCATION_FREE.has(entry.pathname) || /^\/api\/session\/[^/]+$/.test(entry.pathname));
  expect(probes.length).toBeGreaterThan(0);
  expect(probes.every(entry => entry.location === null)).toBe(true);
});
