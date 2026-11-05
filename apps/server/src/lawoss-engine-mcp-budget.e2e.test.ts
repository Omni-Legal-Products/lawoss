// LAWOSS: rozpočet RAM 2 GB (issue #367). Engine spustí všetky MCP v každej
// inštancii (adresári), v ktorej sa dotkne MCP stavu. Server ich smie dotknúť
// len v otvorenom klientovi a drží najviac LAWOSS_ENGINE_MCP_INSTANCES takých.
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { startServer, syncAllWorkspacesRuntimeMcpToEngine } from "./server.js";
import { writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

type EngineRequest = { method: string; pathname: string; directory: string | null; name?: string };

const saved = { budget: process.env.LAWOSS_ENGINE_MCP_INSTANCES, db: process.env.LEGALWORK_RUNTIME_DB, retry: process.env.LEGALWORK_MCP_SYNC_RETRY_DELAY_MS };
const cleanup: Array<() => unknown> = [];
beforeAll(() => {
  process.env.LAWOSS_ENGINE_MCP_INSTANCES = "1";
  process.env.LEGALWORK_MCP_SYNC_RETRY_DELAY_MS = "10";
});
afterEach(async () => { while (cleanup.length) await cleanup.pop()?.(); });
afterAll(() => {
  for (const [key, value] of [["LAWOSS_ENGINE_MCP_INSTANCES", saved.budget], ["LEGALWORK_RUNTIME_DB", saved.db], ["LEGALWORK_MCP_SYNC_RETRY_DELAY_MS", saved.retry]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const REMOTE_MCP = { type: "remote", url: "https://mcp.example.invalid/mcp", enabled: true };

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-engine-mcp-budget-")));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const paths = ["a", "b", "c"].map((name) => join(root, name));
  await Promise.all(paths.map((path) => mkdir(path)));
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const requests: EngineRequest[] = [];
  const busy = new Set<string>();
  const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    const header = request.headers.get("x-opencode-directory");
    const directory = url.searchParams.get("directory") ?? (header ? decodeURIComponent(header) : null);
    const body = request.method === "POST" ? await request.json().catch(() => null) as { name?: string } | null : null;
    requests.push({ method: request.method, pathname: url.pathname, directory, name: body?.name });
    if (url.pathname === "/session/status") return Response.json(directory && busy.has(directory) ? { ses_1: { type: "busy" } } : {});
    if (url.pathname === "/session" || url.pathname === "/command") return Response.json([]);
    return Response.json({});
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
  await writeRuntimeOpencodeConfig(config, "ws_a", (current) => ({ ...current, mcp: { klientA: REMOTE_MCP } }));
  const server = await startServer(config);
  cleanup.push(() => server.stop());
  const base = `http://127.0.0.1:${server.port}`;
  const get = async (path: string) => {
    const response = await fetch(`${base}${path}`, { headers: { Authorization: "Bearer client" } });
    await response.arrayBuffer();
    return response.status;
  };
  const mcpTouches = (directory: string) => requests.filter((entry) => entry.directory === directory && (entry.pathname.startsWith("/mcp") || entry.pathname === "/command"));
  const disposals = () => requests.filter((entry) => entry.pathname === "/instance/dispose").map((entry) => entry.directory);
  const post = async (path: string) => {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: { Authorization: "Bearer client" } });
    await response.arrayBuffer();
    return response.status;
  };
  return { config, paths, requests, busy, get, post, mcpTouches, disposals };
}

test("výpis chatov všetkých klientov ani štart nespustia v engine žiadne MCP", async () => {
  const f = await fixture();
  await syncAllWorkspacesRuntimeMcpToEngine(f.config);
  for (const id of ["ws_a", "ws_b", "ws_c"]) expect(await f.get(`/workspace/${id}/sessions`)).toBe(200);
  for (const path of f.paths) {
    expect(f.mcpTouches(path)).toEqual([]);
    // Inštancia sa postaví (studený štart), ale cez GET /path, ktoré MCP nespúšťa.
    expect(f.requests.some((entry) => entry.pathname === "/path" && entry.directory === path)).toBe(true);
  }
  expect(f.disposals()).toEqual([]);
});

test("otvorený klient zaregistruje svoje MCP; ďalší otvorený uvoľní predošlého nečinného", async () => {
  const f = await fixture();
  const [a, b] = f.paths as [string, string];
  expect(await f.get("/workspace/ws_a/opencode/command")).toBe(200);
  // Vlastné MCP klienta A sa zaregistruje pred príkazom, zdieľané nie.
  expect(f.requests.filter((entry) => entry.method === "POST" && entry.pathname === "/mcp").map((entry) => [entry.name, entry.directory])).toEqual([["klientA", a]]);
  expect(f.mcpTouches(b)).toEqual([]);
  expect(await f.get("/workspace/ws_b/opencode/command")).toBe(200);
  expect(f.disposals()).toEqual([a]);
  // Opätovné otvorenie A ho postaví znova a uvoľní B.
  expect(await f.get("/workspace/ws_a/opencode/mcp")).toBe(200);
  expect(f.disposals()).toEqual([a, b]);
  expect(f.requests.filter((entry) => entry.method === "POST" && entry.pathname === "/mcp" && entry.name === "klientA")).toHaveLength(2);
});

test("klient s bežiacim chatom sa neuvoľní; po dobehnutí ho uvoľní ďalšie otvorenie", async () => {
  const f = await fixture();
  const [a, b, c] = f.paths as [string, string, string];
  expect(await f.get("/workspace/ws_a/opencode/command")).toBe(200);
  f.busy.add(a);
  expect(await f.get("/workspace/ws_b/opencode/command")).toBe(200);
  expect(f.disposals()).toEqual([]);
  f.busy.delete(a);
  expect(await f.get("/workspace/ws_c/opencode/command")).toBe(200);
  // A je najdlhšie nepoužitý a už nečinný; B ostal ako druhý nad limitom a uvoľní sa tiež.
  expect(f.disposals()).toEqual([a, b]);
  expect(f.mcpTouches(c).length).toBeGreaterThan(0);
});

test("hromadná synchronizácia po zmene konfigurácie neotvorených klientov nezobudí", async () => {
  const f = await fixture();
  const [a, b] = f.paths as [string, string];
  expect(await f.get("/workspace/ws_b/opencode/mcp")).toBe(200);
  const before = f.requests.length;
  await syncAllWorkspacesRuntimeMcpToEngine(f.config);
  await delay(20);
  const after = f.requests.slice(before);
  expect(after.filter((entry) => entry.directory === a)).toEqual([]);
  expect(f.mcpTouches(b).length).toBeGreaterThan(0);
});

test("explicitný reload klienta (nastavenia, poskytovateľ) ho otvorí s pripravenosťou a obnovou MCP", async () => {
  const f = await fixture();
  const [a] = f.paths as [string];
  expect(await f.get("/workspace/ws_b/opencode/command")).toBe(200);
  expect(await f.post("/workspace/ws_a/engine/reload")).toBe(200);
  // Reload A čaká na pripravenosť (GET /mcp) a znovu zaregistruje jeho MCP; B sa uvoľní.
  expect(f.requests.some((entry) => entry.method === "GET" && entry.pathname === "/mcp" && entry.directory === a)).toBe(true);
  expect(f.requests.some((entry) => entry.method === "POST" && entry.pathname === "/mcp" && entry.name === "klientA" && entry.directory === a)).toBe(true);
  expect(f.disposals()).toContain(f.paths[1]);
});
