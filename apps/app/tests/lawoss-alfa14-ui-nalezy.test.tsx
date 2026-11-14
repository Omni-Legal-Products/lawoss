// Nálezy UI z testu zostavy alfy 14 (output/2026-11-14-overenie-alfa12/test-vetva-alfa14.md, 14. 11. 2026):
// pole chatu, návrat z Nastavení, karta súhlasu, meno klienta na Domove, „Čaká na vás“, úryvok hľadania,
// visiaca bublinka, Dokumenty klienta a Integrácie. Len bežný režim; pokročilý ostáva natívny.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { PendingPermission } from "../src/app/types";
import { setLocale } from "../src/i18n";
import { currentUiMode, setUiMode } from "../src/lawoss/lite/ui-mode";
import { waitingLink } from "../src/lawoss/lite/today-model";
import { isSettingsPath, rememberSettingsReturn, resetSettingsReturnForTest, settingsReturnRoute } from "../src/lawoss/lite/settings-return";
import { detailsBeyondScope, detailsHaveContent } from "../src/lawoss/lite/permission-details";
import { fileOperationCard } from "../src/lawoss/lite/file-operation-card";
import { homeClientLabel } from "../src/lawoss/lite/client-row-view";
import { plainSearchExcerpt } from "../src/lawoss/lite/search-excerpt";
import { DocumentsDisclosureView } from "../src/lawoss/lite/documents-disclosure";
import { AiGuidance, GuidanceDisclosureView } from "../src/lawoss/domains/ai/guidance";
import { PermissionApprovalPanel } from "../src/react-app/domains/session/chat/permission-approval-modal";

const source = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf8");
const initialMode = currentUiMode();
afterEach(() => { setUiMode(initialMode); resetSettingsReturnForTest(); });

describe("1. pole chatu po odovzdaní vety", () => {
  test("Enter aj návrh vyprázdnia pole hneď po odložení vety pre Domov", () => {
    const bar = source("src/lawoss/lite/pages/today-page.tsx");
    const open = bar.slice(bar.indexOf("const open = (value: string)"), bar.indexOf("return <div className={className"));
    expect(open).toMatch(/if \(!value\.trim\(\)\) return;[^]*setDraft\(""\);\s*requestHomePrefill\(value\);\s*navigate\(homeRoute\(projectId\)\);/);
  });
});

describe("2. zatvorenie Nastavení", () => {
  test("bežný režim sa vráti na poslednú obrazovku mimo Nastavení, s parametrami", () => {
    expect(settingsReturnRoute("lite")).toBeNull();
    rememberSettingsReturn("/dnes");
    rememberSettingsReturn("/vec", "?vec=Spisy%2FM001");
    rememberSettingsReturn("/settings/general");
    rememberSettingsReturn("/workspace/ws1/settings/extensions/mcp");
    expect(settingsReturnRoute("lite")).toBe("/vec?vec=Spisy%2FM001");
    expect(settingsReturnRoute("pro")).toBeNull();
  });

  test("trasa Nastavení aj Nastavení priečinka", () => {
    expect(["/settings", "/settings/ai", "/workspace/a/settings/general"].map(isSettingsPath)).toEqual([true, true, true]);
    expect(["/dnes", "/klienti", "/settingsx", "/workspace/a/session"].map(isSettingsPath)).toEqual([false, false, false, false]);
  });

  test("zatvorenie v settings-route použije zapamätanú obrazovku pred natívnym návratom", () => {
    expect(source("src/react-app/shell/settings-route.tsx")).toContain("navigate(settingsReturnRoute() ?? sessionReturnRoute)");
    expect(source("src/lawoss/lite/sidebar-footer.tsx")).toContain("rememberSettingsReturn(pathname, search)");
    // Domov v lište Nastavení ostáva natívny.
    expect(source("src/react-app/shell/settings-route.tsx")).toContain("onHome={props.onClose ?? (() => navigate(sessionReturnRoute))}");
    expect(source("src/react-app/domains/settings/shell/settings-shell.tsx")).toContain("navHome: { onClick: props.onHome ?? props.onClose }");
  });
});

