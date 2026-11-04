// LAWOSS (#356): MCP servery bežia len pre priečinky klientov, ktoré sa naozaj používajú.
// Engine na skúšku zaznamená každú požiadavku; MCP v engine spúšťa každá požiadavka na `/mcp…`
// (a `GET /command`, nástroje, odoslanie správy), ostatné inštanciu zostavia bez MCP.
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer, syncAllWorkspacesRuntimeMcpToEngine } from "../server.js";
import { writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { touchesEngineMcp } from "./mcp-live-workspaces.js";

process.env.LEGALWORK_MCP_SYNC_RETRY_DELAY_MS = "10";

type EngineRequest = { method: string; pathname: string; directory: string; body: unknown };

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

const REMOTE = (name: string) => ({ type: "remote", url: `https://${name}.invalid/mcp`, enabled: true });

function startEngine() {
  const requests: EngineRequest[] = [];
  const engine = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.json().catch(() => null) : null;
      const directory = url.searchParams.get("directory") ?? decodeURIComponent(request.headers.get("x-opencode-directory") ?? "");
      requests.push({ method: request.method, pathname: url.pathname, directory, body });
      if (url.pathname === "/instance/dispose") return Response.json(true);
      if (url.pathname === "/session/status") return Response.json({});
      if (url.pathname === "/session" || url.pathname === "/command") return Response.json([]);
      if (url.pathname === "/path") return Response.json({ directory });
      if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) return Response.json({});
      return Response.json({ code: "not_found" }, { status: 404 });
    },
  });
  cleanup.push(() => engine.stop(true));
  return { requests, baseUrl: `http://127.0.0.1:${engine.port}` };
}

