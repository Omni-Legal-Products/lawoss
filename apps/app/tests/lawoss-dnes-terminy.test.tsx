import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { LAYER_OF } from "../../../lawoss/okf-pamat/src/schema.ts";
import type { OkfRecord } from "../../../lawoss/okf-pamat/src/record.ts";
import { buildOverview, type MatterInput } from "../../../lawoss/okf/read";
import { deadlineCoverage } from "../../../lawoss/okf/views";
import { TodayView } from "../src/lawoss/lite/pages/today-page";
import { ClientOverviewView } from "../src/lawoss/lite/client-overview";
import { buildToday, caseDates, type TodayTask } from "../src/lawoss/lite/today-model";
import { liteMatterLink } from "../src/lawoss/lite/links";
import { agendaEvents } from "../src/lawoss/lite/agenda-model";

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
/** Sekcia „Čo horí“ (alfa 14): lehoty a termíny z prípadov v jednom zozname, termín so štítkom „pracovný termín“. */
const hot = (out: string) => out.slice(out.indexOf('aria-labelledby="lw-dnes-hot"'), out.indexOf("</section>", out.indexOf('aria-labelledby="lw-dnes-hot"')));
const lead = (out: string) => out.match(/<p class="lw-today-lead">(.*?)<\/p>/)?.[1] ?? "";
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
  test("bez evidovaných lehôt, ale s termínmi: úvod povie termín, „Čo horí“ termíny ukáže s tichou výhradou", () => {
    expect(deadlineCoverage(data.inputs).recorded).toBe(0);
    const out = view();
    expect(lead(out)).toBe("Termín z prípadu: Vyžiadať chýbajúcu prílohu, zajtra.");
    expect(out).not.toContain("V podkladoch prípadov nie sú evidované žiadne lehoty");
    expect(hot(out)).toContain('data-lawoss-deadlines="unrecorded_dates"');
    expect(out).not.toContain('data-lawoss-deadlines="unrecorded"');
  });
  test("termíny sú v „Čo horí“ so štítkom „pracovný termín“ a odkazom na prípad; bez neskorých a bez dátumu", () => {
    const out = view();
    const section = hot(out);
    expect(section.match(/data-kind="case-date"/g)).toHaveLength(2);
    expect(section).toContain(">pracovný termín<");
    expect(section).not.toContain(">evidovaná<");
    expect(section).toContain("Vyžiadať chýbajúcu prílohu");
    expect(section).toContain("Pripraviť odpoveď dodávateľovi");
    expect(section.indexOf("Vyžiadať chýbajúcu prílohu")).toBeLessThan(section.indexOf("Pripraviť odpoveď dodávateľovi"));
    expect(section).not.toContain("Bez termínu");
    expect(section).not.toContain("Ďaleký termín");
    expect(section).toContain(`href="${liteMatterLink(M049)}"`);
    expect(lead(view("en"))).toBe("Date from a case: Vyžiadať chýbajúcu prílohu, tomorrow.");
  });
  test("bez termínov ostáva pôvodná veta: naozaj nie je nič evidované", () => {
    const empty: MatterInput[] = [{ path: M049, records: [task("M049-T3", "Bez termínu")] }];
    const d = { ...buildOverview(empty, TODAY), inputs: empty };
    const out = html(<TodayView model={buildToday(d, TODAY)} locale="sk" now={new Date(`${TODAY}T09:00:00`)} evidence={{ complete: true, ...deadlineCoverage(empty) }} />);
    expect(lead(out)).toBe("Lehoty nie sú v podkladoch evidované.");
    expect(hot(out)).toContain('data-lawoss-deadlines="unrecorded"');
    expect(out).not.toContain('data-kind="case-date"');
  });
  test("review: uplynulý termín má prednosť a nie je „po lehote“; úvod nezamlčí termín do 7 dní", () => {
    const passed: MatterInput[] = [{ path: M049, cardFrontmatter: { title: "Reklamácia" }, records: [task("M049-T1", "Uplynulá úloha", "2026-10-20"), task("M049-T2", "Zajtrajšia úloha", "2026-10-25")] }];
    const d1 = { ...buildOverview(passed, TODAY), inputs: passed };
    const out = html(<TodayView model={buildToday(d1, TODAY)} locale="sk" now={new Date(`${TODAY}T09:00:00`)} evidence={{ complete: true, ...deadlineCoverage(passed) }} />);
    expect(lead(out)).toBe("Termín z prípadu: Uplynulá úloha, termín uplynul.");
    const section = hot(out);
    expect(section.indexOf("Uplynulá úloha")).toBeLessThan(section.indexOf("Zajtrajšia úloha"));
    expect(section).toContain("<b>!</b><span>po termíne</span>");
    expect(section).not.toContain("po lehote");
    // Prípad lehoty eviduje (žiadna do 7 dní), ale termín úlohy je zajtra: hlavička ho povie, nie „nič nehorí“.
    const recorded: MatterInput[] = [{ path: M049, cardFrontmatter: { title: "Reklamácia" }, records: [
      { ...task("M049-D9", "Lehota o mesiac"), type: "deadline", deadlines: ["2026-11-30"] },
      task("M049-T2", "Zajtrajšia úloha", "2026-10-25"),
    ] }];
    const d2 = { ...buildOverview(recorded, TODAY), inputs: recorded };
    const calm = html(<TodayView model={buildToday(d2, TODAY)} locale="sk" now={new Date(`${TODAY}T09:00:00`)} evidence={{ complete: true, ...deadlineCoverage(recorded) }} />);
    expect(deadlineCoverage(recorded).recorded).toBe(1);
    expect(lead(calm)).toBe("Termín z prípadu: Zajtrajšia úloha, zajtra.");
    expect(calm).not.toContain("nič nehorí");
  });
  test("#242: počet prípadov bez lehôt je tichý riadok pod „Čo horí“ (aj v Mesiaci); úloha s vlastnou lehotou nie je druhýkrát", () => {
    const OTHER = "Klienti/C017-syn-zuzana-simkova/Spisy/M050-bez-lehot";
    const mixed: MatterInput[] = [
      { path: M049, cardFrontmatter: { title: "Reklamácia" }, records: [
        { ...task("M049-D9", "Lehota o mesiac"), type: "deadline", deadlines: ["2026-11-30"] },
        task("M049-T2", "Zajtrajšia úloha", "2026-10-25"),
        { ...task("M049-T5", "Úloha s lehotou", "2026-10-30"), deadlines: ["2026-10-30 Odvolanie"] },
      ] },
      { path: OTHER, cardFrontmatter: { title: "Bez lehôt" }, records: [] },
    ];
    const d = { ...buildOverview(mixed, TODAY), inputs: mixed };
    const model = buildToday(d, TODAY);
    expect(model.deadlines.map((x) => x.recordId)).toContain("M049-T5");
    expect(caseDates(model.tasks, TODAY, 14, model.deadlines).map((x) => x.id)).toEqual(["M049-T2"]);
    const coverage = deadlineCoverage(mixed);
    expect([coverage.recorded, coverage.unrecorded]).toEqual([1, 1]);
    // Rozhodnutie MČ č. 6 (alfa 14): údaj sa z úvodu presunul pod „Čo horí“; nesmie zmiznúť ani pri termíne.
    const farOnly = { ...model, deadlines: model.deadlines.filter((x) => x.recordId === "M049-D9") };
    const props = { model: farOnly, locale: "sk" as const, now: new Date(`${TODAY}T09:00:00`), evidence: { complete: true, ...coverage } };
    const out = html(<TodayView {...props} />);
    expect(lead(out)).toBe("Termín z prípadu: Zajtrajšia úloha, zajtra.");
    const section = hot(out);
    expect(section).toContain('<p class="lw-dnes-quiet" data-lawoss-unrecorded="1">');
    expect(section).toContain("Prípady bez evidovaných lehôt: 1.");
    expect(section.indexOf("Zajtrajšia úloha")).toBeLessThan(section.indexOf("Prípady bez evidovaných lehôt"));
    // Aj bez jediného riadku v „Čo horí“ a v režime Mesiac.
    const empty = html(<TodayView {...props} model={{ ...farOnly, deadlines: [], tasks: [] }} />);
    expect(hot(empty)).toContain("Prípady bez evidovaných lehôt: 1.");
    const month = html(<TodayView {...props} events={agendaEvents(d)} initialMode="month" />);
    expect(month).toContain('data-lawoss-month="full"');
    expect(month).toContain("Prípady bez evidovaných lehôt: 1.");
    // Bez úplného čítania počet netvrdí (neprečítaný prípad nie je „bez lehôt“).
    expect(html(<TodayView {...props} evidence={{ ...props.evidence, complete: false }} />)).not.toContain("data-lawoss-unrecorded");
  });
});

