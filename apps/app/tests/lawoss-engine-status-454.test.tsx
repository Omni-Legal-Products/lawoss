import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StatusBar } from "../src/react-app/domains/session/chat/status-bar";
import { engineHealthPollDelay, engineStatusText, reportEngineHealth, retryEngine } from "../src/lawoss/shell/engine-status";

const bar = (connection: { clientConnected: boolean; legalworkServerStatus: "connected" | "disconnected" | "limited" } = { clientConnected: true, legalworkServerStatus: "connected" }) =>
  renderToStaticMarkup(<TooltipProvider><StatusBar clientConnected={connection.clientConnected} legalworkServerStatus={connection.legalworkServerStatus} developerMode={false}
    settingsOpen={false} onOpenSettings={() => {}} providerConnectedIds={[]} mcpConnectedCount={0} showSettingsButton={false} /></TooltipProvider>);

afterEach(() => reportEngineHealth(null));

describe("#454: stavový riadok podľa zdravia enginu", () => {
  test("pripravený alebo nehlásený engine: bežný stav „pripravené“", () => {
    expect(engineStatusText(null)).toBeNull();
    expect(engineStatusText("ready")).toBeNull();
    reportEngineHealth("ready");
    expect(bar()).not.toContain("data-lawoss-engine-status");
  });

  test("engine sa spúšťa (aj po páde): riadok to povie namiesto „pripravené“", () => {
    reportEngineHealth("starting");
    const html = bar();
    expect(html).toContain('data-lawoss-engine-status="starting"');
    expect(html).toContain("Agent is starting…");
    expect(engineStatusText("migrating")?.failed).toBe(false);
  });

  test("po vyčerpaní pokusov: agent nie je dostupný", () => {
    reportEngineHealth("error");
    const html = bar();
    expect(html).toContain('data-lawoss-engine-status="error"');
    expect(html).toContain("Restart LAWOSS to continue.");
  });

  test("kontrola zdravia servera zapisuje stav enginu", async () => {
    const source = await Bun.file(new URL("../src/react-app/domains/connections/legalwork-server-store.ts", import.meta.url)).text();
    expect(source).toContain("reportEngineHealth((await client.health()).engine?.status, token ? () => client.restartEngine() : undefined);");
    expect(source).toContain("reportEngineHealth(null);");
  });
});

describe("#477: „Skúsiť znova“, keď agent nie je dostupný", () => {
  test("tlačidlo je len pri nedostupnom agentovi, ktorého server vie znova spustiť", () => {
    reportEngineHealth("error");
    expect(bar()).not.toContain("Try again");
    reportEngineHealth("error", async () => ({ restarting: true, engine: { status: "starting" } }));
    const html = bar();
    expect(html).toContain("Try again");
    expect(html).toContain("Try again, or restart LAWOSS.");
    reportEngineHealth("starting", async () => ({ restarting: true, engine: { status: "starting" } }));
    expect(bar()).not.toContain("Try again");
  });

  test("klik požiada server raz, aj keď sa klikne znova počas požiadavky, a riadok hneď hlási spúšťanie", async () => {
    let requests = 0, answer: (value: { restarting: boolean; engine: { status: "starting" } }) => void = () => {};
    reportEngineHealth("error", () => { requests++; return new Promise(resolve => { answer = resolve; }); });
    const first = retryEngine(), second = retryEngine();
    expect(requests).toBe(1);
    answer({ restarting: true, engine: { status: "starting" } });
    await Promise.all([first, second]);
    expect(bar()).toContain('data-lawoss-engine-status="starting"');
  });
});

describe("#477: stav enginu aj vtedy, keď appka hlási odpojenie", () => {
  // Keď engine nebeží, kontrola schopností servera zlyhá a store hlási „disconnected“; /health pritom stav enginu hlási.
  const down = { clientConnected: false, legalworkServerStatus: "disconnected" as const };

  test("nedostupný agent ukáže „Skúsiť znova“ namiesto „Odpojené“, aj počas prvých sekúnd po štarte", () => {
    reportEngineHealth("error", async () => ({ restarting: true, engine: { status: "starting" } }));
    const html = bar(down);
    expect(html).toContain('data-lawoss-engine-status="error"');
    expect(html).toContain("Try again");
    expect(html).not.toContain("Preparing");
  });

  test("bez hláseného stavu enginu ostáva bežné „Odpojené“", () => {
    reportEngineHealth(null);
    expect(bar(down)).not.toContain("data-lawoss-engine-status");
  });

  test("kým engine nebeží, kontrola zdravia sa opakuje krátko a nenarastá na 60 s", () => {
    reportEngineHealth("error");
    expect(engineHealthPollDelay(false, 60_000)).toBe(5_000);
    expect(engineHealthPollDelay(true, 10_000)).toBe(5_000);
    reportEngineHealth("starting");
    expect(engineHealthPollDelay(false, 40_000)).toBe(2_000);
    reportEngineHealth("ready");
    expect(engineHealthPollDelay(true, 60_000)).toBe(10_000);
    reportEngineHealth(null);
    expect(engineHealthPollDelay(false, 10_000)).toBe(20_000);
    expect(engineHealthPollDelay(false, 40_000)).toBe(60_000);
  });

  test("store plánuje kontrolu zdravia podľa stavu enginu", async () => {
    const source = await Bun.file(new URL("../src/react-app/domains/connections/legalwork-server-store.ts", import.meta.url)).text();
    expect(source).toContain("healthDelayMs = engineHealthPollDelay(healthy, healthDelayMs);");
  });
});
