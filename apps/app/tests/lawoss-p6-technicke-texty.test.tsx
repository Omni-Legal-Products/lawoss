// LAWOSS P6 (test 24. 10. 2026, N-A3-6): advokát nevidí technické texty.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { currentLocale, setLocale, t, type Language } from "../src/i18n";
import { getDisplaySessionTitle } from "../src/app/lib/session-title";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PendingPermission } from "../src/app/types";
import { fileOperationCard } from "../src/lawoss/lite/file-operation-card";
import { PermissionApprovalModal, PermissionApprovalPanel } from "../src/react-app/domains/session/chat/permission-approval-modal";
import { QueryClient } from "@tanstack/react-query";
import { okfOverviewQueryOptions, okfScope, type OkfReadResult, type OkfScopeClient } from "../src/lawoss/okf/read-model";
import { PracticeCoverage } from "../src/lawoss/okf/practice-coverage";
import { clearCaseChatContext, peekCaseChatContext, rememberCaseChatContext } from "../src/lawoss/okf/case-chat-context";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";

const initial: Language = currentLocale();
afterEach(() => setLocale(initial));
const source = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf8");

describe("nová karta chatu nemá názov enginu „New session - …“", () => {
  test("predvolený názov enginu sa ukáže po slovensky, česky, anglicky a nemecky", () => {
    const engineTitle = `New session - ${new Date("2026-10-24T13:35:00.000Z").toISOString()}`;
    const expected: Record<Language, string> = { sk: "Nový chat", cs: "Nový chat", en: "New chat", de: "Neuer Chat" };
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      setLocale(locale);
      expect(getDisplaySessionTitle(engineTitle)).toBe(expected[locale]);
    }
    expect(getDisplaySessionTitle("Presun PDF na NAS")).toBe("Presun PDF na NAS");
  });

  test("karta chatu z „+“ aj uložené karty idú cez zobrazovaný názov", () => {
    expect(source("src/react-app/shell/session-route.tsx")).toContain("label: getDisplaySessionTitle(session.title)");
    expect(source("src/react-app/shell/session-route.tsx")).not.toContain("label: session.title ||");
    expect(source("src/react-app/domains/session/panel/side-panel.tsx")).toContain('tab.type === "chat" ? getDisplaySessionTitle(tab.label)');
  });
});

describe("detail skillu v Integráciách nie je po anglicky (V14)", () => {
  const modal = () => source("src/react-app/design-system/extension-detail-modal.tsx");
  test("popisky nie sú napevno anglické", () => {
    for (const label of ["Details", "Type", "Location", "Status", "Visibility", "Endpoint", "Launch", "Authentication", "Availability", "Trigger", "Setup", "Preview", "Show", "Hide"])
      expect(modal().match(new RegExp(`>\\s*${label}\\s*<`))?.[0] ?? null).toBeNull();
    for (const value of ["Installed", "Connected", "Not installed", "Not connected", "Hidden", "Shown", "Uninstall", "Disconnect"])
      expect(modal().includes(`"${value}"`) ? value : null).toBeNull();
  });
  test("SK, CS a DE majú vlastné texty detailu", () => {
    const keys = ["session.details_label", "mcp.server_type", "extension_detail.location", "identities.status_label", "skills.installed_status",
      "extension_detail.visibility", "extension_detail.shown", "extension_card.hidden", "common.hide", "office_addins.uninstall", "extension_detail.not_installed",
      "extension_detail.trigger", "extension_detail.availability", "extension_detail.setup"];
    const expected: Record<"sk" | "cs" | "de", string[]> = {
      sk: ["Podrobnosti", "Typ", "Umiestnenie", "Stav", "Nainštalované", "Viditeľnosť", "Zobrazené", "Skryté", "Skryť", "Odinštalovať", "Nenainštalované", "Kedy sa použije", "Dostupnosť", "Nastavenie"],
      cs: ["Podrobnosti", "Typ", "Umístění", "Stav", "Nainstalováno", "Viditelnost", "Zobrazeno", "Skryté", "Skrýt", "Odinstalovat", "Nenainstalováno", "Kdy se použije", "Dostupnost", "Nastavení"],
      de: ["Details", "Typ", "Speicherort", "Status", "Installiert", "Sichtbarkeit", "Angezeigt", "Ausgeblendet", "Ausblenden", "Deinstallieren", "Nicht installiert", "Wann er verwendet wird", "Verfügbarkeit", "Einrichtung"],
    };
    for (const locale of ["sk", "cs", "de"] as const) {
      setLocale(locale);
      expect(keys.map((key) => t(key))).toEqual(expected[locale]);
    }
  });
});

