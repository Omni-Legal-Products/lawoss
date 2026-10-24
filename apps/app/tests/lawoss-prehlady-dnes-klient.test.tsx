import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { LAYER_OF } from "../../../lawoss/okf-pamat/src/schema.ts";
import type { OkfRecord } from "../../../lawoss/okf-pamat/src/record.ts";
import { buildOverview, type MatterInput, type MatterOverview } from "../../../lawoss/okf/read";
import { shellCs, shellDe, shellEn, shellSk } from "../src/lawoss/i18n/shell";
import { agendaEvents, monthWeeks, shiftMonth } from "../src/lawoss/lite/agenda-model";
import { CARDS_SHOWN, caseCards, inputCounts, matterTerm } from "../src/lawoss/lite/client-cards";
import { ClientOverviewView } from "../src/lawoss/lite/client-overview";
import { liteDeadlineLink, liteMatterLink } from "../src/lawoss/lite/links";
import { TodayView } from "../src/lawoss/lite/pages/today-page";
import { buildToday, caseDates, startHere } from "../src/lawoss/lite/today-model";

// Spec 0020 (lawOSS-like-SK-CZ, 24. 10. 2026): Dnes ako denný briefing s režimom Mesiac, Domov klienta ako portfólio
// prípadov. Typy udalostí: lehota, pracovný termín, návrh na potvrdenie; stretnutia OKF neeviduje.

