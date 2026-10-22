import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { OnboardingSuggestion } from "../src/lawoss/domains/onboarding/api";
import { connectedClients, restoredChoice } from "../src/lawoss/domains/onboarding/found-screen";
import { foundText } from "../src/lawoss/domains/onboarding/found-text";
import {
  MAIN_ONBOARDING_PATH,
  patchOnboardingProgress,
  readOnboardingProgress,
  type WizardConnected,
} from "../src/lawoss/domains/onboarding/onboarding-state";
import { resumeFound } from "../src/lawoss/domains/onboarding/resume";
import { agentSummary, askPatch, editsMode } from "../src/lawoss/domains/onboarding/wizard/agent-mode";
import { ApprovalsStepView } from "../src/lawoss/domains/onboarding/wizard/approvals-step";
import { AssistantStepView } from "../src/lawoss/domains/onboarding/wizard/assistant-step";
import { DocumentsChoiceView } from "../src/lawoss/domains/onboarding/wizard/documents-step";
import { ConnectedTree, WizardFoundView } from "../src/lawoss/domains/onboarding/wizard/found-step";
import { readyCompletion, readyPlan, readyRows } from "../src/lawoss/domains/onboarding/wizard/ready-model";
import { ReadySummaryView } from "../src/lawoss/domains/onboarding/wizard/ready-step";
import { WizardProgress } from "../src/lawoss/domains/onboarding/wizard/wizard-frame";
import { WIZARD_TEXT, wizardText } from "../src/lawoss/domains/onboarding/wizard/wizard-text";
import { parseToolPermissions } from "../src/react-app/domains/settings/panels/tool-permissions-config";

/** Pamäťové úložisko prehliadača pre postup sprievodcu. */
function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
}

const sk = wizardText("sk");
const found = foundText("sk");
const noop = () => undefined;
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/g, " ").split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

const practice: OnboardingSuggestion = {
  root: "/p/4-usporiadana-kancelaria", level: "practice", marked: false, score: 0.9, signals: ["office_without_config"],
  clientPattern: "Klienti/*", complete: true,
  clients: [{ path: "Klienti/C001-syn-tatran", name: "C001-syn-tatran" }, { path: "Klienti/C002-syn-hron", name: "C002-syn-hron" }],
  units: [
    { path: "", matters: [], matterCount: 0, files: 40, exact: false },
    { path: "Klienti/C001-syn-tatran", matters: [{ path: "Spisy/M001-uhrada", name: "M001-uhrada" }, { path: "Spisy/M003-spolocnik", name: "M003-spolocnik" }], matterCount: 2, files: 12, exact: false },
    { path: "Klienti/C002-syn-hron", matters: [], matterCount: 0, files: 3, exact: true },
  ],
};
const client: OnboardingSuggestion = {
  root: "/p/C001 SYN Tatran", level: "client", marked: false, score: 0.8, signals: ["matter_named_children"], clients: [], complete: true,
  units: [{ path: "", matters: [{ path: "M004 Vyúčtovanie", name: "M004 Vyúčtovanie" }], matterCount: 1, files: 7, exact: true }],
};
const result = (id: string, path: string) => ({ result: "applied" as const, clientRoot: path, workspace: { id, path } });