describe("3. karta súhlasu bez opakovania", () => {
  const deadline = { target: "Spisy/M064/memory/T-001-podanie.md", kind: "create", title: "Podanie", type: "task",
    truth: "Lehota 2026-12-03: Podanie vyjadrenia.", history: ["2026-11-14 — x"], fields: ["type: task"], reason: "Pokyn advokáta",
    deadline: { case: "Odmena SYN-0064", date: "2026-12-03", what: "Podanie vyjadrenia", basis: "lawyer_instruction", register: "Spisy/M064/VSTUPY.md" } };
  const note = { target: "Spisy/M064/memory/HN-001.md", kind: "update", title: "Telefonát", truth: "Konateľ volal.\n\nDruhý odsek.", previousTruth: "Predtým.",
    history: [], fields: [], reason: "Oznámený telefonát" };
  const permission = (lawossMemory: object): PendingPermission => ({ id: "per_1", sessionID: "ses_1", permission: "lawoss_file_change", patterns: ["x"],
    metadata: { lawossMemory }, always: [], receivedAt: 1, protocol: "legacy" });

  test("Podrobnosti nechajú len riadky, ktoré „Čo a kam“ nemá; viacriadkový text sa porovná celý", () => {
    expect(detailsBeyondScope({ reason: "Dôvod: x", lines: ["A", "B\n\nC", "D"] }, "A\nB\n\nC")).toEqual({ reason: "Dôvod: x", lines: ["D"] });
    // Riadok musí byť v bloku celý: začiatok riadka nestačí.
    expect(detailsBeyondScope({ reason: null, lines: ["A", "Súbor: x"] }, "AB\nSúbor: x/y.md").lines).toEqual(["A", "Súbor: x"]);
    expect(detailsHaveContent(null, true)).toBe(true);
    expect(detailsHaveContent({ reason: "Dôvod", lines: [] }, true)).toBe(true);
    expect(detailsHaveContent({ reason: "Dôvod", lines: [] }, false)).toBe(false);
    expect(detailsHaveContent({ reason: null, lines: [] }, true)).toBe(false);
  });

  test("karta lehoty: všetky riadky v bloku „Čo a kam“, Podrobnosti v bežnom režime bez nich (nezobrazia sa)", () => {
    setLocale("sk");
    const card = fileOperationCard({ lawossMemory: deadline });
    if (!card) throw new Error("karta lehoty");
    const rest = detailsBeyondScope(card.details, card.scopeValue);
    expect(rest.lines).toEqual([]);
    expect(detailsHaveContent(rest, true)).toBe(false);
    // Pokročilý režim (SSR): Podrobnosti otvorené ako doteraz, bez čitateľného písma bežného režimu.
    const pro = renderToStaticMarkup(React.createElement(PermissionApprovalPanel, { permission: permission(deadline), respondPermission: () => {} }));
    expect(pro).toMatch(/<details open=""/);
    expect(pro).toContain("data-lawoss-file-details");
    expect(pro).not.toContain("data-lawoss-readable-scope");
  });

  test("poznámka: v Podrobnostiach ostane dôvod a predchádzajúci text, nie riadky bloku", () => {
    setLocale("sk");
    const card = fileOperationCard({ lawossMemory: note });
    if (!card) throw new Error("karta poznámky");
    expect(detailsBeyondScope(card.details, card.scopeValue)).toEqual({ reason: "Dôvod: Oznámený telefonát", lines: ["Doteraz: Predtým."] });
  });

  test("karta v chate aj dialóg: lite skryje prázdne Podrobnosti, zbalí ich a odovzdá blok „Čo a kam“", () => {
    const modal = source("src/react-app/domains/session/chat/permission-approval-modal.tsx");
    expect(modal.match(/usePermissionDetails\(props\.permission, props\.chatDirectory, presentation\.details, presentation\.scopeValue\)/g)?.length).toBe(2);
    expect(modal).toContain("hasMetadata && !projectInstructions && detailsHaveContent(details, false)");
    expect(modal).toContain("hasMetadata && !projectInstructions && detailsHaveContent(details, true)");
    expect(modal).toContain("open={(Boolean(presentation.details) && !lite) || undefined}");
  });
});

describe("4. meno klienta na Domove", () => {
  const nav = { rows: new Map([["ws1", { path: "/kancelaria/C022-syn-michal-luptak-servis", eligible: true, cardTitle: "SYN Michal Ľupták servis", pending: false }]]) };
  test("bežný režim ukáže meno z karty ako bočný panel, pokročilý meno priestoru", () => {
    // @ts-expect-error: test potrebuje len údaje riadka, ktoré meno určujú
    expect(homeClientLabel(nav, { id: "ws1" }, "C022-syn-michal-luptak-servis", "sk", "lite")).toBe("SYN Michal Ľupták servis");
    // @ts-expect-error: ako vyššie
    expect(homeClientLabel(nav, { id: "ws1" }, "C022-syn-michal-luptak-servis", "sk", "pro")).toBe("C022-syn-michal-luptak-servis");
    expect(homeClientLabel(null, { id: "ws9" }, "Klient", "sk", "lite")).toBe("Klient");
  });

  test("výber aj zoznam na Domove idú cez meno klienta", () => {
    const home = source("src/react-app/domains/session/home/app-home.tsx");
    expect(home).toContain("clientLabel(project, project.displayName || project.name)");
    expect(home).toContain("clientLabel(workspace, workspace.displayName || workspace.name)");
  });
});