describe("„Podrobnosti“ karty zmeny súborov bez surového JSON (V10a)", () => {
  const metadata = { lawossFiles: [
    { operation: "move", kind: "file", from: "00_Na_zatriedenie/sken_sud_001.pdf", to: "Spisy/M004 Vyúčtovanie nájmu logistického skladu/2026-10-15 Uznesenie.pdf" },
    { operation: "move", kind: "file", from: "Spisy/M004/podklad.pdf", to: "Spisy/M004/zmluva (2).pdf" },
    { operation: "copy", kind: "folder", from: "Spisy/M004/Podania", to: "C002-podklady/Podania", entries: 3 },
    { operation: "delete", kind: "file", from: "stary.txt" },
  ], description: "Zaradenie rozhodnutia do prípadu" };
  const permission: PendingPermission = { id: "per_1", sessionID: "ses_1", permission: "lawoss_file_change", patterns: [], metadata, always: [], receivedAt: 1, protocol: "legacy" };

  test("každá zmena má sloveso, obe cesty celé a počty položiek, v SK/CS/EN/DE", () => {
    setLocale("sk");
    expect(fileOperationCard(metadata)?.details).toEqual({ reason: "Dôvod: Zaradenie rozhodnutia do prípadu", lines: [
      "Presunúť: 00_Na_zatriedenie/sken_sud_001.pdf → Spisy/M004 Vyúčtovanie nájmu logistického skladu/2026-10-15 Uznesenie.pdf",
      "Premenovať: Spisy/M004/podklad.pdf → Spisy/M004/zmluva (2).pdf",
      "Kópia priečinka: Spisy/M004/Podania → C002-podklady/Podania s 3 položkami",
      "Do Koša: stary.txt",
    ] });
    const first = (locale: Language) => { setLocale(locale); return fileOperationCard(metadata)?.details.lines.slice(0, 3).map((line) => line.split(":")[0]); };
    expect(first("cs")).toEqual(["Přesunout", "Přejmenovat", "Kopie složky"]);
    expect(first("en")).toEqual(["Move", "Rename", "Copy folder"]);
    expect(first("de")).toEqual(["Verschieben", "Umbenennen", "Ordner kopieren"]);
  });

  test("karta v chate aj dialóg ukážu zoznam, nie lawossFiles/operation/kind", () => {
    setLocale("sk");
    for (const html of [renderToStaticMarkup(<PermissionApprovalPanel permission={permission} respondPermission={() => {}} />),
      renderToStaticMarkup(<PermissionApprovalModal permission={permission} respondPermission={() => {}} />)]) {
      if (!html.includes("data-lawoss-file-details")) continue; // A closed or portalled dialog renders nothing on the server.
      for (const raw of ["lawossFiles", "&quot;operation&quot;", "&quot;kind&quot;", "&quot;from&quot;"]) expect(html.includes(raw) ? raw : null).toBeNull();
      expect(html).toContain("Premenovať: Spisy/M004/podklad.pdf → Spisy/M004/zmluva (2).pdf");
    }
    const panel = renderToStaticMarkup(<PermissionApprovalPanel permission={permission} respondPermission={() => {}} />);
    expect(panel).toContain("data-lawoss-file-details");
    expect(panel).toContain("Dôvod: Zaradenie rozhodnutia do prípadu");
  });

  test("N-A4-6: karta s jednou zmenou cestu zalomí a neoreže koniec s novým menom súboru", () => {
    setLocale("sk");
    const to = "Spisy/M001-uhrada-dodavok-riadiacich-jednotiek/01_Podklady/IN-001 Faktúra 2026-118 Tatran.pdf";
    const single: PendingPermission = { ...permission, metadata: { lawossFiles: [{ operation: "move", kind: "file", from: "00_Na_zatriedenie/sken_001.pdf", to }] } };
    const panel = renderToStaticMarkup(<PermissionApprovalPanel permission={single} respondPermission={() => {}} />);
    const scope = /<div class="([^"]*)">00_Na_zatriedenie\/sken_001\.pdf → ([^<]*)<\/div>/.exec(panel);
    expect(scope?.[2]).toBe(to);
    expect(scope?.[1].split(" ")).not.toContain("truncate");
    expect(scope?.[1]).toContain("break-all");
    // Iná karta s jedným riadkom ostáva v jednom riadku ako upstream.
    const other: PendingPermission = { ...permission, permission: "webfetch", patterns: ["https://example.invalid/very/long/path"], metadata: { url: "https://example.invalid" } };
    expect(renderToStaticMarkup(<PermissionApprovalPanel permission={other} respondPermission={() => {}} />)).toMatch(/class="[^"]* truncate">https:\/\/example\.invalid\/very\/long\/path</);
  });

  test("iné karty si surové podrobnosti nechávajú", () => {
    setLocale("sk");
    const other: PendingPermission = { ...permission, permission: "webfetch", metadata: { url: "https://example.invalid", format: "text" } };
    const html = renderToStaticMarkup(<PermissionApprovalPanel permission={other} respondPermission={() => {}} />);
    expect(html).toContain("&quot;format&quot;");
    expect(html).not.toContain("data-lawoss-file-details");
  });
});