describe("sprievodca C1: stavový automat a perzistencia", () => {
  test("poradie krokov: Kancelária → Dokumenty → Toto sme našli → AI → Ako agent pracuje → Pripravené", () => {
    expect(MAIN_ONBOARDING_PATH).toEqual(["identity", "folder", "found", "ai", "approvals", "ready"]);
  });

  test("Späť nestratí údaje: zmena kroku ponechá voľby praxe aj pripojenie", () => {
    const storage = memoryStorage();
    const connected: WizardConnected = { kind: "clients", root: "/p/prax", clients: [{ root: "/p/prax/Alfa", name: "Alfa", result: result("w1", "/p/prax/Alfa") }] };
    patchOnboardingProgress(storage, { lane: "detailed", step: "found", found: { root: "/p/prax", level: "practice", scope: "client", selected: ["Alfa"] } });
    patchOnboardingProgress(storage, { connected });
    patchOnboardingProgress(storage, { step: "ai" });
    patchOnboardingProgress(storage, { step: "found" });
    const progress = readOnboardingProgress(storage);
    expect(progress.step).toBe("found");
    expect(progress.found).toEqual({ root: "/p/prax", level: "practice", scope: "client", selected: ["Alfa"] });
    expect(progress.connected).toEqual(connected);
    // Iný priečinok staré voľby zmaže (undefined = zabudnúť).
    patchOnboardingProgress(storage, { found: undefined, connected: undefined });
    expect(readOnboardingProgress(storage)).toEqual({ lane: "detailed", step: "found" });
  });

  test("poškodené alebo podvrhnuté údaje v úložisku sa zahodia, krok ostane", () => {
    const storage = memoryStorage();
    storage.setItem("legalwork.lawoss.onboarding.v1", JSON.stringify({ lane: "detailed", step: "ready", found: { root: "relatívna", level: "practice", scope: "client", selected: [] }, connected: { kind: "clients", root: "/p", clients: [{ root: "/p/a", name: "A", result: { result: "hacked" } }] } }));
    expect(readOnboardingProgress(storage)).toEqual({ lane: "detailed", step: "ready" });
    storage.setItem("legalwork.lawoss.onboarding.v1", JSON.stringify({ lane: "detailed", step: "ready", connected: { kind: "fresh", root: "/p/LAWOSS", result: { result: "applied", root: "/p/LAWOSS", extra: "x" } } }));
    expect(readOnboardingProgress(storage).connected).toEqual({ kind: "fresh", root: "/p/LAWOSS", result: { result: "applied", root: "/p/LAWOSS" } });
  });

  test("obnova po prerušení vráti priečinok aj v krokoch po Toto sme našli", () => {
    const profile = { version: 1 as const, lawyerName: "A", jurisdiction: "sk" as const, language: "sk" as const, foundRoot: "/p/prax" };
    for (const step of ["found", "ai", "approvals", "ready"] as const) expect(resumeFound(step, { ...profile, step })).toEqual({ root: "/p/prax" });
    for (const step of ["identity", "folder"] as const) expect(resumeFound(step, { ...profile, step })).toBeNull();
    expect(resumeFound("ready", profile, undefined, true)).toEqual({ missing: "/p/prax" });
  });

  test("výber klientov praxe prejde návratom: uložená voľba platí len pre ten istý priečinok a známych klientov", () => {
    const saved = { root: practice.root, level: "practice" as const, scope: "client" as const, selected: ["Klienti/C002-syn-hron", "Klienti/zmizol"] };
    expect(restoredChoice(saved, practice)).toEqual({ level: "practice", scope: "client", selected: ["Klienti/C002-syn-hron"] });
    expect(restoredChoice({ ...saved, root: "/iny" }, practice)).toEqual({ level: "practice", scope: "client", selected: ["Klienti/C001-syn-tatran", "Klienti/C002-syn-hron"] });
    expect(restoredChoice(undefined, client).level).toBe("client");
  });

  test("pripojení sú len úspešní klienti dávky s výsledkom", () => {
    const items = [
      { root: "/p/a", name: "A", status: "done" as const, result: result("w1", "/p/a") },
      { root: "/p/b", name: "B", status: "failed" as const, error: "x" },
    ];
    expect(connectedClients(items)).toEqual([{ root: "/p/a", name: "A", result: result("w1", "/p/a") }]);
  });
});

