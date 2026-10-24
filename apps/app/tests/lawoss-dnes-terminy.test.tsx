import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { LAYER_OF } from "../../../lawoss/okf-pamat/src/schema.ts";
import type { OkfRecord } from "../../../lawoss/okf-pamat/src/record.ts";
import { buildOverview, type MatterInput } from "../../../lawoss/okf/read";
import { deadlineCoverage } from "../../../lawoss/okf/views";
import { TodayView } from "../src/lawoss/lite/pages/today-page";
import { buildToday, caseDates, type TodayTask } from "../src/lawoss/lite/today-model";
import { liteMatterLink } from "../src/lawoss/lite/links";

// N-A2-11 a rozhodnutie MČ 23. 10. 2026: Dnes ukazuje termíny z prípadov (úlohy M049-T1 do 25. 10., M049-T2 do 29. 10.)
// oddelene od evidovaných lehôt a nehovorí „nie sú evidované žiadne lehoty“, kým prípady majú termíny.

const TODAY = "2026-10-24";
const M049 = "Klienti/C017-syn-zuzana-simkova/Spisy/M049-reklamacia";
const task = (id: string, title: string, due?: string): OkfRecord => ({
  okf: 1, id, type: "task", title, description: "syntetický záznam", layer: LAYER_OF.task, jurisdiction: "sk", status: "active",
  created: "2026-09-06", updated: "2026-10-22", truth: "", timeline: [], state: "pending", ...(due ? { due } : {}),
});
const inputs: MatterInput[] = [{ path: M049, cardFrontmatter: { title: "Reklamácia tepelného čerpadla" }, records: [
  task("M049-T1", "Vyžiadať chýbajúcu prílohu", "2026-10-25"), task("M049-T2", "Pripraviť odpoveď dodávateľovi", "2026-10-29"),
  task("M049-T3", "Bez termínu"), task("M049-T4", "Ďaleký termín", "2026-12-01"),
] }];
const data = { ...buildOverview(inputs, TODAY), inputs };
const html = (node: ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
const view = (locale: "sk" | "en" = "sk") => {
  const model = buildToday(data, TODAY);
  return html(<TodayView model={model} locale={locale} now={new Date(`${TODAY}T09:00:00`)} evidence={{ complete: true, ...deadlineCoverage(data.inputs) }} />);
};

describe("Dnes: termíny z prípadov oddelene od lehôt", () => {
  test("termín je úloha s platným dátumom do 14 dní alebo zmeškaná, zoradené podľa dátumu", () => {
    const tasks: TodayTask[] = [
      { key: "a", id: "A", title: "Neskôr", due: "2026-11-06", matters: [] },
      { key: "b", id: "B", title: "Zmeškaná", due: "2026-10-20", matters: [] },
      { key: "c", id: "C", title: "Bez dátumu", matters: [] },
      { key: "d", id: "D", title: "Neplatný", due: "2026-02-30", matters: [] },
      { key: "e", id: "E", title: "Po 14 dňoch", due: "2026-11-07", matters: [] },
      // Pojednávanie s časom sa berie podľa dňa.
      { key: "f", id: "F", title: "Pojednávanie", due: "2026-10-27 10:00", matters: [] },
    ];
    expect(caseDates(tasks, TODAY, 14).map((d) => [d.id, d.due, d.daysLeft])).toEqual([["B", "2026-10-20", -4], ["F", "2026-10-27", 3], ["A", "2026-11-06", 13]]);
  });
  test("bez evidovaných lehôt, ale s termínmi: hlavička a panel nehovoria, že nie je nič evidované", () => {
    expect(deadlineCoverage(data.inputs).recorded).toBe(0);
    const out = view();
    expect(out).toContain("Termín z prípadu: Vyžiadať chýbajúcu prílohu, zajtra. Kým sa na prehľad spoľahnete, skontrolujte prípady.");
    expect(out).not.toContain("V podkladoch prípadov nie sú evidované žiadne lehoty");
    expect(out).toContain('data-lawoss-deadlines="unrecorded_dates"');
    expect(out).not.toContain('data-lawoss-deadlines="unrecorded"');
  });
  test("termíny majú vlastný nadpis, vysvetlenie rozdielu a odkaz na prípad; bez neskorých a bez dátumu", () => {
    const out = view();
    const start = out.indexOf("data-lawoss-case-dates");
    const section = out.slice(start, out.indexOf("</ul></div>", start));
    expect(section).toContain("Termíny z prípadov");
    expect(section).toContain("Nie sú to evidované lehoty");
    expect(section).toContain("Vyžiadať chýbajúcu prílohu");
    expect(section).toContain("Pripraviť odpoveď dodávateľovi");
    expect(section.indexOf("Vyžiadať chýbajúcu prílohu")).toBeLessThan(section.indexOf("Pripraviť odpoveď dodávateľovi"));
    expect(section).not.toContain("Bez termínu");
    expect(section).not.toContain("Ďaleký termín");
    expect(section).toContain(`href="${liteMatterLink(M049)}"`);
    expect(view("en")).toContain("Date from a case: Vyžiadať chýbajúcu prílohu, tomorrow.");
  });
  test("bez termínov ostáva pôvodná veta: naozaj nie je nič evidované", () => {
    const empty: MatterInput[] = [{ path: M049, records: [task("M049-T3", "Bez termínu")] }];
    const d = { ...buildOverview(empty, TODAY), inputs: empty };
    const out = html(<TodayView model={buildToday(d, TODAY)} locale="sk" now={new Date(`${TODAY}T09:00:00`)} evidence={{ complete: true, ...deadlineCoverage(empty) }} />);
    expect(out).toContain("V podkladoch prípadov nie sú evidované žiadne lehoty");
    expect(out).toContain('data-lawoss-deadlines="unrecorded"');
    expect(out).not.toContain("data-lawoss-case-dates");
  });
  test("review: uplynulý termín má prednosť a nie je „po lehote“; „nič nehorí“ nezamlčí termín do 7 dní", () => {
    const passed: MatterInput[] = [{ path: M049, cardFrontmatter: { title: "Reklamácia" }, records: [task("M049-T1", "Uplynulá úloha", "2026-10-20"), task("M049-T2", "Zajtrajšia úloha", "2026-10-25")] }];
    const d1 = { ...buildOverview(passed, TODAY), inputs: passed };
    const out = html(<TodayView model={buildToday(d1, TODAY)} locale="sk" now={new Date(`${TODAY}T09:00:00`)} evidence={{ complete: true, ...deadlineCoverage(passed) }} />);
    expect(out).toContain("Termín z prípadu: Uplynulá úloha, termín uplynul.");
    const start = out.indexOf("data-lawoss-case-dates");
    const section = out.slice(start, out.indexOf("</ul></div>", start));
    expect(section).toContain(">termín uplynul<");
    expect(section).not.toContain("po lehote");
    // Prípad lehoty eviduje (žiadna do 7 dní), ale termín úlohy je zajtra: hlavička ho povie, nie „nič nehorí“.
    const recorded: MatterInput[] = [{ path: M049, cardFrontmatter: { title: "Reklamácia" }, records: [
      { ...task("M049-D9", "Lehota o mesiac"), type: "deadline", deadlines: ["2026-11-30"] },
      task("M049-T2", "Zajtrajšia úloha", "2026-10-25"),
    ] }];
    const d2 = { ...buildOverview(recorded, TODAY), inputs: recorded };
    const calm = html(<TodayView model={buildToday(d2, TODAY)} locale="sk" now={new Date(`${TODAY}T09:00:00`)} evidence={{ complete: true, ...deadlineCoverage(recorded) }} />);
    expect(deadlineCoverage(recorded).recorded).toBe(1);
    expect(calm).toContain("V evidovaných lehotách tento týždeň nič nehorí. Termín z prípadu: Zajtrajšia úloha, zajtra.");
    expect(calm).not.toContain("Dobrá chvíľa predbehnúť prácu");
  });
  test("#242: termín nezakryje počet prípadov bez lehôt; úloha s vlastnou lehotou nie je druhýkrát medzi termínmi", () => {
    const OTHER = "Klienti/C017-syn-zuzana-simkova/Spisy/M050-bez-lehot";
    const mixed: MatterInput[] = [
      { path: M049, cardFrontmatter: { title: "Reklamácia" }, records: [
        { ...task("M049-D9", "Lehota o mesiac"), type: "deadline", deadlines: ["2026-11-30"] },
        task("M049-T2", "Zajtrajšia úloha", "2026-10-25"),
        { ...task("M049-T5", "Úloha s lehotou", "2026-10-26"), deadlines: ["2026-10-30 Odvolanie"] },
      ] },
      { path: OTHER, cardFrontmatter: { title: "Bez lehôt" }, records: [] },
    ];
    const d = { ...buildOverview(mixed, TODAY), inputs: mixed };
    const model = buildToday(d, TODAY);
    expect(model.deadlines.map((x) => x.recordId)).toContain("M049-T5");
    expect(caseDates(model.tasks, TODAY, 14, model.deadlines).map((x) => x.id)).toEqual(["M049-T2"]);
    const coverage = deadlineCoverage(mixed);
    expect([coverage.recorded, coverage.unrecorded]).toEqual([1, 1]);
    // Bez lehôt do 7 dní: prvá veta s počtom prípadov bez lehôt, druhá s termínom.
    const farOnly = { ...model, deadlines: model.deadlines.filter((x) => x.recordId === "M049-D9") };
    const out = html(<TodayView model={farOnly} locale="sk" now={new Date(`${TODAY}T09:00:00`)} evidence={{ complete: true, ...coverage }} />);
    expect(out).toContain("Prípady bez evidovaných lehôt: 1. Termín z prípadu: Zajtrajšia úloha, zajtra.");
  });
});
