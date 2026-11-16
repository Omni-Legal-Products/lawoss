import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StatusBar } from "../src/react-app/domains/session/chat/status-bar";
import { engineStatusText, reportEngineHealth } from "../src/lawoss/shell/engine-status";

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
    expect(source).toContain("reportEngineHealth((await client.health()).engine?.status);");
    expect(source).toContain("reportEngineHealth(null);");
  });
});