describe("sprievodca C1: obrazovky", () => {
  test("ukazovateľ priebehu: hotový krok je tlačidlo s ikonou a slovom, aktuálny má aria-current", () => {
    const html = renderToStaticMarkup(<WizardProgress text={sk} steps={MAIN_ONBOARDING_PATH} current={2} onGo={noop} />);
    expect(html).toContain('aria-label="Postup nastavenia"');
    expect(html).toContain("Krok 3 z 6");
    expect(html).toMatch(/<li data-state="done"><button type="button" class="lw-onb-step-link">/);
    expect(html).toContain("(hotový)");
    expect(html).toMatch(/<li data-state="current" aria-current="step"><span class="lw-onb-step-bar"><\/span><span class="lw-onb-step-label">3\. Toto sme našli/);
    expect(html).not.toMatch(/data-state="next"><button/);
  });

  test("Dokumenty: dve voľby s príkladom výsledku a návrat k vybranému priečinku", () => {
    const html = renderToStaticMarkup(<DocumentsChoiceView text={sk} found={found} busy={false} resume={{ name: "C001 SYN Tatran", onContinue: noop }} onConnect={noop} onFresh={noop} />);
    expect(html).toContain("Pripojiť existujúci priečinok");
    expect(html).toContain("Začať nanovo");
    expect(html.match(/<figure class="lw-wiz-example">/g)).toHaveLength(2);
    expect(html).toContain("Vybraný priečinok: C001 SYN Tatran");
    expect(html).toContain('aria-hidden="true"');
  });

  test("Toto sme našli (prax): strom so skutočnými menami a počtami, zaškrtnutie v strome, čo pribudne", () => {
    const html = renderToStaticMarkup(
      <WizardFoundView text={sk} found={found} busy={false} suggestion={practice} headline="Vyzerá to ako celá prax: 2 klientov." level="practice" scope="client" selected={["Klienti/C001-syn-tatran"]}
        onLevel={noop} onScope={noop} onToggle={noop} onAll={noop} onAdd={noop} onTable={noop} onPickRoot={noop} childPath={(name) => name} />,
    );
    expect(html).toContain("4-usporiadana-kancelaria");
    expect(html).toContain("C001-syn-tatran");
    expect(html).toContain("M001-uhrada");
    expect(html).toContain("2 prípady · aspoň 12 súborov");
    expect(html).toContain("bez prípadov · 3 súbory");
    expect(html).toMatch(/type="checkbox" aria-label="Označený na pripojenie: C001-syn-tatran" checked=""/);
    expect(html).not.toMatch(/aria-label="Označený na pripojenie: C002-syn-hron" checked=""/);
    expect(html).toContain("Čo pribudne");
    expect(html).toContain("Nič sa nepresunie ani nezmaže.");
    expect(html).toMatch(/<button type="button" class="lw-btn gold">Pridať pomocné súbory \(1\)<\/button>/);
    expect(html).toMatch(/<summary>Pokročilé<\/summary>/);
  });

  test("Toto sme našli (klient): prípady pod klientom a dokumenty ostávajú na mieste; bez výberu prax nepokračuje", () => {
    const html = renderToStaticMarkup(
      <WizardFoundView text={sk} found={found} busy={false} suggestion={client} headline="h" level="client" scope="client" selected={[]}
        onLevel={noop} onScope={noop} onToggle={noop} onAll={noop} onAdd={noop} onTable={noop} onPickRoot={noop} childPath={(name) => name} />,
    );
    expect(html).toContain("M004 Vyúčtovanie");
    expect(html).toContain("Dokumenty ostávajú na mieste");
    expect(html).toContain(">Pridať pomocné súbory</button>");
    const none = renderToStaticMarkup(
      <WizardFoundView text={sk} found={found} busy={false} suggestion={practice} headline="h" level="practice" scope="client" selected={[]}
        onLevel={noop} onScope={noop} onToggle={noop} onAll={noop} onAdd={noop} onTable={noop} onPickRoot={noop} childPath={(name) => name} />,
    );
    expect(none).toMatch(/<button type="button" class="lw-btn gold" disabled="">Pridať pomocné súbory \(0\)/);
  });

  test("pripojený strom ukáže stav slovom: Pridané", () => {
    const html = renderToStaticMarkup(<ConnectedTree text={sk} connected={{ kind: "clients", root: "/p/prax", clients: [{ root: "/p/prax/A", name: "Alfa", result: result("w1", "/p/prax/A") }, { root: "/p/prax/B", name: "Beta", result: result("w2", "/p/prax/B") }] }} />);
    expect(html).toContain("Alfa");
    expect(html.match(/Pridané/g)).toHaveLength(2);
    const fresh = renderToStaticMarkup(<ConnectedTree text={sk} connected={{ kind: "fresh", root: "/p/LAWOSS", result: { result: "applied", root: "/p/LAWOSS" } }} />);
    expect(fresh).toContain("Zatiaľ bez klientov");
  });

  test("AI asistent: karty poskytovateľov, Pokračovať bez AI a stav AI hraníc pri akcii; podrobnosti zbalené", () => {
    const none = renderToStaticMarkup(<AssistantStepView text={sk} locale="sk" model={{ state: "no-model", providers: [] }} boundariesOn={false} busy={false} onOpenAiSettings={noop} onContinue={noop} />);
    expect(none).toContain("Zatiaľ žiadny poskytovateľ");
    expect(none).toContain(">Pripojiť poskytovateľa</button>");
    expect(none).toContain(">Pokračovať bez AI</button>");
    expect(none).toContain("AI hranice: vypnuté.");
    expect(none).toContain("Chýba");
    expect(none).toMatch(/<details class="lw-wiz-details"><summary>Podrobnosti o ochrane údajov<\/summary>/);
    const ready = renderToStaticMarkup(<AssistantStepView text={sk} locale="sk" model={{ state: "ready", modelLabel: "Claude Sonnet", providers: [{ id: "anthropic", name: "Anthropic" }] }} boundariesOn={true} busy={false} onOpenAiSettings={noop} onContinue={noop} />);
    expect(ready).toContain("Anthropic");
    expect(ready).toContain("Model: Claude Sonnet");
    expect(ready).toContain("Hotové");
    expect(ready).toContain('data-lawoss-ai-boundaries="on"');
    expect(ready).toMatch(/<button type="button" class="lw-btn gold">Pokračovať<\/button>/);
  });

  test("Ako agent pracuje: diagram, ukážka karty, predvolené schvaľovanie a YOLO ako samostatná karta so zámkom firmy", () => {
    const state = { yolo: { enabled: false, locked: false, source: "default" as const }, edits: "ask" as const, loading: false };
    const html = renderToStaticMarkup(<ApprovalsStepView text={sk} locale="sk" state={state} canWrite saving={false} failed={false} firmManaged={false} busy={false} onYolo={noop} onAsk={noop} onContinue={noop} />);
    expect(html).toMatch(/aria-label="Postup agenta"/);
    for (const label of ["Prečíta", "Navrhne zmenu", "Vy schválite", "Vykoná"]) expect(html).toContain(label);
    expect(html).toContain("Ukážka karty schválenia");
    expect(html).toMatch(/<input type="radio"[^>]*checked=""[^>]*\/?>\s*<span><strong>[^<]*<svg[\s\S]*?Pýtať sa pred každou zmenou/);
    expect(html).toContain("YOLO: bez pýtania");
    expect(html).not.toContain('role="alertdialog"');
    const locked = renderToStaticMarkup(<ApprovalsStepView text={sk} locale="sk" state={{ ...state, yolo: { enabled: false, locked: true, source: "organization" } }} canWrite saving={false} failed={false} firmManaged={false} busy={false} onYolo={noop} onAsk={noop} onContinue={noop} />);
    expect(locked).toContain("Nastavuje vaša kancelária.");
    expect(locked.match(/<input type="radio"[^>]*disabled=""/g)?.length).toBe(1);
    const allow = renderToStaticMarkup(<ApprovalsStepView text={sk} locale="sk" state={{ ...state, edits: "allow" }} canWrite saving={false} failed={false} firmManaged={false} busy={false} onYolo={noop} onAsk={noop} onContinue={noop} />);
    expect(allow).toContain("Zmeny súborov sa teraz robia bez pýtania");
    expect(allow).toContain(">Pýtať sa pred zmenou</button>");
  });

  test("Pripravené: súhrn so stavmi slovom a jedna prvá úloha", () => {
    const one: WizardConnected = { kind: "clients", root: "/p/C001", clients: [{ root: "/p/C001", name: "C001 SYN Tatran", result: result("w1", "/p/C001") }] };
    const ready = { state: "ready" as const, modelLabel: "Claude Sonnet" };
    const html = renderToStaticMarkup(<ReadySummaryView text={sk} found={found} connected={one} model={ready} agent="ask" busy={false} onGo={noop} onChat={noop} onOverview={noop} onTable={noop} />);
    expect(html).toContain("Klient C001 SYN Tatran");
    expect(html.match(/Hotové/g)).toHaveLength(3);
    expect(html).toContain('data-lawoss-ready-primary="chat"');
    expect(html).toContain("Otvoriť chat s klientom C001 SYN Tatran");
    expect(html).toContain(">Nie, nechaj ho tak, ako je</button>");
    expect(html).toContain("Usporiadať podľa tabuľky");
    // Bez modelu sa chat neponúkne ako prvá úloha; chýbajúca časť má opravu.
    const noAi = renderToStaticMarkup(<ReadySummaryView text={sk} found={found} connected={one} model={{ state: "no-model" }} agent="yolo" busy={false} onGo={noop} onChat={noop} onOverview={noop} />);
    expect(noAi).toContain('data-lawoss-ready-primary="overview"');
    expect(noAi).toContain(">Pripojiť AI</button>");
    expect(noAi).toContain("YOLO: zmeny bez pýtania");
    expect(noAi).toContain("Chýba");
  });
});

