import { expect, test } from "bun:test";
import { readsEngineConfig, createEngineMcpBudget, engineMcpBudgetSettings, engineSessionAction, initializesEngineMcp, settleWithin, type EngineScope } from "./engine-mcp-budget.js";

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

test("engine v2: cesty, ktoré postavia lokáciu (pluginy a MCP), sa rozpoznajú; zoznam a čítanie chatov nie", () => {
  for (const [method, path] of [["GET", "/mcp"], ["POST", "/experimental/mcp/orsr/connect"], ["GET", "/command"], ["GET", "/model"],
    ["GET", "/agent"], ["GET", "/api/location"], ["POST", "/api/session/ses_1/prompt"], ["POST", "/session/ses_1/command"],
    ["PATCH", "/session/ses_1"], ["POST", "/session/ses_1/fork"], ["POST", "/api/rpc/legalwork.managed-settings/refresh"], ["GET", "/fs/list"]]) {
    expect([method, path, initializesEngineMcp(method, path)]).toEqual([method, path, true]);
  }
  for (const [method, path] of [["GET", "/api/info"], ["GET", "/event"], ["GET", "/session"], ["GET", "/api/session/active"],
    ["GET", "/session/ses_1"], ["GET", "/session/ses_1/message"], ["GET", "/api/session/ses_1/message/msg_1"], ["POST", "/session"],
    ["POST", "/session/ses_1/move"], ["POST", "/api/session/ses_1/interrupt"], ["DELETE", "/session/ses_1"],
    ["GET", "/api/experimental/migration/v1"], ["DELETE", "/api/debug/location"], ["GET", "/credential"]]) {
    expect([method, path, initializesEngineMcp(method, path)]).toEqual([method, path, false]);
  }
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

test("kontrola nad limitom neuvoľní práve otvoreného klienta, kým beží chat v predošlom", async () => {
  // N5 (test alfa10): A beží, B sa otvoril; kontrola po chvíli uvoľnila B, nie A, a B dostal MCP až ďalším dotazom.
  const { budget, disposed, busy, advance } = fixture({ limit: 1 });
  (await budget.admit(scope("/a")))();
  busy.add("/a");
  advance(10);
  (await budget.admit(scope("/b")))();
  await budget.sweep();
  expect(disposed).toEqual([]);
  expect(budget.activeDirectories().sort()).toEqual(["/a", "/b"]);
  busy.delete("/a");
  await budget.sweep();
  expect(disposed).toEqual(["/a"]);
  expect(budget.activeDirectories()).toEqual(["/b"]);
});

test("koniec behu v A neurobí z A práve otvoreného klienta", async () => {
  // N5 na skutočnom engine: front drží požiadavku celý beh, jej koniec posunul A pred B a kontrola uvoľnila B.
  const { budget, disposed, advance } = fixture({ limit: 1 });
  const releaseA = await budget.admit(scope("/a"));
  advance(10);
  (await budget.admit(scope("/b")))();
  advance(10);
  releaseA();
  await budget.sweep();
  expect(disposed).toEqual(["/a"]);
  expect(budget.activeDirectories()).toEqual(["/b"]);
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

test("požiadavka pluginu počas aktivácie lokality na aktiváciu nečaká (inak engine po 5 s vráti 503)", async () => {
  // Aktivácia (GET /api/model) čaká na pluginy lokality; plugin príkazov počas nej číta definície cez server.
  let finishActivation = () => {};
  const activation = new Promise<void>((resolve) => { finishActivation = resolve; });
  const initialized: string[] = [];
  const budget = createEngineMcpBudget({
    limit: 1, idleMs: 60_000, busy: async () => false, dispose: async () => {},
    initialize: async (s) => { initialized.push(s.directory); await activation; },
  });
  let opened = false;
  const first = budget.admit(scope("/a")).then((release) => { opened = true; return release; });
  // Plugin volá až počas aktivácie, teda keď už beží `initialize` lokality.
  while (!initialized.includes("/a")) await Bun.sleep(1);
  // Plugin: prepustí sa hneď, hoci aktivácia ešte beží; bežná požiadavka by tu čakala.
  const pluginRelease = await Promise.race([budget.admit(scope("/a"), { awaitReady: false }), Bun.sleep(200).then(() => null)]);
  expect(pluginRelease).not.toBeNull();
  expect(opened).toBe(false);
  pluginRelease?.();
  finishActivation();
  (await first)();
  expect(initialized).toEqual(["/a"]);
  // Prvý dotyk lokality od pluginu aktiváciu spustí, ale nečaká na ňu.
  let hold = () => {};
  const slow = createEngineMcpBudget({ limit: 1, idleMs: 60_000, busy: async () => false, dispose: async () => {},
    initialize: () => new Promise<void>((resolve) => { hold = resolve; }) });
  const direct = await Promise.race([slow.admit(scope("/b"), { awaitReady: false }), Bun.sleep(200).then(() => null)]);
  expect(direct).not.toBeNull();
  direct?.(); hold();
});

test("limit 0 zachová pôvodné správanie: všetko je aktívne, nič sa neuvoľní", async () => {
  const { budget, disposed } = fixture({ limit: 0 });
  for (const directory of ["/a", "/b", "/c"]) (await budget.admit(scope(directory)))();
  await budget.sweep();
  expect(disposed).toEqual([]);
  expect(budget.isActive(scope("/never"))).toBe(true);
});

test("explicitný reload otvorí priečinok bez inicializácie a uvoľní predošlý", async () => {
  const { budget, disposed, initialized, advance } = fixture({ limit: 1 });
  (await budget.admit(scope("/a")))();
  advance(10);
  await budget.adopt(scope("/b"));
  expect(initialized).toEqual(["/a"]);
  expect(disposed).toEqual(["/a"]);
  expect(budget.isActive(scope("/b"))).toBe(true);
  await budget.adopt(scope("/b"));
  expect(disposed).toEqual(["/a"]);
});

test("akcia chatu sa rozpozná; ostatné engine cesty nie", () => {
  expect(engineSessionAction("POST", "/session/ses_1/command")).toBe("ses_1");
  expect(engineSessionAction("post", "/api/session/ses_1/prompt")).toBe("ses_1");
  expect(engineSessionAction("GET", "/session/ses_1/message")).toBeNull();
  expect(engineSessionAction("POST", "/session")).toBeNull();
  expect(engineSessionAction("GET", "/mcp")).toBeNull();
});

test("priečinok klienta so spustenými MCP: bežiaci prípad zastúpi koreň a naopak, iný klient nie", async () => {
  const { budget, advance } = fixture({ limit: 2 });
  (await budget.admit(scope("/klienti/a/Spisy/M001")))();
  (await budget.admit(scope("/klienti/ab")))();
  expect(budget.residentWithin(scope("/klienti/a"), "/klienti/a")).toBe("/klienti/a/Spisy/M001");
  expect(budget.residentWithin(scope("/klienti/a/Spisy/M002"), "/klienti/a")).toBe("/klienti/a/Spisy/M001");
  // Sám aktívny priečinok sa nezastupuje a iný klient s podobným menom sa nepočíta.
  expect(budget.residentWithin(scope("/klienti/a/Spisy/M001"), "/klienti/a")).toBeNull();
  expect(budget.residentWithin(scope("/klienti/c"), "/klienti/c")).toBeNull();
  expect(budget.residentWithin({ ...scope("/klienti/a"), baseUrl: "http://127.0.0.1:2" }, "/klienti/a")).toBeNull();
  advance(5);
  expect(fixture({ limit: 0 }).budget.residentWithin(scope("/klienti/a"), "/klienti/a")).toBeNull();
});

test("reset uvoľní nečinný priečinok aj mimo evidencie; bežiaci chat ani prebiehajúcu požiadavku nie", async () => {
  const { budget, disposed, initialized, busy } = fixture({ limit: 1 });
  expect(await budget.reset(scope("/a"))).toBe(true);
  expect(disposed).toEqual(["/a"]);
  const release = await budget.admit(scope("/b"));
  expect(await budget.reset(scope("/b"))).toBe(false);
  release();
  busy.add("/b");
  expect(await budget.reset(scope("/b"))).toBe(false);
  busy.delete("/b");
  expect(await budget.reset(scope("/b"))).toBe(true);
  expect(budget.isActive(scope("/b"))).toBe(false);
  // Prvé použitie po resete znova zaregistruje jeho MCP.
  (await budget.admit(scope("/b")))();
  expect(initialized).toEqual(["/b", "/b"]);
});

test("zlyhané uvoľnenie cez reset ohlási chybu a priečinok ostane v evidencii", async () => {
  const failure = new Error("engine");
  const budget = createEngineMcpBudget({ limit: 1, idleMs: 0, busy: async () => false, dispose: async () => { throw failure; } });
  (await budget.admit(scope("/a")))();
  await expect(budget.reset(scope("/a"))).rejects.toBe(failure);
  expect(budget.isActive(scope("/a"))).toBe(true);
});

test("settleWithin: skorý výsledok vráti hneď, neskorá chyba ide do záznamu", async () => {
  const late: unknown[] = [];
  const failure = new Error("skoro");
  expect(await settleWithin(Promise.resolve(), 1_000, (error) => late.push(error))).toEqual({});
  expect(await settleWithin(Promise.reject(failure), 1_000, (error) => late.push(error))).toEqual({ error: failure });
  let fail: (reason: unknown) => void = () => {};
  const slow = new Promise<void>((_, reject) => { fail = reject; });
  expect(await settleWithin(slow, 5, (error) => late.push(error))).toEqual({});
  expect(late).toEqual([]);
  fail(failure);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(late).toEqual([failure]);
});

test("zastaraný neotvorený priečinok sa uvoľní pred prijatím, aktívny ani adoptovaný nie", async () => {
  const { budget, disposed, initialized } = fixture({ limit: 1 });
  budget.markStale(scope("/a"));
  (await budget.admit(scope("/a")))();
  expect(disposed).toEqual(["/a"]);
  expect(initialized).toEqual(["/a"]);
  budget.markStale(scope("/a"));
  (await budget.admit(scope("/a")))();
  expect(disposed).toEqual(["/a"]);
  budget.markStale(scope("/b"));
  await budget.adopt(scope("/b"));
  expect(disposed).toEqual(["/a", "/a"]);
});

test("cesty, pri ktorých záleží na konfigurácii inštancie", () => {
  expect(readsEngineConfig("/provider")).toBe(true);
  expect(readsEngineConfig("/config/providers")).toBe(true);
  expect(readsEngineConfig("/agent")).toBe(true);
  expect(readsEngineConfig("/skill")).toBe(true);
  expect(readsEngineConfig("/api/model")).toBe(true);
  expect(readsEngineConfig("/session")).toBe(false);
  expect(readsEngineConfig("/event")).toBe(false);
  expect(readsEngineConfig("/session/ses_1/message")).toBe(false);
});

test("nastavenia z prostredia", () => {
  expect(engineMcpBudgetSettings({})).toEqual({ limit: 1, idleMs: 600_000 });
  expect(engineMcpBudgetSettings({ LAWOSS_ENGINE_MCP_INSTANCES: "0", LAWOSS_ENGINE_MCP_IDLE_MS: "5000" })).toEqual({ limit: 0, idleMs: 5_000 });
  expect(engineMcpBudgetSettings({ LAWOSS_ENGINE_MCP_INSTANCES: "-2" })).toEqual({ limit: 1, idleMs: 600_000 });
});
