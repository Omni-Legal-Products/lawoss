import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { LAYER_OF } from "../../../lawoss/okf-pamat/src/schema.ts";
import type { OkfRecord } from "../../../lawoss/okf-pamat/src/record.ts";
import { buildOverview, type MatterInput } from "../../../lawoss/okf/read";
import { TodayView } from "../src/lawoss/lite/pages/today-page";
import { agendaEvents } from "../src/lawoss/lite/agenda-model";
import { appTodayTasks, buildToday, caseDateRows } from "../src/lawoss/lite/today-model";

// N-A5-9 (UI test dev 25. 10. 2026): „Termíny z prípadov“ mali ~132 riadkov (66× „Vyžiadať chýbajúcu prílohu“,
// 66× „Porovnať vyjadrenie protistrany“), každý bez klienta, a „Otvorené úlohy“ ukázali ten istý zoznam druhýkrát.
// Karty „Vaše prípady“ hlásili „Bez bližšej lehoty“, hoci prípad mal termín o 3 dni.

const TODAY = "2026-10-25";
const task = (id: string, title: string, due?: string): OkfRecord => ({
  okf: 1, id, type: "task", title, description: "syntetický záznam", layer: LAYER_OF.task, jurisdiction: "sk", status: "active",
  created: "2026-10-01", updated: "2026-10-20", truth: "", timeline: [], state: "pending", ...(due ? { due } : {}),
});
const inputs: MatterInput[] = Array.from({ length: 20 }, (_, i) => {
  const n = String(i + 1).padStart(3, "0");
  return {
    path: `Klienti/C${n} SYN Klient ${n}/Spisy/M${n} zákazka SYN-${n}`, cardFrontmatter: { title: `zákazka SYN-${n}` }, clientTitle: `SYN Klient ${n}`,
    scopePaths: [`Klienti/C${n} SYN Klient ${n}/Spisy/M${n} zákazka SYN-${n}`, `Klienti/C${n} SYN Klient ${n}`],
    records: [task(`M${n}-T1`, "Vyžiadať chýbajúcu prílohu", "2026-10-28"), task(`M${n}-T2`, "Bez termínu"), task(`M${n}-T3`, "Neskôr", "2026-12-01")],
  };
});
const data = { ...buildOverview(inputs, TODAY), inputs };
const html = renderToStaticMarkup(<MemoryRouter><TodayView model={buildToday(data, TODAY)} locale="sk" now={new Date(`${TODAY}T09:00:00`)} events={agendaEvents(data)} /></MemoryRouter>);
const section = (marker: string) => html.slice(html.indexOf(marker), html.indexOf("</ul>", html.indexOf(marker)));