describe("nový chat prípadu: technické pokyny idú modelu skryto (R1)", () => {
  test("prvé odoslanie pridá skrytý pokyn chatu do system-reminder časti správy", () => {
    const route = source("src/react-app/shell/session-route.tsx");
    expect(route).toContain("yoloTurnContext(), peekCaseChatContext(targetSessionId)]");
    expect(route).toContain("if (turnSystemContext) parts.push(systemReminderPart(turnSystemContext));");
  });

  // Rovnaký postup ako `sendNativeDraft`: pokyn sa pri zostavení správy len prečíta a zabudne sa až po úspešnom odovzdaní.
  async function send(sessionId: string, transport: (hidden: string | undefined) => Promise<void>): Promise<void> {
    const hidden = peekCaseChatContext(sessionId);
    await transport(hidden);
    clearCaseChatContext(sessionId);
  }

  test("zlyhané prvé odoslanie si skrytý pokyn ponechá pre opakovanie", async () => {
    rememberCaseChatContext("ses_retry", "LAWOSS case chat. Load the case memory first.");
    const delivered: (string | undefined)[] = [];
    await expect(send("ses_retry", async (hidden) => { delivered.push(hidden); throw new Error("AI boundaries refusal"); })).rejects.toThrow();
    await send("ses_retry", async (hidden) => { delivered.push(hidden); });
    await send("ses_retry", async (hidden) => { delivered.push(hidden); });
    expect(delivered).toEqual(["LAWOSS case chat. Load the case memory first.", "LAWOSS case chat. Load the case memory first.", undefined]);
  });

  test("session-route zabudne pokyn až po úspešnom odovzdaní (fronta, Fusion, bežné odoslanie)", () => {
    const route = source("src/react-app/shell/session-route.tsx");
    const body = route.slice(route.indexOf("const sendNativeDraft = useCallback"), route.indexOf("const surfaceProps = useMemo"));
    const peek = body.indexOf("peekCaseChatContext(targetSessionId)");
    const clears = [...body.matchAll(/clearCaseChatContext\(targetSessionId\)/g)].map((match) => match.index ?? -1);
    expect(peek).toBeGreaterThan(0);
    expect(clears).toHaveLength(3);
    // Fronta: až po `await enqueue(...)`; Fusion: až v `.then` úspešného behu; bežné odoslanie: až po kontrole výsledku.
    expect(body.slice(peek, clears[0])).toContain('await enqueue({ kind: "prompt"');
    expect(body.slice(clears[1]! - 20, clears[1])).toContain(".then(() =>");
    expect(body.slice(clears[1]!, clears[2])).toContain("if (result.error) throw new Error(serializeSDKError(result.error));");
    expect(body.slice(0, peek)).not.toContain("clearCaseChatContext");
  });
});

