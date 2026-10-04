import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { buildTimeline, groupFacts, LiteMatterView, type LiteCockpit } from "../src/lawoss/lite/pages/matter-page";
import { TodayView } from "../src/lawoss/lite/pages/today-page";
import { ClientsView } from "../src/lawoss/lite/pages/clients-page";
import { LiteNavView } from "../src/lawoss/lite/lite-nav";
import { OkfPageState } from "../src/lawoss/domains/okf-page";
import { SidebarProvider } from "@/components/ui/sidebar";
import { deadlineAnchor, LiveStamp, matterUrgency } from "../src/lawoss/lite/live";
import { daysUntil, deadlineText, isCalendarDay, urgencyOf } from "../src/lawoss/okf/view-rules";
import { okfRefreshInterval } from "../src/lawoss/okf/read-model";
import { deadlineTier } from "../../../lawoss/okf/read";
import { liteDeadlineLink } from "../src/lawoss/lite/links";
import { addDays, today } from "../src/lawoss/okf/read-model";
import { buildOverview, deadlineLabel, recordDeadlines, type MatterInput } from "../../../lawoss/okf/read";
import { buildCockpit } from "../../../lawoss/okf/cockpit";
import { buildToday, groupByClient } from "../src/lawoss/lite/today-model";
import { LAYER_OF } from "../../../lawoss/okf-pamat/src/schema.ts";
import type { OkfRecord } from "../../../lawoss/okf-pamat/src/record.ts";
import type { CockpitDeadline, CockpitEvent, CockpitFact } from "../../../lawoss/okf/cockpit";

/**
 * Pohľady z OKF sú dynamické: skladajú sa z toho, čo je v súboroch, vrátane vlastných
 * typov agenta, a prázdne sekcie sa neukazujú.
 */
