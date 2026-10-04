import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { buildTimeline, groupFacts, LiteMatterView, type LiteCockpit } from "../src/lawoss/lite/pages/matter-page";
import { TodayView } from "../src/lawoss/lite/pages/today-page";
import { ClientsView } from "../src/lawoss/lite/pages/clients-page";
import { LiteNavView } from "../src/lawoss/lite/lite-nav";
import { SidebarProvider } from "@/components/ui/sidebar";
import { deadlineAnchor, matterUrgency } from "../src/lawoss/lite/live";
import { liteDeadlineLink } from "../src/lawoss/lite/links";
import { addDays, today } from "../src/lawoss/okf/read-model";
import { buildOverview, deadlineLabel, type MatterInput } from "../../../lawoss/okf/read";
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
    const clients = html(<ClientsView locale="en" groups={[{ client: "Novák", matters: [{ ...matter, deadlines: [{ date: addDays(NOW, 1), title: "x", recordId: "M-1" }] }] }]} />);
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
});