describe("stav praxe navrchu stránok kancelárie (N-A2-8)", () => {
  const root = "/Users/advokat/4-usporiadana-kancelaria";
  const slugs = ["C001-syn-tatran-automatika-s-r-o", "C002-syn-hron-technologie-a-s", "C017-syn-zuzana-simkova"];
  const titles = ["SYN Tatran Automatika, s. r. o.", "SYN Hron Technológie, a. s.", "SYN Zuzana Šimková"];
  const workspaces: RouteWorkspace[] = slugs.map((slug) => ({ id: slug.slice(0, 4), path: `${root}/${slug}`, name: slug, displayNameResolved: slug, workspaceType: "local" }));
  const empty: OkfScopeClient = {
    listWorkspaceDirectory: async () => ({ path: "", entries: [], truncated: false }),
    readWorkspaceFile: async () => { throw new Error("not found"); },
    lawossOfficeMemory: async (expected) => ({ practiceRoot: expected, directory: null, files: [], problems: [], truncated: false }),
  };
  const at = new Date(2026, 9, 23, 15, 57, 15).getTime();
  async function overview(): Promise<{ data: OkfReadResult; scope: NonNullable<ReturnType<typeof okfScope>> }> {
    const scope = okfScope(workspaces, workspaces[0]!, root)!;
    const queries = new QueryClient();
    const read = await queries.fetchQuery(okfOverviewQueryOptions({ client: empty, baseUrl: "http://synthetic", token: "synthetic" }, scope, "2026-10-23", queries));
    queries.clear();
    const data: OkfReadResult = { ...read, clients: slugs.map((path, index) => ({ path, title: titles[index] })),
      coverage: { ...read.coverage, status: "complete", sources: read.coverage.sources.map((source) => ({ ...source, state: "fresh" as const, lastSuccessAt: at, checkedAt: at })) } };
    return { data, scope };
  }
  const text = (html: string) => html.replace(/<[^>]+>/g, "\n");

  // Server rendering always uses English (`useLocale` server snapshot); SK/CS texts are checked through t() below.
  test("úplné čítanie: jeden riadok s praxou, počtom klientov a časom; žiadny zoznam slugov navrchu", async () => {
    const { data, scope } = await overview();
    const html = renderToStaticMarkup(<PracticeCoverage data={data} scope={scope} now={at} />);
    const firstLine = text(html).split("\n").find(Boolean);
    expect(firstLine).toMatch(/^Selected practice: 4 usporiadana kancelaria · 3 clients · updated \S+/);
    expect(html).toContain('role="status"');
    expect(html).not.toContain("data-lawoss-practice-problems");
    for (const slug of slugs) expect(html.includes(slug) ? slug : null).toBeNull();
    // Podrobnosti sú pod rozbaľovačom a menujú klientov z karty klienta.
    expect(html).toMatch(/<details data-lawoss-practice-details="">[\s\S]*SYN Hron Technológie, a\. s\.: Current/);
  });

  test("čiastočné čítanie: výstraha a zoznam len klientov s problémom, menom z karty a časom posledného úspechu", async () => {
    const { data, scope } = await overview();
    const partial: OkfReadResult = { ...data, coverage: { ...data.coverage, status: "partial", sources: data.coverage.sources.map((source) =>
      source.workspaceId === "C002" ? { ...source, state: "unavailable" as const, lastSuccessAt: null } : source.workspaceId === "C017" ? { ...source, state: "stale" as const } : source) } };
    const html = renderToStaticMarkup(<PracticeCoverage data={partial} scope={scope} now={at} excludedWorkspaceIds={["remote"]} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-lawoss-practice-coverage="partial"');
    expect(text(html)).toContain("The practice overview is incomplete.");
    expect(text(html)).toContain("1 outside this overview");
    const problems = /<ul data-lawoss-practice-problems="">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "";
    const items = text(problems).split("\n").filter(Boolean);
    expect(items[0]).toBe("SYN Hron Technológie, a. s.: Unavailable");
    expect(items[1]).toStartWith("SYN Zuzana Šimková: Last successful read · ");
    expect(items).toHaveLength(2);
    // Bez úspešného čítania všetkých zdrojov netvrdí čas aktualizácie.
    expect(text(html)).not.toContain("updated");
  });

  test("zlyhané obnovenie: aktuálne zdroje sa ukážu ako posledné úspešné čítanie, nie ako prázdne", async () => {
    const { data, scope } = await overview();
    const html = renderToStaticMarkup(<PracticeCoverage data={data} scope={scope} failed now={at} />);
    expect(html).toContain('role="alert"');
    expect(text(html)).toContain("SYN Tatran Automatika, s. r. o.: Last successful read · ");
    expect(html).not.toContain("Current");
    // Výstraha netvrdí „aktualizované“, aj keď má každý zdroj čas posledného úspechu.
    expect(text(html)).not.toContain("updated");
  });

  test("texty riadku v SK, CS a DE so správnymi tvarmi počtu", () => {
    expect((["sk", "cs", "de", "en"] as const).map((lng) => [1, 3, 24].map((count) => t("lawoss.practice.clients", { lng, count })))).toEqual([
      ["1 klient", "3 klienti", "24 klientov"], ["1 klient", "3 klienti", "24 klientů"], ["1 Mandant", "3 Mandanten", "24 Mandanten"], ["1 client", "3 clients", "24 clients"],
    ]);
    expect(t("lawoss.practice.updated", "sk", { time: "10:42" })).toBe("aktualizované 10:42");
    expect(t("lawoss.practice.excluded", "sk", { count: 2 })).toBe("mimo prehľadu: 2");
    expect(t("lawoss.practice.details", "cs")).toBe("Podrobnosti o načtení");
  });
});

describe("N-A5-1: karta upozorní na podobný názov vedľa mazanej alebo presúvanej položky", () => {
  const metadata = { lawossFiles: [
    { operation: "delete", kind: "file", from: "Spisy/M004/podklad.pdf", similar: ["Podklady.pdf"] },
    { operation: "delete", kind: "file", from: "stary.txt" },
  ] };
  test("hneď pod zmenou je podobný názov, v Zmenách aj v Podrobnostiach, v SK/CS/EN/DE", () => {
    setLocale("sk");
    const card = fileOperationCard(metadata);
    expect(card?.scopeValue).toBe("Do Koša: Spisy/M004/podklad.pdf\nSkontrolujte názov: vedľa Spisy/M004/podklad.pdf je aj Podklady.pdf.\nDo Koša: stary.txt");
    expect(card?.details.lines).toEqual(["Do Koša: Spisy/M004/podklad.pdf", "Skontrolujte názov: vedľa Spisy/M004/podklad.pdf je aj Podklady.pdf.", "Do Koša: stary.txt"]);
    for (const [locale, start] of [["cs", "Zkontrolujte název"], ["en", "Check the name"], ["de", "Bitte den Namen prüfen"]] as const) {
      setLocale(locale);
      expect(fileOperationCard(metadata)?.details.lines[1]).toStartWith(start);
    }
  });
});