const TODAY = "2026-10-24";
const UHRADA = "Klienti/Tatran/Spisy/M001-uhrada";
const VADY = "Klienti/Tatran/Spisy/M002-vady";
const record = (id: string, type: string, title: string, extra: Partial<OkfRecord> = {}): OkfRecord => ({
  okf: 1, id, type, title, description: "syntetický záznam", layer: LAYER_OF.task, jurisdiction: "sk", status: "active",
  created: "2026-09-06", updated: "2026-10-22", truth: "", timeline: [], ...extra,
});
const inputs: MatterInput[] = [
  { path: UHRADA, cardFrontmatter: { title: "Úhrada dodávok" }, intake: "| ID | Prijaté | Zdroj | Originál | Stav | Záznamy |\n|---|---|---|---|---|---|\n| IN-001 | 2026-10-01 | mail | [a.pdf](./01_Podklady/IN-001/a.pdf) | processed | M001-E1 |\n| IN-002 | 2026-10-20 | mail | [b.pdf](./01_Podklady/IN-002/b.pdf) | pending | |\n| IN-003 | 2026-10-21 | mail | [c.pdf](./00_Na_zatriedenie/c.pdf) | pending | |",
    records: [
      record("M001-L1", "matter", "Úhrada dodávok", { deadlines: ["2026-10-27 Vyjadrenie k žalobe"] }),
      record("M001-T1", "task", "Doplniť prílohu", { state: "pending", due: "2026-10-24" }),
      record("deadline_m001_odvolanie", "task", "Lehota na odvolanie (návrh)", { state: "pending", deadlines: ["2026-11-05"] }),
    ] },
  { path: VADY, cardFrontmatter: { title: "Vady rekonštrukcie" }, records: [record("M002-T1", "task", "Fotodokumentácia", { state: "pending", due: "2026-10-30" })] },
];
const data = { ...buildOverview(inputs, TODAY), inputs };
const html = (node: ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

describe("udalosti pre mesiac", () => {
  const events = agendaEvents(data);
  test("lehota, pracovný termín a návrh na potvrdenie sú oddelené a návrh nie je lehota", () => {
    expect(events.map((e) => [e.kind, e.date, e.title])).toEqual([
      ["work", "2026-10-24", "Doplniť prílohu"],
      ["deadline", "2026-10-27", "Vyjadrenie k žalobe"],
      ["work", "2026-10-30", "Fotodokumentácia"],
      ["candidate", "2026-11-05", "Lehota na odvolanie (návrh)"],
    ]);
    expect(data.upcomingDeadlines.map((d) => d.date)).toEqual(["2026-10-27"]);
    expect(events.find((e) => e.kind === "deadline")?.link).toBe(liteDeadlineLink(UHRADA, "M001-L1", "2026-10-27"));
    expect(events.find((e) => e.kind === "candidate")?.link).toBe(liteMatterLink(UHRADA));
  });
  test("mesiac od pondelka, prechod roka v oboch smeroch", () => {
    const weeks = monthWeeks("2026-10");
    expect(weeks[0]![0]).toEqual({ iso: "2026-09-28", inMonth: false });
    expect(weeks.at(-1)!.at(-1)).toEqual({ iso: "2026-11-01", inMonth: false });
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
  });
});

describe("Dnes: Začnite tu a režim Mesiac", () => {
  test("poradie kroku: lehota po termíne, lehota dnes, termín dnes, lehota do 7 dní, termín", () => {
    const model = buildToday(data, TODAY);
    const dates = caseDates(model.tasks, TODAY, 14);
    expect(startHere(model.deadlines, dates)).toMatchObject({ kind: "work", item: { title: "Doplniť prílohu" } });
    expect(startHere(model.deadlines, dates.filter((d) => d.daysLeft > 0))).toMatchObject({ kind: "deadline", item: { date: "2026-10-27" } });
    const overdue = buildToday({ ...buildOverview(inputs, "2026-10-28"), inputs }, "2026-10-28");
    expect(startHere(overdue.deadlines, caseDates(overdue.tasks, "2026-10-28", 14))).toMatchObject({ kind: "deadline", item: { tier: "overdue" } });
    expect(startHere([], [])).toBeNull();
  });
  test("Prehľad ukáže prepínač, Začnite tu s odkazom a malý mesiac; Mesiac veľký kalendár a návrhy", () => {
    const props = { model: buildToday(data, TODAY), locale: "sk" as const, now: new Date(`${TODAY}T09:00:00`), events: agendaEvents(data), evidence: { complete: true, recorded: 1, unrecorded: 1 } };
    const overview = html(<TodayView {...props} />);
    expect(overview).toContain('data-lawoss-mode="overview"');
    expect(overview).toContain('data-lawoss-start="work"');
    expect(overview).toContain("Začnite tu");
    expect(overview).toContain('data-lawoss-month="compact"');
    expect(overview).not.toContain("Stretnutia");
    const month = html(<TodayView {...props} initialMode="month" />);
    expect(month).toContain('data-lawoss-month="full"');
    expect(month).toContain('data-lawoss-candidates="1"');
    expect(month).toContain("Návrhy na potvrdenie");
    expect(month).not.toContain('data-lawoss-start');
  });
  test("bez udalostí ostáva Dnes ako doteraz, bez prepínača", () => {
    expect(html(<TodayView model={buildToday(data, TODAY)} locale="sk" />)).not.toContain("data-lawoss-mode");
  });
});

describe("Domov klienta: portfólio prípadov", () => {
  const overview = (count: number): MatterOverview[] => Array.from({ length: count }, (_, i) => ({
    path: `Klienti/Tatran/Spisy/M${i}`, title: `Prípad ${i}`, deadlines: i === 3 ? [{ date: "2026-10-20", title: "Po lehote", recordId: "L" }] : [],
    openTasks: [], counts: { records: 1, evidence: 0, subjects: 0 }, ...(i === 5 ? { lastEvent: { date: "2026-10-22", text: "zmena" } } : {}),
  }));
  test("poradie kariet: po lehote, termín, potom posledná zmena", () => {
    const cards = caseCards(buildOverview(inputs, TODAY).matters, {}, TODAY);
    expect(cards.map((c) => c.matter.title)).toEqual(["Úhrada dodávok", "Vady rekonštrukcie"]);
    expect(matterTerm(cards[0]!.matter, TODAY)).toMatchObject({ kind: "work", date: "2026-10-24" });
    expect(caseCards(overview(7), {}, TODAY).slice(0, 2).map((c) => c.matter.title)).toEqual(["Prípad 3", "Prípad 5"]);
  });
  test("vstupy: spracované, čakajú v prípade, nezaradené; bez registra neevidované", () => {
    expect(inputCounts(inputs, [UHRADA, VADY])).toEqual({ processed: 1, waiting: 1, unfiled: 1 });
    expect(inputCounts([inputs[1]!], [VADY])).toBeNull();
  });
  test("karty: fáza, chýbajúca a zastaraná fáza, šesť kariet a tlačidlo pre ďalšie", () => {
    const matters = overview(7);
    const out = html(<ClientOverviewView workspaceId="tatran" locale="sk" todayIso={TODAY} matters={matters} deadlines={[]} soon={0} inputs={null}
      statuses={{ [matters[0]!.path]: { phase: "Čakáme na vyjadrenie", nextStep: "Doplniť prílohu", stale: true } }} events={[]} />);
    expect(out).toContain("Čakáme na vyjadrenie");
    expect(out).toContain("môže byť neaktuálne");
    expect(out).toContain("Fáza neevidovaná");
    expect(out).toContain("Vstupy nie sú evidované.");
    expect(out).toContain(`Zobraziť všetky prípady (7)`);
    expect(out.match(/class="lw-case"/g)?.length).toBe(CARDS_SHOWN);
    expect(out).toContain('data-lawoss-mode="overview"');
  });
});

test("texty spec 0020 vo všetkých jazykoch, nemčina bez dlhej pomlčky", () => {
  const keys = ["mode_overview", "mode_month", "mode_label", "agenda_kind_deadline", "agenda_kind_work", "agenda_kind_candidate", "agenda_filter_label",
    "agenda_filter_all", "agenda_filter_deadline", "agenda_filter_work", "agenda_filter_candidate", "agenda_title", "agenda_count", "agenda_day_empty",
    "month_prev", "month_next", "month_today", "candidates_title", "candidates_note", "candidates_empty", "start_title", "start_open", "card_phase",
    "card_phase_missing", "card_phase_stale", "card_next_step", "card_no_date", "cards_show_all", "inputs_ring_title", "inputs_processed",
    "inputs_waiting", "inputs_unfiled", "inputs_unrecorded", "next_term_title", "next_term_none"].map((key) => `lawoss.lite.${key}`);
  for (const dict of [shellEn, shellCs, shellSk, shellDe]) for (const key of keys) expect(dict).toHaveProperty([key]);
  expect(Object.entries(shellDe).some(([key, value]) => keys.includes(key) && value.includes("—"))).toBe(false);
});
