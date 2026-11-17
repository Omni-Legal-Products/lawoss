/**
 * #494: zmiznutý priečinok klienta. Server hlási `project_folder_unavailable` po anglicky; appka podľa kódu ukáže
 * preložený text s menom klienta, nikdy „OpenCode“, stavový riadok nehlási odpojenie celej appky, meno klienta ostane
 * z karty a prehľad klienta ponúkne „Nájsť presunutý priečinok“. „Skúsiť znova“ po návrate priečinka obnoví klienta.
 */
import { afterEach, describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EngineProjectStatus } from "@legalwork/types/engine-project";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import { setLocale as setLanguage } from "@/i18n";
import { createLegalworkServerClient, LegalworkServerError } from "../src/app/lib/legalwork-server";
import { StatusBar } from "../src/react-app/domains/session/chat/status-bar";
import { EngineProjectRecoveryNotice } from "../src/react-app/domains/workspace/engine-project-approval";
import { PROJECT_FOLDER_RECONNECTED_EVENT } from "../src/react-app/domains/workspace/project-folder-recovery";
import { isFolderUnavailableMessage, retryProjectQueries, workspaceErrorMessage, workspaceErrorText } from "../src/lawoss/shell/workspace-folder";
import { clientRowFrom } from "../src/lawoss/lite/client-row-view";
import { ClientOverviewFrom } from "../src/lawoss/lite/client-overview";
import { clientNavModel, type ClientOverviewState } from "../src/lawoss/lite/client-projects";
import type { OkfConnection } from "../src/lawoss/okf/connection";
import type { OkfReadResult, OkfScope } from "../src/lawoss/okf/read-model";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";

const SERVER_TEXT = "Reconnect the project drive or restore its folder to its original location, then retry.";
const gone = () => new LegalworkServerError(404, "project_folder_unavailable", SERVER_TEXT);

afterEach(() => setLanguage("en"));

describe("#494 (b): serverové texty o chýbajúcom priečinku sú preložené", () => {
  test("chyba priestoru: kód sa zachová, text je preložený s menom klienta", () => {
    const stored = workspaceErrorMessage(gone());
    expect(isFolderUnavailableMessage(stored)).toBe(true);
    for (const [language, expected] of [["sk", "Priečinok SYN Tomáš Švec remeslá sa nenašiel"], ["cs", "Složka SYN Tomáš Švec remeslá"], ["de", "SYN Tomáš Švec remeslá"], ["en", "SYN Tomáš Švec remeslá"]] as const) {
      setLanguage(language);
      const text = workspaceErrorText(stored, "SYN Tomáš Švec remeslá");
      expect(text).toContain(expected);
      expect(text).not.toContain("Reconnect the project drive");
    }
    // Iné chyby ostanú, ako ich poslal server.
    const other = workspaceErrorMessage(new Error("Engine timeout"));
    expect(isFolderUnavailableMessage(other)).toBe(false);
    expect(workspaceErrorText(other, "X")).toBe("Engine timeout");
  });

  test("diagnostika enginu pri chýbajúcom priečinku sa neukáže (nikdy „OpenCode“), iné konflikty áno", () => {
    const status = (projection: EngineProjectStatus["projection"]): EngineProjectStatus => ({ state: "configuration_conflict", required: false, directory: "/x", approvalScope: [], projection, plugins: [] });
    const html = (value: EngineProjectStatus) => renderToStaticMarkup(<EngineProjectRecoveryNotice status={value} onRetry={() => {}} />);
    expect(html(status({ diagnostic: "This project folder is unavailable. Reconnect its existing folder before starting OpenCode automation.", code: "project_folder_unavailable" }))).toBe("");
    expect(html(status({ diagnostic: "Other conflict" }))).toContain("Other conflict");
  });

  test("server pridá k diagnostike kód, ktorý appka rozpozná", async () => {
    const server = await Bun.file(new URL("../../server/src/engine-project.ts", import.meta.url)).text();
    expect(server).toContain('code: "project_folder_unavailable"');
  });
});

describe("#494 (d): stavový riadok pri chýbajúcom priečinku klienta", () => {
  const bar = (folderUnavailable?: string) => renderToStaticMarkup(<TooltipProvider><StatusBar clientConnected={false} legalworkServerStatus="connected" developerMode={false}
    settingsOpen={false} onOpenSettings={() => {}} providerConnectedIds={[]} mcpConnectedCount={0} showSettingsButton={false} folderUnavailable={folderUnavailable} /></TooltipProvider>);

  test("server beží, chýba len priečinok jedného klienta: nie „Odpojené“ ani „v nastaveniach“, ale meno klienta", () => {
    setLanguage("sk");
    const html = bar("SYN Tomáš Švec remeslá");
    expect(html).not.toContain("Odpojené");
    expect(html).not.toContain("nastaveniach");
    expect(html).toContain("SYN Tomáš Švec remeslá");
    expect(html).toContain('data-lawoss-folder-unavailable=""');
    // Skutočné odpojenie ostáva ako doteraz.
    expect(bar()).toContain("Odpojené");
  });
});