describe("5. Čaká na vás", () => {
  test("len nezaradené podklady vedú na Na zaradenie, inak (aj nič) na Lehoty a úlohy", () => {
    expect(waitingLink({ filing: 2, total: 2 })).toBe("/na-zaradenie");
    expect(waitingLink({ filing: 2, total: 3 })).toBe("/lehoty");
    expect(waitingLink({ filing: 0, total: 1 })).toBe("/lehoty");
    expect(waitingLink({ filing: 0, total: 0 })).toBe("/lehoty");
  });
});

describe("6. úryvok hľadania", () => {
  test("bez zvýraznenia markdownu, aj pri useknutom okraji; podčiarkovníky a násobenie ostávajú", () => {
    expect(plainSearchExcerpt("…lehota do **27. novembra 2026** podľa", "lite")).toBe("…lehota do 27. novembra 2026 podľa");
    expect(plainSearchExcerpt("…novembra 2026** podľa *pokynu* a `_STATUS.md`", "lite")).toBe("…novembra 2026 podľa pokynu a _STATUS.md");
    expect(plainSearchExcerpt("## Stav [rozsudok](https://x.invalid/a) v 00_Na_zatriedenie, 5 * 3", "lite")).toBe("Stav rozsudok v 00_Na_zatriedenie, 5 * 3");
    expect(plainSearchExcerpt("**tučné**", "pro")).toBe("**tučné**");
  });
});

describe("7. visiaca bublinka", () => {
  test("riadok značky a súdu na karte prípadu nemá vlastnú systémovú bublinku", () => {
    const card = source("src/lawoss/lite/client-dashboard.tsx");
    expect(card).toContain('<span className="lw-klient-ref">{meta}</span>');
    expect(card).not.toContain("title={meta}");
  });
});

describe("8. Dokumenty klienta", () => {
  test("bežný režim: spracovanie za zbaleným riadkom, obsah ostáva; pokročilý bez obalu", () => {
    setLocale("sk");
    const lite = renderToStaticMarkup(<DocumentsDisclosureView lite><section data-x="">obsah</section></DocumentsDisclosureView>);
    expect(lite).toMatch(/^<details class="[^"]*" data-lawoss-documents-disclosure="">/);
    expect(lite).toContain("Spracovanie dokumentov pre asistenta");
    expect(lite).toContain('<section data-x="">obsah</section>');
    expect(renderToStaticMarkup(<DocumentsDisclosureView lite={false}><section>obsah</section></DocumentsDisclosureView>)).toBe("<section>obsah</section>");
    const panel = source("src/react-app/domains/session/panel/workspace-files-panel.tsx");
    expect(panel).toMatch(/<LiteDocumentsDisclosure>\{\/\* 🟡 LAWOSS \*\/\}<DocumentProcessingPanel key=\{selectionKey\}/);
  });
});

describe("9. Integrácie: AI a chránené údaje", () => {
  test("bežný režim s liteDisclosure: celý text za zbaleným riadkom; bez neho a v pokročilom ako doteraz", () => {
    setLocale("sk");
    const view = (enabled: boolean, lite: boolean) => renderToStaticMarkup(<GuidanceDisclosureView enabled={enabled} lite={lite} label="AI a chránené údaje – podrobnosti"><aside>text</aside></GuidanceDisclosureView>);
    // Zbalené aj pred potvrdením prečítania: potvrdenie nič nepodmieňuje.
    expect(view(true, true)).toMatch(/^<details class="group text-sm" data-lawoss-ai-guidance-disclosure=""><summary[^>]*>.*AI a chránené údaje – podrobnosti<\/summary><aside>text<\/aside><\/details>$/);
    expect(view(false, true)).toBe("<aside>text</aside>");
    expect(view(true, false)).toBe("<aside>text</aside>");
    // Celý blok (aj „Rozumiem“ a verejný test) je v obale; pokročilý SSR ho ukáže bez zmeny.
    const pro = renderToStaticMarkup(<MemoryRouter><AiGuidance locale="sk" liteDisclosure /></MemoryRouter>);
    expect(pro).toStartWith("<aside");
    expect(pro).toContain("Rozumiem");
    expect(source("src/react-app/shell/settings-route.tsx")).toContain("<AiGuidance locale={currentLocale()} liteDisclosure");
  });
});