describe("N-A5-9: Dnes prehľadne", () => {
  test("Termíny z prípadov: najviac 8 riadkov, počet ďalších a meno klienta pri prípade", () => {
    const dates = section("data-lawoss-case-dates");
    expect(dates.match(/data-kind="case-date"/g)).toHaveLength(8);
    expect(dates).toContain('data-lawoss-more="case-dates"');
    expect(dates).toContain("+12 ďalšie");
    // Ďalšie termíny sú v mesiaci: „+N ďalšie“ je tlačidlo, ktoré ho otvorí.
    expect(dates).toMatch(/<button type="button" class="lw-today-more-link">\+12 ďalšie<\/button>/);
    expect(dates).toContain("SYN Klient 001 – zákazka SYN-001");
  });

  test("Otvorené úlohy neopakujú termíny do 14 dní a sú skrátené", () => {
    const tasks = html.slice(html.indexOf("Otvorené úlohy</h2>"));
    const list = tasks.slice(0, tasks.indexOf("</ul>"));
    expect(list).not.toContain("Vyžiadať chýbajúcu prílohu");
    expect(list.match(/class="lw-today-task"/g)).toHaveLength(8);
    expect(list).toContain('data-lawoss-more="tasks"');
    expect(list).toContain("SYN Klient 001 – zákazka SYN-001");
  });

  test("karta prípadu bez lehoty ukáže najbližší pracovný termín", () => {
    const cards = html.slice(html.indexOf("lw-today-cards"));
    expect(cards).toContain("Najbližší termín");
    expect(cards).toContain("Pracovný termín");
    expect(cards).not.toContain("Bez blížiacej sa lehoty");
  });

  test("úloha aplikácie (Nová úloha, #258) s blízkym dátumom ostane v Otvorených úlohách s miestom, nie v termínoch prípadov", () => {
    const base = buildToday(data, TODAY);
    const model = { ...base, tasks: [...appTodayTasks([{ id: "t1", title: "Zavolať klientovi SYN", status: "open", dueDate: "2026-10-27", projectId: "p1", deletedAt: null }], () => "SYN Klient 001"), ...base.tasks] };
    const out = renderToStaticMarkup(<MemoryRouter><TodayView model={model} locale="sk" now={new Date(`${TODAY}T09:00:00`)} events={agendaEvents(data)} /></MemoryRouter>);
    const dates = out.slice(out.indexOf("data-lawoss-case-dates"), out.indexOf("</ul>", out.indexOf("data-lawoss-case-dates")));
    expect(dates).not.toContain("Zavolať klientovi SYN");
    const tasks = out.slice(out.indexOf("Otvorené úlohy</h2>"));
    const list = tasks.slice(0, tasks.indexOf("</ul>"));
    expect(list).toContain("Zavolať klientovi SYN");
    expect(list).toMatch(/Zavolať klientovi SYN.*· SYN Klient 001/s);
  });

  test("review: zmeškaná lehota na karte nie je pracovný termín; ukáže sa pracovný termín úlohy", () => {
    const missed: MatterInput[] = [{ path: "Klienti/C001/Spisy/M001", cardFrontmatter: { title: "Úhrada" }, records: [
      { ...task("M001-D1", "Lehota"), type: "deadline", deadlines: ["2026-10-20"] },
      task("M001-T1", "Vyžiadať prílohu", "2026-10-28"),
    ] }];
    const missedData = { ...buildOverview(missed, TODAY), inputs: missed };
    const card = renderToStaticMarkup(<MemoryRouter><TodayView model={buildToday(missedData, TODAY)} locale="sk" now={new Date(`${TODAY}T09:00:00`)} /></MemoryRouter>);
    const cards = card.slice(card.indexOf("lw-today-cards"));
    expect(cards).toContain("st 28. 10. · Pracovný termín");
    expect(cards).not.toMatch(/20\. 10\. · Pracovný termín/);
  });

  test("#276: desať zmeškaných úloh nevytlačí zo zoznamu zajtrajšie pojednávanie", () => {
    const late: MatterInput[] = [{ path: "Klienti/C001/Spisy/M001", cardFrontmatter: { title: "Úhrada" }, records: [
      ...Array.from({ length: 10 }, (_, i) => task(`M001-T${i + 1}`, `Zmeškaná úloha ${i + 1}`, `2026-08-${String(i + 10)}`)),
      task("M001-P1", "Pojednávanie", "2026-10-26 09:00"),
    ] }];
    const lateData = { ...buildOverview(late, TODAY), inputs: late };
    const out = renderToStaticMarkup(<MemoryRouter><TodayView model={buildToday(lateData, TODAY)} locale="sk" now={new Date(`${TODAY}T09:00:00`)} /></MemoryRouter>);
    const dates = out.slice(out.indexOf("data-lawoss-case-dates"), out.indexOf("</ul>", out.indexOf("data-lawoss-case-dates")));
    expect(dates.match(/data-kind="case-date"/g)).toHaveLength(8);
    expect(dates).toContain("Pojednávanie");
    expect(dates).toContain("+3 ďalšie");
    // Riadky ostanú podľa dátumu: zmeškané pred zajtrajškom, najstaršie hore.
    expect(dates.indexOf("Zmeškaná úloha 1<")).toBeLessThan(dates.indexOf("Pojednávanie"));
    expect(dates).not.toContain("Zmeškaná úloha 10<");
  });

  test("#276 review: osem včerajších úloh nevytlačí dnešný ani zajtrajší termín", () => {
    const at = (daysLeft: number, key: string) => ({ key, daysLeft });
    const dates = [...Array.from({ length: 8 }, (_, i) => at(-1, `vcera-${i}`)), at(0, "dnes"), at(1, "zajtra")];
    expect(caseDateRows(dates, 8).map((d) => d.key)).toEqual([...Array.from({ length: 6 }, (_, i) => `vcera-${i}`), "dnes", "zajtra"]);
    expect(caseDateRows(dates.slice(0, 3), 8)).toEqual(dates.slice(0, 3));
  });
});
