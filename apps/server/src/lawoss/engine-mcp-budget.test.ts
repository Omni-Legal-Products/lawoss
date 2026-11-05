import { expect, test } from "bun:test";
import { createEngineMcpBudget, engineMcpBudgetSettings, initializesEngineMcp, type EngineScope } from "./engine-mcp-budget.js";

const scope = (directory: string): EngineScope => ({ baseUrl: "http://127.0.0.1:1", authHeader: null, directory });

function fixture(options: { limit?: number; idleMs?: number; busy?: Set<string> } = {}) {
  let clock = 1_000;
  const disposed: string[] = [];
  const initialized: string[] = [];
  const busy = options.busy ?? new Set<string>();
  const budget = createEngineMcpBudget({
    limit: options.limit ?? 1,
    idleMs: options.idleMs ?? 60_000,
    busy: async (s) => busy.has(s.directory),
    dispose: async (s) => { disposed.push(s.directory); },
    initialize: async (s) => { initialized.push(s.directory); },
    now: () => clock,
  });
  return { budget, disposed, initialized, busy, advance: (ms: number) => { clock += ms; } };
}

test("engine cesty, ktoré spúšťajú MCP, sa rozpoznajú; čítanie zoznamu chatov nie", () => {
  expect(initializesEngineMcp("GET", "/mcp")).toBe(true);
  expect(initializesEngineMcp("POST", "/mcp/orsr/connect")).toBe(true);
  expect(initializesEngineMcp("GET", "/command")).toBe(true);
  expect(initializesEngineMcp("POST", "/session/ses_1/prompt_async")).toBe(true);
  expect(initializesEngineMcp("POST", "/api/session/ses_1/prompt")).toBe(true);
  expect(initializesEngineMcp("GET", "/experimental/tool/ids")).toBe(true);
  expect(initializesEngineMcp("GET", "/session")).toBe(false);
  expect(initializesEngineMcp("GET", "/session/status")).toBe(false);
  expect(initializesEngineMcp("GET", "/session/ses_1/message")).toBe(false);
  expect(initializesEngineMcp("GET", "/path")).toBe(false);
  expect(initializesEngineMcp("GET", "/event")).toBe(false);
});

test("druhý otvorený klient uvoľní najdlhšie nepoužitého nečinného", async () => {
  const { budget, disposed, initialized, advance } = fixture({ limit: 1 });
  (await budget.admit(scope("/a")))();
  advance(10);
  (await budget.admit(scope("/b")))();
  expect(initialized).toEqual(["/a", "/b"]);
  expect(disposed).toEqual(["/a"]);
  expect(budget.activeDirectories()).toEqual(["/b"]);
  expect(budget.isActive(scope("/a"))).toBe(false);
  // Opätovné použitie aktívneho nič neinicializuje znova.
  (await budget.admit(scope("/b")))();
  expect(initialized).toEqual(["/a", "/b"]);
});

test("rozpracovaný chat ani prebiehajúca požiadavka sa neuvoľnia", async () => {
  const { budget, disposed, busy } = fixture({ limit: 1 });
  const releaseA = await budget.admit(scope("/a"));
  (await budget.admit(scope("/b")))();
  expect(disposed).toEqual([]);
  releaseA();
  busy.add("/a");
  (await budget.admit(scope("/c")))();
  // /a beží, /b je nečinný a najstarší z nečinných.
  expect(disposed).toEqual(["/b"]);
  expect(budget.activeDirectories().sort()).toEqual(["/a", "/c"]);
  busy.delete("/a");
  await budget.sweep();
  expect(disposed).toEqual(["/b", "/a"]);
  expect(budget.activeDirectories()).toEqual(["/c"]);
});

test("nečinnosť nad idleMs uvoľní inštanciu, použitie ju predĺži", async () => {
  const { budget, disposed, advance } = fixture({ limit: 2, idleMs: 1_000 });
  (await budget.admit(scope("/a")))();
  (await budget.admit(scope("/b")))();
  advance(800);
  budget.touch(scope("/b"));
  advance(300);
  await budget.sweep();
  expect(disposed).toEqual(["/a"]);
  expect(budget.activeDirectories()).toEqual(["/b"]);
});

test("súbežné prvé dotyky toho istého adresára inicializujú raz", async () => {
  const { budget, initialized } = fixture({ limit: 1 });
  const releases = await Promise.all([budget.admit(scope("/a")), budget.admit(scope("/a")), budget.admit(scope("/a"))]);
  releases.forEach((release) => release());
  expect(initialized).toEqual(["/a"]);
});

test("limit 0 zachová pôvodné správanie: všetko je aktívne, nič sa neuvoľní", async () => {
  const { budget, disposed } = fixture({ limit: 0 });
  for (const directory of ["/a", "/b", "/c"]) (await budget.admit(scope(directory)))();
  await budget.sweep();
  expect(disposed).toEqual([]);
  expect(budget.isActive(scope("/never"))).toBe(true);
});

test("nastavenia z prostredia", () => {
  expect(engineMcpBudgetSettings({})).toEqual({ limit: 1, idleMs: 600_000 });
  expect(engineMcpBudgetSettings({ LAWOSS_ENGINE_MCP_INSTANCES: "0", LAWOSS_ENGINE_MCP_IDLE_MS: "5000" })).toEqual({ limit: 0, idleMs: 5_000 });
  expect(engineMcpBudgetSettings({ LAWOSS_ENGINE_MCP_INSTANCES: "-2" })).toEqual({ limit: 1, idleMs: 600_000 });
});
