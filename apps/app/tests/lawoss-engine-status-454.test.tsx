import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StatusBar } from "../src/react-app/domains/session/chat/status-bar";
import { engineStatusText, reportEngineHealth, retryEngine } from "../src/lawoss/shell/engine-status";

const bar = () => renderToStaticMarkup(<TooltipProvider><StatusBar clientConnected legalworkServerStatus="connected" developerMode={false}
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