describe("#251: termín úlohy s inou evidovanou lehotou", () => {
  // Repro z issue: zajtrajšie pojednávanie, evidovaná lehota toho istého záznamu až o 10 dní (tier `later`).
  const hearing: MatterInput[] = [{ path: M049, cardFrontmatter: { title: "Reklamácia" }, records: [
    { ...task("M1-T1", "Pojednávanie", "2026-10-25"), deadlines: ["2026-11-03 Odvolanie"] },
  ] }];
  const d = { ...buildOverview(hearing, TODAY), inputs: hearing };
  const model = buildToday(d, TODAY);

  test("P2: zajtrajší termín ostane medzi termínmi aj v úvode", () => {
    expect(model.deadlines.map((x) => [x.recordId, x.date, x.tier])).toEqual([["M1-T1", "2026-11-03", "later"]]);
    expect(caseDates(model.tasks, TODAY, 14, model.deadlines).map((x) => [x.id, x.due])).toEqual([["M1-T1", "2026-10-25"]]);
    const out = html(<TodayView model={model} locale="sk" now={new Date(`${TODAY}T09:00:00`)} evidence={{ complete: true, ...deadlineCoverage(hearing) }} />);
    expect(lead(out)).toBe("Termín z prípadu: Pojednávanie, zajtra.");
    // V „Čo horí“ je zajtrajší termín aj vzdialenejšia lehota, každý raz.
    expect(hot(out).match(/data-kind="case-date"/g)).toHaveLength(1);
    expect(hot(out).match(/data-kind="deadline"/g)).toHaveLength(1);
  });

  test("P3: os dní ukáže záznam s lehotou v ten istý deň raz, iný deň termínu úlohy osobitne", () => {
    const same: MatterInput[] = [{ path: M049, cardFrontmatter: { title: "Reklamácia" }, records: [
      { ...task("M2-T1", "Odvolanie podať", "2026-10-27"), deadlines: ["2026-10-27 Odvolanie"] },
    ] }];
    const sd = { ...buildOverview(same, TODAY), inputs: same };
    const strip = html(<TodayView model={buildToday(sd, TODAY)} locale="sk" now={new Date(`${TODAY}T09:00:00`)} />);
    const day = strip.match(/<li[^>]*data-busy[^>]*>.*?<\/li>/g) ?? [];
    expect(day).toHaveLength(1);
    expect(day[0]!.match(/<i /g)).toHaveLength(1);
    expect(day[0]).not.toContain('data-kind="task"');
    // Zajtrajší termín a lehota o 10 dní sú na osi dva rôzne dni.
    const both = html(<TodayView model={model} locale="sk" now={new Date(`${TODAY}T09:00:00`)} />);
    expect(both.match(/<li[^>]*data-busy[^>]*>.*?<\/li>/g)?.map((cell) => cell.includes('data-kind="task"'))).toEqual([true, false]);
  });

  test("dátum úlohy platí tým istým pravidlom ako lehota: neplatný zápis nie je termínom ani druhou položkou", () => {
    const odd: MatterInput[] = [{ path: M049, cardFrontmatter: { title: "Reklamácia" }, records: [
      { ...task("M3-T1", "Odvolanie", "2026-10-27, Odv"), deadlines: ["2026-10-27, Odv"] },
      task("M3-T2", "Pojednávanie o 10:00", "2026-10-26 10:00"),
    ] }];
    const m = buildToday({ ...buildOverview(odd, TODAY), inputs: odd }, TODAY);
    expect(m.deadlines.map((x) => [x.recordId, x.invalid ?? false])).toEqual([["M3-T1", true]]);
    expect(caseDates(m.tasks, TODAY, 14, m.deadlines).map((x) => [x.id, x.due])).toEqual([["M3-T2", "2026-10-26"]]);
  });

  test("P3 aj na Domove klienta (#246): os dní klienta má záznam s lehotou v ten istý deň raz", () => {
    const same: MatterInput[] = [{ path: M049, cardFrontmatter: { title: "Reklamácia" }, records: [
      { ...task("M2-T1", "Odvolanie podať", "2026-10-27"), deadlines: ["2026-10-27 Odvolanie"] },
      task("M2-T2", "Pojednávanie", "2026-10-26 10:00"),
    ] }];
    const sd = { ...buildOverview(same, TODAY), inputs: same };
    const out = html(<ClientOverviewView workspaceId="c" locale="sk" todayIso={TODAY} matters={sd.matters}
      deadlines={sd.upcomingDeadlines} soon={sd.totals.deadlinesWithin7Days} today={buildToday(sd, TODAY)} />);
    const strip = out.match(/<section class="lw-today-strip".*?<\/section>/)?.[0] ?? "";
    const busy = strip.match(/<li[^>]*data-busy[^>]*>.*?<\/li>/g) ?? [];
    // 26. 10. termín s časom (úloha), 27. 10. jedna bodka lehoty bez druhej bodky úlohy.
    expect(busy.map((cell) => [cell.match(/<i /g)?.length, cell.includes('data-kind="task"')])).toEqual([[1, true], [1, false]]);
  });
  test("#264: Domov klienta ukáže priečinky iného klienta namiesto tichého vynechania", () => {
    const out = html(<ClientOverviewView workspaceId="c" locale="sk" todayIso={TODAY} matters={[]} deadlines={[]} soon={0}
      foreignFolders={["C099 SYN Vnoreny", "C003 Alfa s.r.o."]} />);
    expect(out).toContain("data-lawoss-client-overview-foreign");
    expect(out).toContain("Priečinky iného klienta, nie sú v prehľade: C099 SYN Vnoreny, C003 Alfa s.r.o.");
    expect(html(<ClientOverviewView workspaceId="c" locale="sk" todayIso={TODAY} matters={[]} deadlines={[]} soon={0} />)).not.toContain("data-lawoss-client-overview-foreign");
  });
});
