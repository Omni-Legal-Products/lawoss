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
/** Alfa 14: termíny a lehoty sú v jednom zozname „Čo horí“ (najviac 5 riadkov, zvyšok v Lehotách a úlohách). */
const hot = (out: string) => out.slice(out.indexOf('aria-labelledby="lw-dnes-hot"'), out.indexOf("</section>", out.indexOf('aria-labelledby="lw-dnes-hot"')));
const cards = (out: string) => out.slice(out.indexOf("lw-dnes-cards"));

describe("N-A5-9: Dnes prehľadne", () => {
  test("Čo horí: najviac 5 riadkov, „+N ďalšie“ vedie do Lehôt a úloh, „klient · prípad“", () => {
    const rows = hot(html);
    expect(rows.match(/data-kind="case-date"/g)).toHaveLength(5);
    expect(rows).toContain('data-lawoss-more="hot"');
    expect(rows).toMatch(/<a class="lw-dnes-more" data-lawoss-more="hot" href="\/lehoty"[^>]*>\+15 ďalšie<\/a>/);
    expect(rows).toContain("SYN Klient 001 · zákazka SYN-001");
  });

  test("Otvorené úlohy sú jeden zbalený riadok s počtom a odkazom, nie zoznam s krúžkami", () => {
    const row = html.slice(html.indexOf("lw-dnes-tasks-row"));
    expect(row).toMatch(/^lw-dnes-tasks-row" data-lawoss-tasks-count="60" href="\/lehoty"/);
    expect(row).toContain("Otvorené úlohy: 60");
    expect(row).toContain("Lehoty a úlohy");
    expect(html).not.toContain("lw-today-ring");
    expect(html).not.toContain('type="checkbox"');
  });

  test("karta prípadu bez lehoty ukáže najbližší pracovný termín", () => {
    expect(cards(html)).toContain("28. 10. · pracovný termín");
    expect(cards(html).match(/class="lw-dnes-card"/g)).toHaveLength(3);
    expect(cards(html)).toContain(">SYN Klient 0");
  });

  test("úloha aplikácie (Nová úloha, #258) s blízkym dátumom je v „Čo horí“ ako úloha s klientom, nie pracovný termín", () => {
    const base = buildToday(data, TODAY);
    const model = { ...base, tasks: [...appTodayTasks([{ id: "t1", title: "Zavolať klientovi SYN", status: "open", dueDate: "2026-10-27", projectId: "p1", deletedAt: null }], () => "SYN Klient 001"), ...base.tasks] };
    const out = renderToStaticMarkup(<MemoryRouter><TodayView model={model} locale="sk" now={new Date(`${TODAY}T09:00:00`)} events={agendaEvents(data)} /></MemoryRouter>);
    const row = hot(out).match(/<a class="lw-dnes-item"[^>]*>(?:(?!<\/a>).)*Zavolať klientovi SYN.*?<\/a>/s)?.[0] ?? "";
    expect(row).toContain('href="/tasks"');
    expect(row).toContain("Úloha · SYN Klient 001");
    expect(row).toContain('<span class="lw-dnes-pill" data-tone="work">Úloha</span>');
    expect(row).not.toContain("pracovný termín");
  });

  test("review: zmeškaná lehota na karte nie je pracovný termín; ukáže sa pracovný termín úlohy", () => {
    const missed: MatterInput[] = [{ path: "Klienti/C001/Spisy/M001", cardFrontmatter: { title: "Úhrada" }, records: [
      { ...task("M001-D1", "Lehota"), type: "deadline", deadlines: ["2026-10-20"] },
      task("M001-T1", "Vyžiadať prílohu", "2026-10-28"),
    ] }];
    const missedData = { ...buildOverview(missed, TODAY), inputs: missed };
    const card = renderToStaticMarkup(<MemoryRouter><TodayView model={buildToday(missedData, TODAY)} locale="sk" now={new Date(`${TODAY}T09:00:00`)} /></MemoryRouter>);
    expect(cards(card)).toContain("28. 10. · pracovný termín");
    expect(cards(card)).not.toMatch(/20\. 10\. · pracovný termín/);
  });

  test("#276: desať zmeškaných úloh nevytlačí zo zoznamu zajtrajšie pojednávanie", () => {
    const late: MatterInput[] = [{ path: "Klienti/C001/Spisy/M001", cardFrontmatter: { title: "Úhrada" }, records: [
      ...Array.from({ length: 10 }, (_, i) => task(`M001-T${i + 1}`, `Zmeškaná úloha ${i + 1}`, `2026-08-${String(i + 10)}`)),
      task("M001-P1", "Pojednávanie", "2026-10-26 09:00"),
    ] }];
    const lateData = { ...buildOverview(late, TODAY), inputs: late };
    const out = renderToStaticMarkup(<MemoryRouter><TodayView model={buildToday(lateData, TODAY)} locale="sk" now={new Date(`${TODAY}T09:00:00`)} /></MemoryRouter>);
    const dates = hot(out);
    expect(dates.match(/data-kind="case-date"/g)).toHaveLength(5);
    expect(dates).toContain("Pojednávanie");
    expect(dates).toContain("+6 ďalšie");
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