describe("sprievodca C1: logika súhrnu a režimu agenta", () => {
  const one: WizardConnected = { kind: "clients", root: "/p/a", clients: [{ root: "/p/a", name: "A", result: result("w1", "/p/a") }] };
  const two: WizardConnected = { kind: "clients", root: "/p", clients: [{ root: "/p/a", name: "A", result: { result: "applied", clientRoot: "/p/a" } }, { root: "/p/b", name: "B", result: result("w2", "/p/b") }] };
  test("prvá úloha podľa predpokladov", () => {
    expect(readyPlan(one, { state: "ready" })).toMatchObject({ primary: "chat", offerTable: true });
    expect(readyPlan(one, { state: "no-model" })).toMatchObject({ primary: "overview", overview: "readyOverview" });
    expect(readyPlan(two, { state: "ready" })).toMatchObject({ primary: "overview", overview: "readyOverviewClients", offerChat: true, chatWith: { name: "B" } });
    expect(readyPlan({ kind: "practice", root: "/p" }, { state: "ready" })).toMatchObject({ primary: "overview", overview: "readyOverviewPractice", offerTable: false });
    expect(readyPlan({ kind: "fresh", root: "/p", result: { result: "applied" } }, { state: "ready" })).toMatchObject({ primary: "addClient" });
    expect(readyPlan(undefined, { state: "ready" })).toMatchObject({ primary: "connectFolder" });
  });
  test("dokončenie odovzdá všetkých klientov s pracovným priečinkom a cieľ pri novej kancelárii", () => {
    expect(readyCompletion(two)).toEqual({ result: result("w2", "/p/b"), completion: { clients: [result("w2", "/p/b")] } });
    expect(readyCompletion({ kind: "practice", root: "/p" })).toEqual({ completion: { workingFolder: "/p" } });
    expect(readyCompletion({ kind: "fresh", root: "/p", result: { result: "applied" } }).completion?.landing).toBe("/klienti");
  });
  test("riadky súhrnu: stav aj oprava", () => {
    const rows = readyRows(sk, { connected: undefined, model: { state: "checking" }, agent: "unknown" });
    expect(rows.map((row) => [row.id, row.tone, row.fix])).toEqual([["docs", "missing", "folder"], ["ai", "checking", undefined], ["approvals", "checking", undefined]]);
  });
  test("režim zmien: nenastavené sa berie ako pýtanie (predvolenie A1), allow ako bez pýtania; zápis len edit a bash", () => {
    expect(editsMode(parseToolPermissions({}))).toBe("ask");
    expect(editsMode(parseToolPermissions({ edit: "allow" }))).toBe("allow");
    expect(editsMode(parseToolPermissions({ edit: "ask", bash: "allow" }))).toBe("allow");
    expect(askPatch({ edit: "allow", bash: "allow", webfetch: "deny", external_directory: { "/x": "allow" } })).toEqual({ edit: "ask", bash: "ask", webfetch: "deny" });
    expect(agentSummary({ yolo: { enabled: true, locked: false, source: "user" }, edits: "ask" })).toBe("yolo");
    expect(agentSummary({ yolo: null, edits: "unknown" })).toBe("unknown");
  });
});