async function setup(count: number) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-mcp-live-")));
  const previous = { db: process.env.LEGALWORK_RUNTIME_DB, xdg: process.env.XDG_CONFIG_HOME };
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  process.env.XDG_CONFIG_HOME = join(root, "config");
  cleanup.push(async () => {
    if (previous.db === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previous.db;
    if (previous.xdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous.xdg;
    await rm(root, { recursive: true, force: true });
  });
  const engine = startEngine();
  const dirs: string[] = [];
  for (let index = 0; index < count; index++) {
    const dir = join(root, `klient-${index + 1}`);
    await Bun.write(join(dir, ".keep"), "");
    dirs.push(dir);
  }
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "owt_test_token", hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"],
    workspaces: dirs.map((path, index) => ({ id: `ws_${index + 1}`, name: `Klient ${index + 1}`, path, preset: "starter", workspaceType: "local", baseUrl: engine.baseUrl })),
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const server = await startServer(config);
  cleanup.push(() => server.stop());
  const base = `http://127.0.0.1:${server.port}`;
  const call = (path: string, init?: { method?: string; body?: unknown }) => fetch(`${base}${path}`, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  return { config, dirs, engine, call };
}

const mcpTouches = (requests: EngineRequest[], directory: string) =>
  requests.filter((entry) => entry.directory === directory && touchesEngineMcp(entry.method, entry.pathname));
const posted = (requests: EngineRequest[], directory: string) =>
  requests.filter((entry) => entry.directory === directory && entry.method === "POST" && entry.pathname === "/mcp")
    .map((entry) => (entry.body as { name?: string } | null)?.name);

test("zoznam chatov, obnovy a synchronizácie nespustia MCP v neotvorenom priečinku; otvorený ich dostane", async () => {
  const { config, dirs: [a, b, c], engine, call } = await setup(3);

  // Bočný panel načíta chaty každého klienta: inštancia sa zostaví cez `/path`, nie cez `/mcp`.
  for (const id of ["ws_1", "ws_2", "ws_3"]) expect((await call(`/workspace/${id}/sessions`)).status).toBe(200);
  expect(engine.requests.some((entry) => entry.pathname === "/path" && entry.directory === b)).toBe(true);
  expect(mcpTouches(engine.requests, b)).toEqual([]);

  // Advokát otvorí klienta 1 (stav konektorov v otvorenom chate).
  expect((await call(`/workspace/ws_1/opencode/mcp?directory=${encodeURIComponent(a!)}`)).status).toBe(200);
  expect(mcpTouches(engine.requests, a!).length).toBeGreaterThan(0);

  // Zdieľaný konektor pridaný v otvorenom klientovi: do engine ide len tam.
  expect((await call("/workspace/ws_1/mcp", { method: "POST", body: { name: "posthog", config: REMOTE("posthog"), scope: "global" } })).status).toBe(200);
  expect(posted(engine.requests, a!)).toContain("posthog");

  // Koniec onboardingu: obnova enginu pre každého klienta (welcome-route → reloadAfterSkillWrites).
  engine.requests.length = 0;
  for (const id of ["ws_1", "ws_2", "ws_3"]) expect((await call(`/workspace/${id}/engine/reload`, { method: "POST" })).status).toBe(200);
  for (const dir of [a, b, c]) expect(engine.requests.some((entry) => entry.pathname === "/instance/dispose" && entry.directory === dir)).toBe(true);
  expect(posted(engine.requests, a!)).toContain("posthog");
  for (const dir of [b, c]) expect(mcpTouches(engine.requests, dir!)).toEqual([]);

  // Štart appky: runtime MCP len do živých priečinkov.
  engine.requests.length = 0;
  await syncAllWorkspacesRuntimeMcpToEngine(config);
  expect(posted(engine.requests, a!)).toContain("posthog");
  for (const dir of [b, c]) expect(mcpTouches(engine.requests, dir!)).toEqual([]);
});

test("priečinok otvorený po inštalácii z katalógu dostane nový doplnok aj vlastné konektory", async () => {
  const { config, dirs: [a, b, c], engine, call } = await setup(3);
  // Uložený konektor len pre klienta 3 (z predošlého behu appky); do súboru konfigurácie enginu nejde.
  await writeRuntimeOpencodeConfig(config, "ws_3", (current) => ({ ...current, mcp: { "len-klient-3": REMOTE("klient3") } }));
  // Klient 3 už má inštanciu zo zoznamu chatov (konfigurácia v nej je spred inštalácie).
  expect((await call("/workspace/ws_3/sessions")).status).toBe(200);

  // Otvorený klient 1, potom inštalácia doplnku pre všetkých klientov (globálny MCP).
  expect((await call(`/workspace/ws_1/opencode/mcp?directory=${encodeURIComponent(a!)}`)).status).toBe(200);
  expect((await call("/workspace/ws_1/mcp", { method: "POST", body: { name: "sk-doplnok", config: REMOTE("doplnok"), scope: "global" } })).status).toBe(200);
  expect(mcpTouches(engine.requests, c!)).toEqual([]);

  // Advokát neskôr otvorí klienta 3: pred prvou požiadavkou dostane doplnok aj svoj konektor.
  engine.requests.length = 0;
  expect((await call(`/workspace/ws_3/opencode/mcp?directory=${encodeURIComponent(c!)}`)).status).toBe(200);
  expect(posted(engine.requests, c!).sort()).toEqual(["len-klient-3", "sk-doplnok"]);
  const last = (method: string) => engine.requests.map((entry) => entry.directory === c && entry.method === method && entry.pathname === "/mcp").lastIndexOf(true);
  const lastPost = last("POST");
  const forwarded = last("GET");
  expect(lastPost).toBeLessThan(forwarded);
  // Druhá požiadavka už nič neopakuje; klient 2 ostáva bez MCP.
  engine.requests.length = 0;
  expect((await call(`/workspace/ws_3/opencode/mcp?directory=${encodeURIComponent(c!)}`)).status).toBe(200);
  expect(posted(engine.requests, c!)).toEqual([]);
  expect(mcpTouches(engine.requests, b!)).toEqual([]);
});

test("cesty enginu, ktoré spúšťajú MCP", () => {
  for (const [method, path] of [["GET", "/mcp"], ["POST", "/mcp"], ["POST", "/mcp/x/connect"], ["GET", "/command"], ["GET", "/experimental/tool/ids"],
    ["GET", "/experimental/resource"], ["POST", "/session/s1/prompt_async"], ["POST", "/session/s1/message"], ["POST", "/session/s1/command"], ["POST", "/session/s1/init"]]) {
    expect(touchesEngineMcp(method!, path!)).toBe(true);
  }
  for (const [method, path] of [["GET", "/session"], ["GET", "/session/status"], ["GET", "/path"], ["POST", "/instance/dispose"], ["GET", "/session/s1/message"], ["GET", "/agent"]]) {
    expect(touchesEngineMcp(method!, path!)).toBe(false);
  }
});