describe("#494 (c): meno klienta z karty aj pri chýbajúcom priečinku", () => {
  test("prehľad bez mena z karty (priečinok chýba) použije meno zapamätané z karty, nie slug priečinka", () => {
    const facts = { eligible: true, path: "/prax/Klienti/C024-syn-tomas-svec-remesla", deadline: null };
    expect(clientRowFrom(facts, "C024-syn-tomas-svec-remesla", "sk", "SYN Tomáš Švec remeslá").label).toBe("SYN Tomáš Švec remeslá");
    expect(clientRowFrom(facts, "C024-syn-tomas-svec-remesla", "sk").label).toBe("C024 syn tomas svec remesla");
    expect(clientRowFrom({ ...facts, cardTitle: "Nové meno" }, "C024-syn-tomas-svec-remesla", "sk", "SYN Tomáš Švec remeslá").label).toBe("Nové meno");
  });
});

describe("#494 (e): „Skúsiť znova“ po návrate priečinka obnoví klienta", () => {
  test("úspešné opakovanie obnoví dopyty a ohlási obnovený priečinok (stav trasy a pozastavená synchronizácia)", async () => {
    const events = new EventTarget();
    let announced = 0, invalidated = 0;
    events.addEventListener(PROJECT_FOLDER_RECONNECTED_EVENT, () => { announced++; });
    const ok = async () => ({ error: null });
    await retryProjectQueries([ok, ok], async () => { invalidated++; }, events);
    expect([invalidated, announced]).toEqual([1, 1]);
    // Priečinok stále chýba: nič sa neohlási.
    await retryProjectQueries([ok, async () => ({ error: gone() })], async () => { invalidated++; }, events);
    expect([invalidated, announced]).toEqual([1, 1]);
  });

  test("Domov projektu volá opakovanie s obnovou namiesto samotného refetch", async () => {
    const home = await Bun.file(new URL("../src/react-app/domains/workspace/project-home.tsx", import.meta.url)).text();
    expect(home).toContain("retryProjectQueries(");
  });
});

describe("#494: prehľad klienta s chýbajúcim priečinkom", () => {
  const svec: RouteWorkspace = { id: "svec", path: "/prax/Klienti/C024-syn-tomas-svec-remesla", name: "C024-syn-tomas-svec-remesla", displayNameResolved: "C024-syn-tomas-svec-remesla", workspaceType: "local" };
  const hron: RouteWorkspace = { id: "hron", path: "/prax/Klienti/Hron", name: "Hron", displayNameResolved: "Hron", workspaceType: "local" };
  const connection: OkfConnection = { client: createLegalworkServerClient({ baseUrl: "http://127.0.0.1:9", token: "t" }), baseUrl: "http://127.0.0.1:9", token: "t", workspaces: [svec, hron], activeWorkspaceId: "svec", authGeneration: 1 };
  const practice: OkfScope = { anchor: svec, members: [{ workspace: hron, prefix: "Klienti/Hron" }, { workspace: svec, prefix: "Klienti/C024-syn-tomas-svec-remesla" }], practiceRoot: "/prax" };
  const ready: ClientOverviewState = { status: "ready", scope: practice, groups: [], matters: [] };
  const model = clientNavModel([svec, hron], "/prax", ready);
  const data = (problems: OkfReadResult["problems"]) => ({ matters: [], inputs: [], clients: [], problems, truncated: false, upcomingDeadlines: [], overdue: [],
    totals: { matters: 0, deadlinesWithin7Days: 0, openTasks: 0, overdue: 0, records: 0 }, coverage: { status: "partial", scopeKey: "k", sources: [] } } satisfies OkfReadResult);
  const html = (node: ReactElement) => renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter><SidebarProvider>{node}</SidebarProvider></MemoryRouter></QueryClientProvider>);

  test("Domov klienta ukáže kartu „Priečinok … sa nenašiel“ s „Nájsť presunutý priečinok“ nad prehľadom", () => {
    setLanguage("sk");
    const missing = data([{ path: "Klienti/C024-syn-tomas-svec-remesla", message: SERVER_TEXT, folderUnavailable: "svec" }]);
    const out = html(<ClientOverviewFrom nav={{ connection, scope: practice, data: missing, groups: [], model, excludedWorkspaceIds: [], rows: new Map() }} workspaceId="svec" />);
    expect(out).toContain("data-lawoss-missing-folder");
    expect(out).toContain("Find moved folder");
    // Iný, dostupný klient kartu nedostane.
    const other = html(<ClientOverviewFrom nav={{ connection, scope: practice, data: missing, groups: [], model, excludedWorkspaceIds: [], rows: new Map() }} workspaceId="hron" />);
    expect(other).not.toContain("data-lawoss-missing-folder");
  });
});