describe("sprievodca C1: texty", () => {
  test("všetky jazyky majú rovnaké kľúče a neprázdne texty bez dlhej pomlčky", () => {
    const keys = Object.keys(WIZARD_TEXT.sk).sort();
    for (const locale of ["cs", "en", "de"] as const) expect(Object.keys(WIZARD_TEXT[locale]).sort()).toEqual(keys);
    for (const locale of ["sk", "cs", "en", "de"] as const) for (const value of Object.values(WIZARD_TEXT[locale])) {
      expect(value.trim().length).toBeGreaterThan(0);
      expect(value).not.toMatch(/[–—]/);
    }
  });
  test("pojmy: Klient/Prípad/Chat, nie vec, spis, projekt ani matter; bez technických slov", () => {
    const banned: Record<string, RegExp> = {
      sk: /\b(vec|veci|spis|spisy|projekt|session|relácia)\b|AGENTS\.md|CLAUDE\.md|klon/i,
      cs: /\b(věc|spis|spisy|projekt|session|relace)\b|AGENTS\.md|CLAUDE\.md|klon/i,
      en: /\b(matter|matters|project|session)\b|AGENTS\.md|clone/i,
      de: /\b(Angelegenheit|Akte|Projekt|Sitzung)\b|AGENTS\.md|Klon/i,
    };
    for (const [locale, pattern] of Object.entries(banned)) for (const [key, value] of Object.entries(WIZARD_TEXT[locale as "sk"])) expect([locale, key, pattern.test(value)]).toEqual([locale, key, false]);
  });
  test("počty v správnom tvare množného čísla", () => {
    expect([1, 2, 5].map((count) => sk("treeCases", { count }))).toEqual(["1 prípad", "2 prípady", "5 prípadov"]);
    expect([1, 3, 12].map((count) => wizardText("cs")("treeFiles", { count }))).toEqual(["1 soubor", "3 soubory", "12 souborů"]);
    expect([1, 2].map((count) => wizardText("en")("treeFilesAtLeast", { count }))).toEqual(["at least 1 file", "at least 2 files"]);
    expect([1, 2].map((count) => wizardText("de")("treeCases", { count }))).toEqual(["1 Fall", "2 Fälle"]);
  });
  test("krátky text: hlavná veta každého kroku do 15 slov", () => {
    for (const key of ["officeLead", "docsLead", "aiLead", "approvalsLead", "readyLead"] as const) expect([key, words(sk(key)) <= 15]).toEqual([key, true]);
  });
});
