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

const saved = { activateWait: process.env.LAWOSS_ACTIVATE_ENGINE_WAIT_MS, budget: process.env.LAWOSS_ENGINE_MCP_INSTANCES, db: process.env.LEGALWORK_RUNTIME_DB, retry: process.env.LEGALWORK_MCP_SYNC_RETRY_DELAY_MS };
const cleanup: Array<() => unknown> = [];
beforeAll(() => {
  process.env.LAWOSS_ENGINE_MCP_INSTANCES = "1";
  process.env.LEGALWORK_MCP_SYNC_RETRY_DELAY_MS = "10";
  process.env.LAWOSS_ACTIVATE_ENGINE_WAIT_MS = "50";
});
afterEach(async () => { while (cleanup.length) await cleanup.pop()?.(); });
afterAll(() => {
  for (const [key, value] of [["LAWOSS_ACTIVATE_ENGINE_WAIT_MS", saved.activateWait], ["LAWOSS_ENGINE_MCP_INSTANCES", saved.budget], ["LEGALWORK_RUNTIME_DB", saved.db], ["LEGALWORK_MCP_SYNC_RETRY_DELAY_MS", saved.retry]] as const) {
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
  // Prípad klienta A: chat v ňom beží v tomto priečinku, hoci požiadavka prišla na koreň klienta.
  const matter = join(paths[0]!, "Spisy", "M001");
  await mkdir(matter, { recursive: true });
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const requests: EngineRequest[] = [];
  const busy = new Set<string>();
  // Poradie prichádzajúcich a dobehnutých volaní (registrácia MCP a uvoľnenie inštancie).
  const trace: string[] = [];
  const holds = { mcpPost: null as Promise<void> | null, chat: null as Promise<void> | null, dispose: null as Promise<void> | null, status: new Map<string, Promise<void>>() };
  const sessions = new Map([["ses_m", matter]]);
  const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    const header = request.headers.get("x-opencode-directory");
    const directory = url.searchParams.get("directory") ?? (header ? decodeURIComponent(header) : null);
    const body = request.method === "POST" ? await request.json().catch(() => null) as { name?: string } | null : null;
    requests.push({ method: request.method, pathname: url.pathname, directory, name: body?.name });
    if (request.method === "POST" && url.pathname === "/mcp" && holds.mcpPost) {
      trace.push("mcp:start");
      await holds.mcpPost;
      trace.push("mcp:end");
    }
    if (url.pathname === "/instance/dispose") {
      trace.push("dispose");
      await holds.dispose;
      trace.push("dispose:end");
    }
    // Inštancia, ktorá ešte štartuje, na stav neodpovie.
    if (url.pathname === "/session/status" && directory && holds.status.has(directory)) await holds.status.get(directory);
    if (url.pathname === "/command") trace.push("command");
    const session = url.pathname.match(/^\/session\/([^/]+)(\/message)?$/);
    if (session && session[1] !== "status" && sessions.has(session[1]!)) {
      const sessionDirectory = sessions.get(session[1]!)!;
      if (!session[2]) return Response.json({ id: session[1], directory: sessionDirectory, time: { created: 1, updated: 1 } });
      if (request.method === "POST") {
        busy.add(sessionDirectory);
        await holds.chat;
        busy.delete(sessionDirectory);
        return Response.json({ info: { id: "msg_a", role: "assistant", sessionID: session[1], finish: "stop", time: { completed: 1 } }, parts: [] });
      }
    }
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
  const enqueue = async (sessionId: string) => {
    const response = await fetch(`${base}/workspace/ws_a/sessions/${sessionId}/queue`, {
      method: "POST", headers: { Authorization: "Bearer client", "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "enqueue", id: crypto.randomUUID(),
        draft: { mode: "prompt", text: "ahoj", parts: [{ type: "text", text: "ahoj" }], attachments: [], editor: { mentions: {}, pasteParts: [] } },
        execution: { kind: "prompt", model: { providerID: "mock", modelID: "m" }, parts: [{ type: "text", text: "ahoj" }] },
      }),
    });
    await response.arrayBuffer();
    return response.status;
  };
  const activate = async (id: string) => {
    const response = await fetch(`${base}/workspaces/${id}/activate?persist=true`, { method: "POST", headers: { "x-legalwork-host-token": "host" } });
    await response.arrayBuffer();
    return response.status;
  };
  return { config, base, paths, matter, requests, busy, trace, holds, get, post, enqueue, activate, mcpTouches, disposals };
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

test("reload po hromadnej zmene neregistruje znova MCP, ktoré nová inštancia má zo súboru", async () => {
  // N4 (test alfa10): POST by spustil druhý proces toho istého MCP popri tom zo súboru.
  const f = await fixture();
  const [a] = f.paths as [string];
  expect(await f.get("/workspace/ws_a/opencode/command")).toBe(200);
  f.requests.length = 0;
  // Zmena nastavení prepíše súbor konfigurácie a na pozadí obnoví inštancie.
  expect((await fetch(`${f.base}/systemone/providers/neexistuje`, { method: "DELETE", headers: { Authorization: "Bearer client" } })).status).toBeLessThan(500);
  while (!f.requests.some((entry) => entry.method === "GET" && entry.pathname === "/mcp" && entry.directory === a)) await delay(5);
  await delay(100);
  expect(f.disposals()).toContain(a);
  expect(f.requests.filter((entry) => entry.method === "POST" && entry.pathname === "/mcp")).toEqual([]);
});

test("uvoľnenie inštancie počká, kým dobehne registrácia MCP v tom istom priečinku", async () => {
  // N4 (test alfa10): dispose počas POST /mcp nechá proces mimo vlastníka v engine až do jeho zastavenia.
  const f = await fixture();
  await writeRuntimeOpencodeConfig(f.config, "ws_b", (current) => ({ ...current, mcp: { klientB: REMOTE_MCP } }));
  let finish = () => {};
  f.holds.mcpPost = new Promise<void>((resolve) => { finish = resolve; });
  const first = f.post("/workspace/ws_b/engine/reload");
  while (!f.trace.includes("mcp:start")) await delay(5);
  f.trace.length = 0;
  f.trace.push("mcp:start");
  const second = f.post("/workspace/ws_b/engine/reload");
  await delay(150);
  expect(f.trace).toEqual(["mcp:start"]);
  finish();
  f.holds.mcpPost = null;
  expect(await first).toBe(200);
  expect(await second).toBe(200);
  expect(f.trace.slice(0, 3)).toEqual(["mcp:start", "mcp:end", "dispose"]);
});

const chatStarted = async (f: Awaited<ReturnType<typeof fixture>>) => {
  while (!f.requests.some((entry) => entry.method === "POST" && entry.pathname === "/session/ses_m/message")) await delay(5);
};

test("chat prípadu sa počíta do priečinka prípadu: nečinný koreň klienta sa uvoľní a dotazy na stav MCP nespustia druhú sadu", async () => {
  // N3 (test alfa10): front posiela chat cez koreň klienta, engine ho spustí v priečinku prípadu. Rozpočet videl len koreň.
  const f = await fixture();
  const [a] = f.paths as [string];
  let finish = () => {};
  f.holds.chat = new Promise<void>((resolve) => { finish = resolve; });
  expect(await f.get("/workspace/ws_a/opencode/command")).toBe(200);
  expect(await f.enqueue("ses_m")).toBe(200);
  await chatStarted(f);
  expect(f.disposals()).toEqual([a]);
  // Stav MCP z koreňa aj z prípadu počas behu: odpovie priečinok prípadu, koreň sa znova nespustí.
  f.requests.length = 0;
  expect(await f.get("/workspace/ws_a/opencode/mcp")).toBe(200);
  expect(await f.get("/workspace/ws_a/opencode/command")).toBe(200);
  expect(f.mcpTouches(a)).toEqual([]);
  expect(f.mcpTouches(f.matter)).toHaveLength(2);
  // Iný klient nepreruší bežiaci chat prípadu.
  expect(await f.get("/workspace/ws_b/opencode/command")).toBe(200);
  expect(f.disposals()).toEqual([]);
  finish();
  f.holds.chat = null;
  while (f.busy.has(f.matter)) await delay(5);
  await delay(50);
  // Po dobehnutí uvoľní prípad ďalšie otvorenie iného klienta.
  expect(await f.get("/workspace/ws_c/opencode/command")).toBe(200);
  expect(f.disposals()).toContain(f.matter);
});

test("po dobehnutí chatu prípadu ostane spustený len jeden priečinok klienta", async () => {
  const f = await fixture();
  const [a] = f.paths as [string];
  expect(await f.get("/workspace/ws_a/opencode/command")).toBe(200);
  expect(await f.enqueue("ses_m")).toBe(200);
  await chatStarted(f);
  while (f.busy.has(f.matter)) await delay(5);
  await delay(50);
  f.requests.length = 0;
  expect(await f.get("/workspace/ws_a/opencode/mcp")).toBe(200);
  expect(f.mcpTouches(a)).toEqual([]);
  expect(f.mcpTouches(f.matter)).toHaveLength(1);
  expect(f.disposals()).toEqual([]);
});

test("čítanie stavu MCP prípadu pri otvorenom koreni klienta nespustí priečinok prípadu; neznámy chat ostane v koreni", async () => {
  const f = await fixture();
  const [a] = f.paths as [string];
  expect(await f.get("/workspace/ws_a/opencode/command")).toBe(200);
  f.requests.length = 0;
  expect(await f.get(`/workspace/ws_a/opencode/mcp?directory=${encodeURIComponent(f.matter)}`)).toBe(200);
  expect(f.mcpTouches(f.matter)).toEqual([]);
  expect(f.mcpTouches(a)).toHaveLength(1);
  expect(f.disposals()).toEqual([]);
  // Engine chat nepozná (napr. neodpovedá): koreň sa nezatvorí pre neistý priečinok.
  expect(await f.post("/workspace/ws_a/opencode/session/ses_neznamy/message")).toBeLessThan(600);
  expect(f.disposals()).toEqual([]);
});

const settled = async (work: Promise<number>, ms: number) => Promise.race([work, delay(ms).then(() => "stále čaká")]);

test("aktivácia nečaká na pomalý engine a ďalší dotyk MCP počká, kým engine inštanciu uvoľní", async () => {
  // N1 (test alfa10): na čistom profile engine pred uvoľnením najprv postaví inštanciu, activate trvalo 43,6 s pri limite okna 10 s.
  const f = await fixture();
  let finish = () => {};
  f.holds.dispose = new Promise<void>((resolve) => { finish = resolve; });
  expect(await settled(f.activate("ws_a"), 1_000)).toBe(200);
  while (!f.trace.includes("dispose")) await delay(5);
  const opening = f.get("/workspace/ws_a/opencode/command");
  await delay(100);
  expect(f.trace).not.toContain("command");
  finish();
  f.holds.dispose = null;
  expect(await opening).toBe(200);
  expect(f.trace.filter((step) => step !== "mcp:start" && step !== "mcp:end")).toEqual(["dispose", "dispose:end", "command"]);
});

test("aktivácia nespustí MCP a jeho vlastné MCP sa zaregistrujú až pri prvom použití", async () => {
  const f = await fixture();
  const [a] = f.paths as [string];
  expect(await f.activate("ws_a")).toBe(200);
  while (!f.disposals().includes(a)) await delay(5);
  await delay(50);
  expect(f.mcpTouches(a)).toEqual([]);
  expect(await f.get("/workspace/ws_a/opencode/mcp")).toBe(200);
  expect(f.requests.filter((entry) => entry.method === "POST" && entry.pathname === "/mcp").map((entry) => entry.name)).toEqual(["klientA"]);
  // Opätovná aktivácia otvoreného klienta ho uvoľní a prvé použitie ho znova zaregistruje.
  expect(await f.activate("ws_a")).toBe(200);
  while (f.disposals().length < 2) await delay(5);
  expect(await f.get("/workspace/ws_a/opencode/mcp")).toBe(200);
  expect(f.requests.filter((entry) => entry.method === "POST" && entry.pathname === "/mcp")).toHaveLength(2);
});

test("aktivácia nepreruší bežiaci chat klienta", async () => {
  const f = await fixture();
  const [a] = f.paths as [string];
  f.busy.add(a);
  expect(await f.activate("ws_a")).toBe(200);
  await delay(120);
  expect(f.requests.some((entry) => entry.pathname === "/session/status" && entry.directory === a)).toBe(true);
  expect(f.disposals()).toEqual([]);
});

test("aktivácia iného klienta počas behu nič nezatvorí a návrat na bežiaceho klienta ho nepreruší", async () => {
  const f = await fixture();
  const [a] = f.paths as [string];
  expect(await f.get("/workspace/ws_a/opencode/command")).toBe(200);
  f.busy.add(a);
  expect(await f.activate("ws_b")).toBe(200);
  expect(await f.get("/workspace/ws_b/opencode/mcp")).toBe(200);
  expect(await f.activate("ws_a")).toBe(200);
  await delay(120);
  expect(f.disposals().filter((directory) => directory === a)).toEqual([]);
});

test("hromadná zmena neotvorených klientov neuvoľní; zastaraná inštancia sa uvoľní až pred ich otvorením (N9)", async () => {
  // N9 (retest alfa10): každý plugin balíka uvoľnil všetkých neotvorených klientov a bočný panel ich
  // hneď postavil znova – desiatky studených štartov a špička enginu 1,2–1,4 GB.
  const f = await fixture();
  const [a, b, c] = f.paths as [string, string, string];
  expect(await f.get("/workspace/ws_a/opencode/command")).toBe(200);
  f.requests.length = 0;
  expect((await fetch(`${f.base}/systemone/providers/neexistuje`, { method: "DELETE", headers: { Authorization: "Bearer client" } })).status).toBeLessThan(500);
  while (!f.disposals().includes(a)) await delay(5);
  await delay(100);
  // Otvorený klient sa obnoví, neotvorení nie: žiadny dispose ani dotaz na ich stav.
  expect(f.disposals()).toEqual([a]);
  expect(f.requests.some((entry) => entry.directory === b || entry.directory === c)).toBe(false);
  // Pri otvorení B sa najprv uvoľní jeho zastaraná inštancia, potom až prídu MCP.
  expect(await f.get("/workspace/ws_b/opencode/command")).toBe(200);
  const forB = f.requests.filter((entry) => entry.directory === b).map((entry) => `${entry.method} ${entry.pathname}`);
  expect(forB.indexOf("POST /instance/dispose")).toBeGreaterThanOrEqual(0);
  expect(forB.indexOf("POST /instance/dispose")).toBeLessThan(forB.indexOf("GET /command"));
  // Druhé otvorenie už zastarané nie je.
  const before = f.disposals().filter((directory) => directory === b).length;
  expect(await f.get("/workspace/ws_a/opencode/command")).toBe(200);
  expect(await f.get("/workspace/ws_b/opencode/command")).toBe(200);
  expect(f.disposals().filter((directory) => directory === b).length).toBe(before + 1);
});

test("zastaraná inštancia, ktorá ešte štartuje a na stav neodpovedá, otvorenie klienta nezdrží (N9)", async () => {
  const f = await fixture();
  const [a, b] = f.paths as [string, string];
  expect(await f.get("/workspace/ws_a/opencode/command")).toBe(200);
  expect((await fetch(`${f.base}/systemone/providers/neexistuje`, { method: "DELETE", headers: { Authorization: "Bearer client" } })).status).toBeLessThan(500);
  while (!f.disposals().includes(a)) await delay(5);
  let release!: () => void;
  f.holds.status.set(b, new Promise<void>((resolve) => { release = resolve; }));
  const started = Date.now();
  expect(await f.get("/workspace/ws_b/opencode/command")).toBe(200);
  release();
  // Krátka kontrola (2 s) namiesto 10 s; potom sa zastaraná inštancia uvoľní a príkaz prejde.
  expect(Date.now() - started).toBeLessThan(5_000);
  expect(f.disposals()).toContain(b);
}, 15_000);