const html = (node: ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
const NOW = today();
const matter = { path: "Klienti/Novák/Spisy/A", title: "Novák - vymáhanie", matterRef: "12Cb/45/2026", deadlines: [], openTasks: [], counts: { records: 3, evidence: 0, subjects: 1 } };
const fact = (id: string, kind: string, title: string): CockpitFact => ({ id, kind, title, provenance: "zapísané", file: "f" });
const deadline = (recordId: string, days: number, over: Partial<CockpitDeadline> = {}): CockpitDeadline =>
  ({ date: addDays(NOW, days), title: "Spis", recordId, provenance: "zapísané", file: "f", overdue: days < 0, confirmed: true, ...over });

describe("dynamické pohľady z OKF", () => {
  test("text lehoty za dátumom, inak nič", () => {
    expect(deadlineLabel("2026-10-09 Lehota na vyjadrenie k žalobe")).toBe("Lehota na vyjadrenie k žalobe");
    expect(deadlineLabel("2026-10-09: Pojednávanie")).toBe("Pojednávanie");
    expect(deadlineLabel("2026-10-09")).toBeUndefined();
    expect(deadlineLabel(undefined)).toBeUndefined();
  });

  test("Čo vieme: skupiny podľa typu v poradí výskytu, aj vlastný typ agenta", () => {
    const groups = groupFacts([fact("E-1", "dôkaz", "Faktúra"), fact("X-1", "hearing_note", "Poznámka z pojednávania"), fact("E-2", "dôkaz", "Dodací list")]);
    expect(groups.map((g) => [g.label, g.facts.length])).toEqual([["Dôkaz", 2], ["Hearing note", 1]]);
  });

  test("časová os: budúce lehoty nad dneškom, história pod ním, bez obsahu nič", () => {
    const events: CockpitEvent[] = [{ date: addDays(NOW, -3), text: "Žaloba podaná", recordId: "M-1", file: "f" }];
    const line = buildTimeline(events, [deadline("M-1", 5, { label: "Vyjadrenie" }), deadline("M-1", 1, { label: "Doplniť plnú moc" })], NOW);
    expect(line.map((entry) => (entry.kind === "today" ? "DNES" : entry.text))).toEqual(["Vyjadrenie", "Doplniť plnú moc", "DNES", "Žaloba podaná"]);
    expect(buildTimeline([], [], NOW)).toEqual([]);
  });

  test("detail veci: vlastný typ agenta, pravda záznamu, odpočet a len sekcie s obsahom", () => {
    const cockpit: LiteCockpit = {
      deadlines: { confirmed: [deadline("M-1", 2, { label: "Lehota na vyjadrenie" })], candidates: [] },
      tasks: [],
      attention: [],
      facts: [fact("X-1", "hearing_note", "Poznámka z pojednávania")],
      parties: [],
      events: [],
    };
    const out = html(<LiteMatterView matter={matter} cockpit={cockpit} busy={null} error={null} onAction={() => {}} truths={{ "X-1": "Súd odročil na november." }} client="Novák" />);
    expect(out).toContain("Hearing note");
    expect(out).toContain("Súd odročil na november.");
    expect(out).toContain("Lehota na vyjadrenie");
    expect(out).toContain("lw-matter-countdown");
    expect(out).toContain(">Novák<");
    // Žiadne subjekty ani čakajúce záznamy: ich sekcie sa vôbec nevykreslia.
    expect(out).not.toContain("data-lawoss-parties");
    expect(out).not.toContain("lw-matter-attention");
  });

  test("Dnes: pás 14 dní nesie lehoty aj termíny úloh", () => {
    const m = { ...matter, deadlines: [] };
    const out = html(<TodayView locale="en" model={{
      deadlines: [{ date: addDays(NOW, 3), title: "Spis", raw: `${addDays(NOW, 3)} Odvolanie`, recordId: "D-1", matter: m, tier: "soon", daysLeft: 3 }],
      tasks: [{ key: "t", id: "T-1", title: "Plná moc", due: addDays(NOW, 1), matters: [{ path: m.path, title: m.title }] }],
      inputs: [],
      recent: [m],
    }} />);
    expect(out).toContain("Odvolanie");
    expect(out).toContain('data-kind="task"');
    expect(out).toContain('data-urgency="near"');
    expect((out.match(/class="lw-today-day"/g) ?? []).length).toBe(14);
  });

  test("Dnes a detail veci z toho istého OKF súboru ukazujú to isté", () => {
    const record: OkfRecord = {
      okf: 1, id: "M-1", type: "matter", title: "Vymáhanie faktúry", description: "syntetický záznam", layer: LAYER_OF.matter,
      jurisdiction: "sk", status: "active", created: NOW, updated: NOW, truth: "Žaloba podaná.", timeline: [],
      deadlines: [`${addDays(NOW, 2)} Lehota na vyjadrenie`, `${addDays(NOW, 9)} Pojednávanie`, `${addDays(NOW, 40)} Mimo okna`],
    };
    const inputs: MatterInput[] = [{ path: "Klienti/Novák/A", records: [record] }];
    const overview = buildOverview(inputs, NOW);
    const data = { ...overview, inputs, problems: [], truncated: false };
    const today = html(<TodayView locale="en" model={buildToday(data, NOW)} />);
    const cockpit = buildCockpit(data, "Klienti/Novák/A", NOW)!;
    const page = html(<LiteMatterView matter={overview.matters[0]!} cockpit={cockpit} busy={null} error={null} onAction={() => {}} />);
    const detail = page.slice(page.indexOf('id="lite-panel-overview"'), page.indexOf('id="lite-panel-known"'));
    for (const out of [today, detail]) {
      expect(out).toContain("Lehota na vyjadrenie");
      expect(out).toContain("Pojednávanie");
      // Rovnaké okno: lehota za 40 dní nie je ani v jednom prehľade.
      expect(out).not.toContain("Mimo okna");
    }
    // Rovnaká naliehavosť tej istej lehoty: o 2 dni je „blízko" v oboch pohľadoch.
    const urgencyNear = (out: string, label: string) => new RegExp(`data-urgency="near"[^]*?${label}`).test(out);
    expect(urgencyNear(today, "Lehota na vyjadrenie")).toBe(true);
    expect(urgencyNear(detail, "Lehota na vyjadrenie")).toBe(true);
  });

  test("rýchle vylepšenia: odkaz na lehotu, body naliehavosti, karty klientov, staršia história", () => {
    // Odkaz z Dnes nesie lehotu a cieľ v detaile má tú istú kotvu.
    expect(liteDeadlineLink("Klienti/A", "M-1", "2026-10-09")).toContain("&lehota=M-1%402026-10-09");
    expect(deadlineAnchor("M-1", "2026-10-09")).toBe("lehota-M-1-2026-10-09");
    // Naliehavosť veci pre bočný panel a klientov: po lehote horí, o 2 dni sa blíži, o 10 dní nič.
    expect(matterUrgency([{ date: addDays(NOW, -1) }], NOW)).toBe("hot");
    expect(matterUrgency([{ date: addDays(NOW, 2) }], NOW)).toBe("near");
    expect(matterUrgency([{ date: addDays(NOW, 10) }], NOW)).toBeUndefined();
    const nav = html(<SidebarProvider><LiteNavView recent={[{ path: "a", title: "Vec A", deadlines: [{ date: addDays(NOW, 1) }] }, { path: "b", title: "Vec B", deadlines: [] }]} /></SidebarProvider>);
    expect(nav.match(/lw-nav-urgency/g) ?? []).toHaveLength(1);
    const clients = html(<ClientsView locale="en" groups={[{ key: "client:Novák", client: "Novák", matters: [{ ...matter, deadlines: [{ date: addDays(NOW, 3), title: "x", recordId: "M-1" }] }] }]} />);
    expect(clients).toContain("Novák");
    expect(clients).toContain('data-urgency="near"');
    // Detail: deadline má kotvu, dlhá história sa skryje za „Show older“.
    const events: CockpitEvent[] = Array.from({ length: 11 }, (_, i) => ({ date: addDays(NOW, -i - 1), text: `Udalosť ${i}`, recordId: "M-1", file: "f" }));
    const cockpit: LiteCockpit = { deadlines: { confirmed: [deadline("M-1", 2)], candidates: [] }, tasks: [], attention: [], facts: [], parties: [], events };
    const page = html(<LiteMatterView matter={matter} cockpit={cockpit} busy={null} error={null} onAction={() => {}} />);
    expect(page).toContain(`id="${deadlineAnchor("M-1", addDays(NOW, 2))}"`);
    expect(page).toContain("Show older (3)");
  });

  test("Klienti: klient v koreni priečinka sa volá podľa svojej karty, veci sú pod ním spolu", () => {
    const a = { ...matter, path: "Obchodné právo/A", title: "Vec A" };
    const b = { ...matter, path: "Obchodné právo/B", title: "Vec B" };
    const inputs = [a, b].map((m) => ({ path: m.path, scopePaths: [m.path, "", "Office"], clientTitle: "Novák s. r. o." }));
    const groups = groupByClient([a, b], inputs);
    expect(groups.map((g) => [g.client, g.matters.length])).toEqual([["Novák s. r. o.", 2]]);
  });

  test("hraničné prípady: pravidlá naliehavosti sú tie isté ako vrstva OKF a režim Pro", () => {
    for (const days of [-30, -1, 0, 1, 2, 7, 8, 40]) {
      const date = addDays(NOW, days);
      const tier = deadlineTier(date, NOW);
      const expected = tier === "overdue" || tier === "today" ? "hot" : tier === "soon" ? "near" : "calm";
      expect(urgencyOf(date, NOW)).toBe(expected);
    }
    // Nemožný dátum nie je 2. marec, ale lehota na overenie.
    expect(isCalendarDay("2026-02-30")).toBe(false);
    expect(isCalendarDay("2028-02-29")).toBe(true);
    expect(urgencyOf("2026-02-30", NOW)).toBe("hot");
    expect(urgencyOf("budúci týždeň", NOW)).toBe("hot");
    expect(Number.isNaN(daysUntil(NOW, "2026-02-30"))).toBe(true);
    // Prázdny alebo len medzerový text lehoty nikdy neukáže prázdny riadok.
    expect(deadlineText({ title: "  ", raw: "2026-10-09   ", recordId: "Q-9" })).toBe("Q-9");
    expect(deadlineText({ title: "Spis", raw: "2026-10-09 ", recordId: "Q-9" })).toBe("Spis");
  });

  test("hraničné prípady: obnova sa pri pomalom čítaní predĺži, najviac na 2 minúty", () => {
    expect(okfRefreshInterval(undefined)).toBe(15_000);
    expect(okfRefreshInterval(800)).toBe(15_000);
    expect(okfRefreshInterval(4_000)).toBe(40_000);
    expect(okfRefreshInterval(60_000)).toBe(120_000);
  });

  test("hraničné prípady: zlyhané obnovenie povie, z kedy sú údaje", () => {
    const out = html(<LiveStamp locale="en" meta={{ checkedAt: Date.UTC(2026, 9, 4, 8, 5), changedAt: 1, failed: true }} />);
    expect(out).toContain("Couldn&#x27;t refresh, showing data from");
    expect(out).toContain("data-stale");
    expect(html(<LiveStamp locale="en" meta={{ checkedAt: 0, changedAt: 0 }} />)).toBe("");
  });

  test("hraničné prípady: dve rovnaké lehoty v jeden deň, prázdny typ, lehota po termíne v odpočte", () => {
    const twice = deadline("M-1", 2, { label: "Vyjadrenie" });
    const cockpit: LiteCockpit = {
      deadlines: { confirmed: [twice, { ...twice, label: "Plná moc" }, deadline("M-1", -3, { label: "Zmeškaná" })], candidates: [] },
      tasks: [], attention: [], facts: [fact("Z-1", "", "Bez typu")], parties: [], events: [],
    };
    const page = html(<LiteMatterView matter={matter} cockpit={cockpit} busy={null} error={null} onAction={() => {}} />);
    expect(page.split(`id="${deadlineAnchor("M-1", addDays(NOW, 2))}"`).length - 1).toBe(1);
    expect(page).toContain("Other records");
    expect(page).toContain("+1 overdue");
  });

  test("hraničné prípady: Dnes s lehotou po termíne a s veľa lehotami v jeden deň", () => {
    const m = { ...matter };
    const day = addDays(NOW, 4);
    const many = Array.from({ length: 9 }, (_, i) => ({ date: day, title: "Spis", raw: `${day} Lehota ${i}`, recordId: `D-${i}`, matter: m, tier: "soon" as const, daysLeft: 4 }));
    const out = html(<TodayView locale="en" model={{
      deadlines: [{ date: addDays(NOW, -2), title: "Spis", raw: `${addDays(NOW, -2)} Zmeškaná`, recordId: "O-1", matter: m, tier: "overdue", daysLeft: -2 }, ...many],
      tasks: [], inputs: [], recent: [m],
    }} />);
    expect(out).toContain("Past due: Zmeškaná.");
    expect(out).toContain("+6");
    expect(out).toContain("+3 more");
  });

  test("review: lehota kancelárie nerozsvieti každú vec, v Dnes je raz ako „Office“", () => {
    expect(matterUrgency([{ date: addDays(NOW, 1), file: "Office/memory/T-1.md" }], NOW)).toBeUndefined();
    expect(matterUrgency([{ date: addDays(NOW, 1), file: "Klienti/A/memory/T-1.md" }], NOW)).toBe("hot");
    const m = (i: number) => ({ ...matter, path: `Klienti/K/V${i}`, title: `Vec ${i}` });
    const out = html(<TodayView locale="en" model={{
      deadlines: [{ date: addDays(NOW, 3), title: "DPH", raw: `${addDays(NOW, 3)} Daňové priznanie`, recordId: "O-1", file: "Office/memory/O-1.md", matter: m(0), alsoIn: [m(1), m(2), m(3)], tier: "soon", daysLeft: 3 }],
      tasks: [{ key: "t", id: "T-1", title: "Spoločná úloha", matters: [m(0), m(1), m(2), m(3)].map((x) => ({ path: x.path, title: x.title })) }],
      inputs: [], recent: [],
    }} />);
    expect(out).toContain(">Office");
    expect(out).not.toContain("Vec 3</");
    expect(out).toContain("+2 more");
  });

  test("review: hotová úloha už nenesie lehotu, ktorá by navždy horela", () => {
    const task = { okf: 1 as const, id: "T-1", type: "task" as const, title: "Podať", description: "d", layer: LAYER_OF.task, jurisdiction: "sk" as const, status: "active" as const,
      created: NOW, updated: NOW, truth: "", timeline: [], deadlines: [`${addDays(NOW, -5)} Podanie`] };
    expect(recordDeadlines({ ...task, state: "done" } as OkfRecord)).toEqual([]);
    expect(recordDeadlines({ ...task, state: "open" } as OkfRecord)).toHaveLength(1);
  });

  test("review: dvaja klienti s rovnakým menom ostanú dve karty s rôznym kľúčom", () => {
    const a = { ...matter, path: "Klienti/Novák/A", title: "A" };
    const b = { ...matter, path: "Archiv/Novák/B", title: "B" };
    const groups = groupByClient([a, b], [
      { path: a.path, scopePaths: [a.path, "Klienti/Novák"] },
      { path: b.path, scopePaths: [b.path, "Archiv/Novák"] },
    ]);
    expect(groups.map((g) => g.client)).toEqual(["Novák", "Novák"]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(2);
    // Klient v koreni bez názvu v karte nedostane meno podľa veci.
    const root = groupByClient([a], [{ path: a.path, scopePaths: [a.path, ""] }]);
    expect(root[0]?.client).toBe("");
    expect(html(<ClientsView locale="en" groups={root} />)).toContain(">Client</h2>");
  });

  test("review: lehota so zdrojom ukazuje aj dátum, text lehoty bez dlhej pomlčky na začiatku", () => {
    const cockpit: LiteCockpit = { deadlines: { confirmed: [deadline("M-1", 12, { label: "Pojednávanie", source: "Predvolanie.pdf" })], candidates: [] }, tasks: [], attention: [], facts: [], parties: [], events: [] };
    const page = html(<LiteMatterView matter={matter} cockpit={cockpit} busy={null} error={null} onAction={() => {}} />);
    expect(page).toMatch(/\d+\/\d+ · Predvolanie\.pdf|\d+\. \d+\. · Predvolanie\.pdf|· Predvolanie\.pdf/);
    expect(deadlineLabel("2026-10-09 \u2014 Pojednávanie")).toBe("Pojednávanie");
  });

  test("review: názov veci z medzier padne na názov priečinka", () => {
    const overview = buildOverview([{ path: "Klienti/K/Vec X", records: [], cardFrontmatter: { title: "   " } }], NOW);
    expect(overview.matters[0]?.title).toBe("Vec X");
  });

  test("review: lehota na zajtra má ten istý slovný termín v Dnes aj v odpočte detailu", () => {
    const record: OkfRecord = {
      okf: 1, id: "M-1", type: "matter", title: "Vec", description: "d", layer: LAYER_OF.matter, jurisdiction: "sk", status: "active",
      created: NOW, updated: NOW, truth: "", timeline: [], deadlines: [`${addDays(NOW, 1)} Odvolanie`],
    };
    const inputs: MatterInput[] = [{ path: "K/A", records: [record] }];
    const overview = buildOverview(inputs, NOW);
    const data = { ...overview, inputs, problems: [], truncated: false };
    const today = html(<TodayView locale="en" model={buildToday(data, NOW)} />);
    const page = html(<LiteMatterView matter={overview.matters[0]!} cockpit={buildCockpit(data, "K/A", NOW)!} busy={null} error={null} onAction={() => {}} />);
    expect(today).toContain(">tomorrow<");
    expect(page).toContain(">tomorrow<");
    expect(page).not.toContain("in 1 day");
  });

  test("D1: prvé spustenie bez workspace otvorí onboarding, vracajúci sa používateľ vidí výzvu", () => {
    const base = { connection: "ready" as const, workspace: null, error: null, data: undefined, loading: false };
    const first = html(<OkfPageState {...base} firstRun>{() => "dashboard"}</OkfPageState>);
    expect(first).not.toContain("lw-empty");
    const back = html(<OkfPageState {...base} firstRun={false}>{() => "dashboard"}</OkfPageState>);
    expect(back).toContain("lw-empty");
    expect(back).toContain('href="/welcome"');
  });
});
